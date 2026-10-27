import {
  AlertTriangle,
  ChevronRight,
  CirclePlus,
  Filter,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AuditLog,
  AuditLogInput,
  AccountPermission,
  AccountRole,
  AttachmentView,
  CourseInput,
  Employee,
  EmployeeDraft,
  EmployeeFilters,
  EventAttachmentView,
  EventInput,
  ServiceResult,
  StudentDetail,
  StudentDraft,
  StudentProfile,
} from "../types";
import { formatDisplayDate, getExpiryStatus } from "../services/dateUtils";
import {
  getEmployeeAttention,
  getEmployeeChangedFields,
  toUserFacingServiceError,
  type EventUploadProgressHandler,
  type AsyncEmployeeDataService,
  type EmployeeDataService,
} from "../services/dataService";
import { getEmployeeStatusLabel } from "../utils/labels";
import { EmployeeDrawer } from "../components/EmployeeDrawer";
import { EmployeeFormModal } from "../components/EmployeeFormModal";
import { StudentFormModal } from "../components/StudentFormModal";
import { StatusBadge } from "../components/StatusBadge";
import { paginateEmployees } from "./employeePagination";

type EmployeePageDataService = EmployeeDataService | AsyncEmployeeDataService;
type ArchiveStatus = "all" | "active" | "former" | "student";
type ArchiveRow = { kind: "employee"; item: Employee } | { kind: "student"; item: StudentProfile };

interface EmployeesPageProps {
  data: EmployeePageDataService;
  role: AccountRole;
  permissions: AccountPermission[];
  initialEmployeeId?: string;
  initialMonthlyMonthKey?: string;
}

const EMPTY_FILTERS: EmployeeFilters = {
  search: "",
  status: "all",
  department: "all",
  attention: "all",
};

function getErrorMessage(error: unknown, fallback: string): string {
  return toUserFacingServiceError(error, fallback);
}

function failure<T>(message: string): ServiceResult<T> {
  return { ok: false, message };
}

function filterEmployees(employees: Employee[], filters: EmployeeFilters): Employee[] {
  const search = filters.search.trim().toLowerCase();
  return employees.filter((employee) => {
    const searchable = [
      employee.name,
      employee.department,
      employee.personalPhone,
      employee.workPhone,
      employee.onlyChildStatus,
      employee.id,
    ]
      .join(" ")
      .toLowerCase();
    const matchesSearch = !search || searchable.includes(search);
    const matchesStatus = filters.status === "all" || employee.status === filters.status;
    const matchesDepartment = filters.department === "all" || employee.department === filters.department;
    const attention = getEmployeeAttention(employee);
    const matchesAttention =
      filters.attention === "all" ||
      (filters.attention === "contract" && attention.includes("合同")) ||
      (filters.attention === "vehicle" && attention.includes("车辆")) ||
      (filters.attention === "missing" && attention.includes("资料缺失"));
    return matchesSearch && matchesStatus && matchesDepartment && matchesAttention;
  });
}

export function EmployeesPage({ data, role, permissions, initialEmployeeId, initialMonthlyMonthKey }: EmployeesPageProps) {
  const [archiveStatus, setArchiveStatus] = useState<ArchiveStatus>("all");
  const [filters, setFilters] = useState<EmployeeFilters>({ ...EMPTY_FILTERS });
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allStudents, setAllStudents] = useState<StudentProfile[]>([]);
  const [remoteSearchEmployees, setRemoteSearchEmployees] = useState<Employee[] | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedLogs, setSelectedLogs] = useState<AuditLog[]>([]);
  const [editorEmployee, setEditorEmployee] = useState<Employee | null | undefined>(undefined);
  const [studentEditor, setStudentEditor] = useState<StudentDetail | null | undefined>(undefined);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isStudentListLoading, setIsStudentListLoading] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isStudentDetailLoading, setIsStudentDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [studentListError, setStudentListError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [studentDetailError, setStudentDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const auditRequestRef = useRef(0);
  const studentDetailRequestRef = useRef(0);

  const isCloudMode = data.mode === "cloudbase";
  const can = (permission: AccountPermission) => role === "super_admin" || permissions.includes(permission);
  const canWriteEmployee = can("employee.write") && data.mode !== "cloudbase-unconfigured";
  const canWriteHistory = can("history.write") && data.mode !== "cloudbase-unconfigured";
  const canReadAttachment = can("attachment.read");
  const canWriteAttachment = can("attachment.write") && data.mode !== "cloudbase-unconfigured";
  const canEditMonthlyAssessment = can("monthly_assessment_edit") && data.mode !== "cloudbase-unconfigured";

  const selectedEmployee = useMemo(
    () => allEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [allEmployees, selectedEmployeeId],
  );
  const selectedEmployeeKey = selectedEmployee?.id ?? null;
  const departments = useMemo(
    () => Array.from(new Set(allEmployees.map((employee) => employee.department).filter(Boolean))).sort(),
    [allEmployees],
  );
  const isDepartmentsLoading = isListLoading && allEmployees.length === 0;
  const hasNumericSearch = archiveStatus !== "student" && /\d/.test(filters.search);
  const locallyFilteredEmployees = useMemo(
    () => filterEmployees(allEmployees, filters),
    [allEmployees, filters],
  );
  const employees = useMemo(() => {
    if (!hasNumericSearch || !remoteSearchEmployees) return locallyFilteredEmployees;

    const merged = new Map(locallyFilteredEmployees.map((employee) => [employee.id, employee]));
    const remoteMatches = filterEmployees(remoteSearchEmployees, { ...filters, search: "" });
    remoteMatches.forEach((employee) => merged.set(employee.id, employee));
    return Array.from(merged.values());
  }, [filters, hasNumericSearch, locallyFilteredEmployees, remoteSearchEmployees]);
  const visibleEmployees = useMemo(
    () => archiveStatus === "student" ? [] : employees,
    [archiveStatus, employees],
  );
  const students = useMemo(() => {
    if (!canWriteEmployee || !["all", "student"].includes(archiveStatus)) return [];
    const search = filters.search.trim().toLocaleLowerCase();
    return allStudents.filter((student) => !search || student.name.toLocaleLowerCase().includes(search));
  }, [allStudents, archiveStatus, canWriteEmployee, filters.search]);
  const archiveRows = useMemo<ArchiveRow[]>(() => [
    ...visibleEmployees.map((item) => ({ kind: "employee" as const, item })),
    ...students.map((item) => ({ kind: "student" as const, item })),
  ], [students, visibleEmployees]);
  const archivePage = useMemo(
    () => paginateEmployees(archiveRows, currentPage),
    [archiveRows, currentPage],
  );
  const pageNumbers = useMemo(
    () => Array.from({ length: archivePage.totalPages }, (_, index) => index + 1),
    [archivePage.totalPages],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, refreshToken]);

  useEffect(() => {
    setCurrentPage((page) => archivePage.totalPages === 0
      ? 1
      : Math.min(Math.max(page, 1), archivePage.totalPages));
  }, [archivePage.totalPages]);

  useEffect(() => {
    let cancelled = false;

    async function loadEmployees() {
      setIsListLoading(true);
      setListError(null);
      try {
        const nextAllEmployees = await data.listEmployees(EMPTY_FILTERS);
        if (cancelled) return;
        setAllEmployees(nextAllEmployees);
        if (initialEmployeeId) setSelectedEmployeeId(initialEmployeeId);
      } catch (error) {
        if (!cancelled) setListError(getErrorMessage(error, "读取员工档案列表失败。"));
      } finally {
        if (!cancelled) setIsListLoading(false);
      }
    }

    void loadEmployees();
    return () => {
      cancelled = true;
    };
  }, [data, initialEmployeeId, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    if (!canWriteEmployee) {
      setIsStudentListLoading(false);
      setAllStudents([]);
      return () => {
        cancelled = true;
      };
    }

    async function loadStudents() {
      setIsStudentListLoading(true);
      setStudentListError(null);
      try {
        const nextStudents = await data.listStudents();
        if (!cancelled) setAllStudents(nextStudents);
      } catch (error) {
        if (!cancelled) {
          setAllStudents([]);
          setStudentListError(getErrorMessage(error, "读取学员档案列表失败。"));
        }
      } finally {
        if (!cancelled) setIsStudentListLoading(false);
      }
    }

    void loadStudents();
    return () => {
      cancelled = true;
    };
  }, [canWriteEmployee, data, refreshToken]);

  useEffect(() => {
    let cancelled = false;

    if (!hasNumericSearch) {
      setRemoteSearchEmployees(null);
      setSearchError(null);
      setIsSearchLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setRemoteSearchEmployees(null);
    setSearchError(null);
    setIsSearchLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const nextEmployees = await data.listEmployees(filters);
          if (!cancelled) setRemoteSearchEmployees(nextEmployees);
        } catch (error: unknown) {
          if (!cancelled) {
            setRemoteSearchEmployees([]);
            setSearchError(getErrorMessage(error, "手机号搜索暂时失败，已保留本地匹配结果。"));
          }
        } finally {
          if (!cancelled) setIsSearchLoading(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data, filters, hasNumericSearch, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    const requestToken = auditRequestRef.current + 1;
    auditRequestRef.current = requestToken;

    if (!selectedEmployeeId) {
      setSelectedLogs([]);
      setDetailError(null);
      setIsDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (!selectedEmployeeKey) {
      if (isListLoading) {
        setIsDetailLoading(true);
        setDetailError(null);
      } else {
        setIsDetailLoading(false);
        setDetailError("未找到要查看的员工档案。");
      }
      return () => {
        cancelled = true;
      };
    }

    const employeeId = selectedEmployeeId;

    async function loadLogs() {
      setIsDetailLoading(true);
      setDetailError(null);
      try {
        const logs = await data.listAuditLogs({ targetId: employeeId });
        if (cancelled || auditRequestRef.current !== requestToken) return;
        setSelectedLogs(logs);
      } catch (error) {
        if (!cancelled && auditRequestRef.current === requestToken) {
          setSelectedLogs([]);
          setDetailError(getErrorMessage(error, "读取员工详情失败。"));
        }
      } finally {
        if (!cancelled && auditRequestRef.current === requestToken) setIsDetailLoading(false);
      }
    }

    void loadLogs();
    return () => {
      cancelled = true;
    };
  }, [data, isListLoading, refreshToken, selectedEmployeeId, selectedEmployeeKey]);

  const hasActiveFilters = Boolean(archiveStatus !== "all" || filters.search || filters.department !== "all" || filters.attention !== "all");

  const metrics = useMemo(() => {
    const attention = allEmployees.filter((employee) => getEmployeeAttention(employee).length > 0).length;
    const contracts = allEmployees.filter((employee) => employee.contract && getExpiryStatus(employee.contract.endDate) !== "normal").length;
    const vehicles = allEmployees.filter((employee) => employee.vehicle && getExpiryStatus(employee.vehicle.endDate) !== "normal").length;
    return { attention, contracts, vehicles };
  }, [allEmployees]);

  function refresh() {
    setActionError(null);
    data.clearCache?.();
    setRefreshToken((value) => value + 1);
  }

  function clearFilters() {
    setArchiveStatus("all");
    setFilters({ ...EMPTY_FILTERS });
  }

  function changeArchiveStatus(nextStatus: ArchiveStatus) {
    setArchiveStatus(nextStatus);
    setActionError(null);
    setSearchError(null);
    if (nextStatus === "student") {
      setSelectedEmployeeId(null);
      setEditorEmployee(undefined);
      closeStudentEditor();
      setFilters((current) => ({ ...current, status: "all", department: "all", attention: "all" }));
    } else {
      closeStudentEditor();
      setFilters((current) => ({ ...current, status: nextStatus }));
    }
  }

  function openNewEmployee() {
    if (!canWriteEmployee) return;
    setSelectedEmployeeId(null);
    setEditorEmployee(null);
    setActionError(null);
  }

  function openNewStudent() {
    if (!canWriteEmployee) return;
    studentDetailRequestRef.current += 1;
    setIsStudentDetailLoading(false);
    setStudentDetailError(null);
    setStudentEditor(null);
    setActionError(null);
  }

  async function openStudent(student: StudentProfile) {
    if (!canWriteEmployee) return;
    const requestToken = studentDetailRequestRef.current + 1;
    studentDetailRequestRef.current = requestToken;
    setActionError(null);
    setStudentDetailError(null);
    setStudentEditor({ ...student, phoneNumber: "" });
    setIsStudentDetailLoading(true);
    try {
      const detail = await data.getStudent(student.id);
      if (studentDetailRequestRef.current !== requestToken) return;
      if (!detail) {
        setStudentDetailError("未找到要查看的学员档案。");
        return;
      }
      setStudentEditor(detail);
    } catch (error) {
      if (studentDetailRequestRef.current === requestToken) {
        setStudentDetailError(getErrorMessage(error, "读取学员档案详情失败。"));
      }
    } finally {
      if (studentDetailRequestRef.current === requestToken) setIsStudentDetailLoading(false);
    }
  }

  function closeStudentEditor() {
    studentDetailRequestRef.current += 1;
    setIsStudentDetailLoading(false);
    setStudentDetailError(null);
    setStudentEditor(undefined);
  }

  function openEditor(employee: Employee) {
    if (!canWriteEmployee) return;
    setEditorEmployee(employee);
    setActionError(null);
  }

  async function recordPreviewAudit(input: AuditLogInput): Promise<string | null> {
    if (isCloudMode) return null;
    try {
      const result = await data.recordAudit(input);
      return result.ok ? null : result.message;
    } catch (error) {
      return getErrorMessage(error, "写入操作日志失败。");
    }
  }

  async function handleSaveEmployee(draft: EmployeeDraft): Promise<ServiceResult<Employee>> {
    if (!canWriteEmployee) return failure("当前账号没有员工档案维护权限。");
    setActionError(null);
    try {
      if (editorEmployee) {
        const before = await data.getEmployee(editorEmployee.id);
        if (!before) return failure("未找到要编辑的员工档案。");
      const result = await data.updateEmployee(editorEmployee.id, draft, editorEmployee.version);
        if (result.ok) {
          const changedFields = getEmployeeChangedFields(before, result.data);
          const auditError = await recordPreviewAudit({
            action: "update_employee",
            targetId: result.data.id,
            targetName: result.data.name,
            changedFields: changedFields.length ? changedFields : ["未检测到字段变化"],
            before: {
              department: before.department,
              status: getEmployeeStatusLabel(before.status),
              contractEndDate: before.contract?.endDate ?? null,
            },
            after: {
              department: result.data.department,
              status: getEmployeeStatusLabel(result.data.status),
              contractEndDate: result.data.contract?.endDate ?? null,
            },
            detail: changedFields.length ? `修改了${changedFields.join("、")}。` : "打开并保存了员工档案，字段没有变化。",
          });
          if (auditError) setActionError(`档案已保存，但操作日志写入失败：${auditError}`);
          refresh();
        }
        return result;
      }

      const result = await data.createEmployee(draft);
      if (result.ok) {
        const auditError = await recordPreviewAudit({
          action: "create_employee",
          targetId: result.data.id,
          targetName: result.data.name,
          changedFields: ["新建员工档案"],
          after: { department: result.data.department, status: getEmployeeStatusLabel(result.data.status) },
          detail: `新增员工“${result.data.name}”，部门为${result.data.department}。`,
        });
        if (auditError) setActionError(`档案已保存，但操作日志写入失败：${auditError}`);
        refresh();
        setSelectedEmployeeId(result.data.id);
      }
      return result;
    } catch (error) {
      return failure(getErrorMessage(error, "保存员工档案失败。"));
    }
  }

  async function handleSaveStudent(draft: StudentDraft): Promise<ServiceResult<StudentProfile>> {
    if (!canWriteEmployee) return failure("当前账号没有学员档案维护权限。");
    setActionError(null);
    try {
      if (studentEditor) {
        const result = await data.updateStudent(studentEditor.id, draft, studentEditor.version);
        if (result.ok) {
          const changedFields = [
            ...(studentEditor.name !== result.data.name ? ["姓名"] : []),
            ...(studentEditor.phoneNumber !== draft.phoneNumber ? ["本人手机号"] : []),
          ];
          const auditError = await recordPreviewAudit({
            action: "update_student",
            targetId: result.data.id,
            targetName: result.data.name,
            changedFields: changedFields.length ? changedFields : ["未检测到字段变化"],
            before: { name: studentEditor.name, status: studentEditor.status === "active" ? "在册" : "不在册" },
            after: { name: result.data.name, status: result.data.status === "active" ? "在册" : "不在册" },
            detail: changedFields.length ? `修改了${changedFields.join("、")}。` : "打开并保存了学员档案，字段没有变化。",
          });
          if (auditError) setActionError(`档案已保存，但操作日志写入失败：${auditError}`);
          refresh();
        }
        return result;
      }

      const result = await data.createStudent(draft);
      if (result.ok) {
        const auditError = await recordPreviewAudit({
          action: "create_student",
          targetId: result.data.id,
          targetName: result.data.name,
          changedFields: ["姓名", "本人手机号"],
          after: { name: result.data.name, status: "在册" },
          detail: `新增学员“${result.data.name}”。`,
        });
        if (auditError) setActionError(`档案已保存，但操作日志写入失败：${auditError}`);
        refresh();
      }
      return result;
    } catch (error) {
      return failure(getErrorMessage(error, "保存学员档案失败。"));
    }
  }

  async function handleSetStudentStatus(student: StudentDetail, nextStatus: "active" | "inactive"): Promise<ServiceResult<StudentProfile>> {
    if (!canWriteEmployee) return failure("当前账号没有学员档案维护权限。");
    try {
      const result = nextStatus === "inactive"
        ? await data.archiveStudent(student.id, student.version)
        : await data.restoreStudent(student.id, student.version);
      if (result.ok) {
        const action = nextStatus === "inactive" ? "archive_student" : "restore_student";
        const auditError = await recordPreviewAudit({
          action,
          targetId: result.data.id,
          targetName: result.data.name,
          changedFields: ["状态"],
          before: { status: student.status === "active" ? "在册" : "不在册" },
          after: { status: nextStatus === "active" ? "在册" : "不在册" },
          detail: nextStatus === "inactive" ? "归档学员档案。" : "恢复学员档案。",
        });
        if (auditError) setActionError(`档案状态已更新，但操作日志写入失败：${auditError}`);
        refresh();
      }
      return result;
    } catch (error) {
      return failure(getErrorMessage(error, "更新学员档案状态失败。"));
    }
  }

  async function handleAddCourse(input: CourseInput): Promise<ServiceResult<Employee>> {
    if (!canWriteHistory) return failure("当前账号没有培训与事件记录维护权限。");
    if (!selectedEmployee) return failure("请先选择员工。");
    try {
      const result = await data.addCourseRecord(selectedEmployee.id, input, selectedEmployee.version);
      if (result.ok) {
        const auditError = await recordPreviewAudit({
          action: "add_course",
          targetId: result.data.id,
          targetName: result.data.name,
          changedFields: ["课程记录"],
          after: { courseName: input.courseName, status: input.status },
          detail: `新增课程记录“${input.courseName}”。`,
        });
        if (auditError) setActionError(`课程记录已保存，但操作日志写入失败：${auditError}`);
        refresh();
      }
      return result;
    } catch (error) {
      return failure(getErrorMessage(error, "保存课程记录失败。"));
    }
  }

  async function handleAddEvent(
    input: EventInput,
    attachmentFile?: File,
    onUploadProgress?: EventUploadProgressHandler,
  ): Promise<ServiceResult<Employee>> {
    if (!canWriteHistory) return failure("当前账号没有培训与事件记录维护权限。");
    if (!selectedEmployee) return failure("请先选择员工。");
    try {
      const result = await data.addEventRecord(selectedEmployee.id, input, attachmentFile, onUploadProgress, selectedEmployee.version);
      if (result.ok) {
        const auditError = await recordPreviewAudit({
          action: "add_event",
          targetId: result.data.id,
          targetName: result.data.name,
          changedFields: ["特殊事件"],
          after: attachmentFile
            ? { eventDate: input.eventDate, summary: input.summary, attachment: "事件图片" }
            : { eventDate: input.eventDate, summary: input.summary },
          detail: `新增事件“${input.summary}”。`,
        });
        if (auditError) setActionError(`事件记录已保存，但操作日志写入失败：${auditError}`);
        refresh();
      }
      return result;
    } catch (error) {
      return failure(getErrorMessage(error, "保存事件记录失败。"));
    }
  }

  async function handleUploadAttachment(
    file: File,
    onUploadProgress?: EventUploadProgressHandler,
  ): Promise<ServiceResult<Employee>> {
    if (!canWriteAttachment) return failure("当前账号没有附件上传权限。");
    if (!selectedEmployee) return failure("请先选择员工。");
    try {
      const result = await data.uploadAttachment(selectedEmployee.id, file, onUploadProgress, selectedEmployee.version);
      if (result.ok) {
        const auditError = await recordPreviewAudit({
          action: "add_attachment",
          targetId: result.data.id,
          targetName: result.data.name,
          changedFields: ["员工附件"],
          after: { fileName: file.name, mimeType: file.type },
          detail: `上传员工附件“${file.name}”。`,
        });
        if (auditError) setActionError(`附件已保存，但操作日志写入失败：${auditError}`);
        refresh();
      }
      return result;
    } catch (error) {
      return failure(getErrorMessage(error, "上传员工附件失败。"));
    }
  }

  async function handleViewEventAttachment(eventId: string, attachmentId: string): Promise<ServiceResult<EventAttachmentView>> {
    if (!canReadAttachment) return failure("当前账号没有附件查看权限。");
    if (!selectedEmployee) return failure("请先选择员工。");
    try {
      const employeeId = selectedEmployee.id;
      const result = await data.getEventAttachmentUrl(employeeId, eventId, attachmentId);
      if (result.ok) {
        void (async () => {
          try {
            const logs = await data.listAuditLogs({ targetId: employeeId });
            if (selectedEmployeeId === employeeId) setSelectedLogs(logs);
          } catch (error) {
            if (selectedEmployeeId === employeeId) {
              setDetailError(getErrorMessage(error, "读取操作日志失败。"));
            }
          }
        })();
      }
      return result;
    } catch (error) {
      return failure(getErrorMessage(error, "查看事件图片失败，请稍后重试。"));
    }
  }

  async function handleViewAttachment(attachmentId: string): Promise<ServiceResult<AttachmentView>> {
    if (!canReadAttachment) return failure("当前账号没有附件查看权限。");
    if (!selectedEmployee) return failure("请先选择员工。");
    try {
      const employeeId = selectedEmployee.id;
      const result = await data.getAttachmentUrl(employeeId, attachmentId);
      if (result.ok) {
        void (async () => {
          try {
            const logs = await data.listAuditLogs({ targetId: employeeId });
            if (selectedEmployeeId === employeeId) setSelectedLogs(logs);
          } catch (error) {
            if (selectedEmployeeId === employeeId) {
              setDetailError(getErrorMessage(error, "读取操作日志失败。"));
            }
          }
        })();
      }
      return result;
    } catch (error) {
      return failure(getErrorMessage(error, "查看员工附件失败，请稍后重试。"));
    }
  }

  return (
    <div className="page-frame">
      <header className="page-header">
        <div>
          <span className="eyebrow">员工档案</span>
          <h1>员工档案</h1>
          <p>在同一档案页查看员工与学员；学员手机号只在详情查看时读取并记入操作日志</p>
        </div>
        <div className="page-header-actions">
          {canWriteEmployee ? <><button className="primary-button" type="button" onClick={openNewEmployee}><CirclePlus size={17} />新增员工</button><button className="secondary-button" type="button" onClick={openNewStudent}><CirclePlus size={17} />新增学员</button></> : <span className="permission-readout">当前账号为只读</span>}
        </div>
      </header>

      {actionError ? <div className="form-message form-message-error" role="alert">{actionError}</div> : null}
      {searchError ? <div className="form-message form-message-error" role="alert">{searchError}</div> : null}

      <section className="metric-strip" aria-label="员工档案概览">
        <div className="metric-card"><span>全部员工</span><strong>{isListLoading ? "—" : allEmployees.length}</strong><small>员工档案总数</small></div>
        <div className="metric-card metric-card-rust"><span>需要关注</span><strong>{isListLoading ? "—" : metrics.attention}</strong><small>合同、车辆或资料缺失</small></div>
        <div className="metric-card"><span>合同提醒</span><strong>{isListLoading ? "—" : metrics.contracts}</strong><small>到期或日期缺失</small></div>
        <div className="metric-card metric-card-yellow"><span>车辆提醒</span><strong>{isListLoading ? "—" : metrics.vehicles}</strong><small>到期或日期缺失</small></div>
      </section>

      <section className="archive-workspace">
        <aside className="filter-rail">
          <div className="rail-heading"><div><span className="eyebrow">筛选条件</span><h2>筛选档案</h2></div><SlidersHorizontal size={18} /></div>
          <div className="filter-group"><span className="filter-label">状态</span><div className="segmented-control"><button className={archiveStatus === "all" ? "is-active" : ""} type="button" onClick={() => changeArchiveStatus("all")}>全部</button><button className={archiveStatus === "active" ? "is-active" : ""} type="button" onClick={() => changeArchiveStatus("active")}>在职</button><button className={archiveStatus === "former" ? "is-active" : ""} type="button" onClick={() => changeArchiveStatus("former")}>离职</button>{canWriteEmployee ? <button className={archiveStatus === "student" ? "is-active" : ""} type="button" onClick={() => changeArchiveStatus("student")}>学员</button> : null}</div></div>
          <label className="search-box"><Search size={17} /><input aria-label="搜索档案" placeholder={archiveStatus === "student" ? "搜索学员姓名" : "搜索员工姓名、部门或电话；学员按姓名匹配"} value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label>
          <label className="filter-select"><span className="filter-label">部门 / 分组</span><select aria-busy={isDepartmentsLoading} disabled={isDepartmentsLoading || archiveStatus === "student"} value={filters.department} onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value }))}><option value="all">{isDepartmentsLoading ? "部门加载中…" : "全部部门"}</option>{departments.map((department) => <option value={department} key={department}>{department}</option>)}</select></label>
          <label className="filter-select"><span className="filter-label">关注类型</span><select disabled={archiveStatus === "student"} value={filters.attention} onChange={(event) => setFilters((current) => ({ ...current, attention: event.target.value as EmployeeFilters["attention"] }))}><option value="all">全部记录</option><option value="contract">合同到期 / 缺失</option><option value="vehicle">车辆到期 / 缺失</option><option value="missing">基础资料缺失</option></select></label>
          <div className="rail-divider" />
          <div className="filter-legend"><span className="filter-label">状态说明</span><div><i className="legend-dot dot-rust" />合同 / 车辆需要关注</div><div><i className="legend-dot dot-yellow" />资料字段未完整</div><div><i className="legend-dot dot-green" />当前状态正常</div></div>
          <p className="filter-note">学员与员工共用列表；学员仅按姓名搜索，部门和关注条件只筛选员工。</p>
          {hasActiveFilters ? <button className="clear-filter-button" type="button" onClick={clearFilters}><Filter size={14} />清除全部筛选</button> : null}
        </aside>

        <div className="employee-list-panel">
          <div className="list-toolbar">
            <div>
              <span className="eyebrow">{isListLoading ? "档案列表" : `档案列表 · 共 ${archiveRows.length} 条`}</span>
              <strong>{archiveStatus === "student" ? "学员档案" : archiveStatus === "active" ? "在职员工" : archiveStatus === "former" ? "离职员工" : "全部员工与学员"}</strong>
            </div>
            <span className="toolbar-meta">{isStudentListLoading && archiveStatus === "all" ? "正在读取学员档案…" : "点击姓名打开档案"}</span>
          </div>
          {studentListError && archiveStatus === "all" ? <div className="form-message form-message-error" role="alert">学员档案暂时无法读取；员工档案仍可查看。<button className="text-button" type="button" onClick={refresh}>重试</button></div> : null}
          {isListLoading ? <div className="empty-list" aria-live="polite"><LoaderCircle size={34} /><h2>正在加载员工档案</h2><p>请稍候，正在读取档案。</p></div>
            : listError ? <div className="empty-list" role="alert"><AlertTriangle size={34} /><h2>员工档案加载失败</h2><p>{listError}</p><button className="secondary-button" type="button" onClick={refresh}>重试</button></div>
              : studentListError && archiveStatus === "student" ? <div className="empty-list" role="alert"><AlertTriangle size={34} /><h2>学员档案加载失败</h2><p>{studentListError}</p><button className="secondary-button" type="button" onClick={refresh}>重试</button></div>
                : isSearchLoading && !archiveRows.length ? <div className="empty-list" aria-live="polite"><LoaderCircle size={34} /><h2>正在搜索员工档案</h2><p>请稍候，正在匹配联系方式。</p></div>
                  : isStudentListLoading && archiveStatus === "all" && !archiveRows.length ? <div className="empty-list" aria-live="polite"><LoaderCircle size={34} /><h2>正在读取档案</h2><p>请稍候，正在读取员工与学员记录。</p></div>
                    : archiveRows.length ? <div className="employee-table-wrap"><table className="employee-table"><thead><tr><th>档案</th><th>类型</th><th>部门</th><th>状态</th><th>入职 / 更新日期</th><th>档案提醒</th><th aria-label="操作" /></tr></thead><tbody>{archivePage.items.map((row) => {
                      if (row.kind === "student") {
                        const student = row.item;
                        return <tr key={`student:${student.id}`}>
                          <td data-label="档案"><button className="employee-name-button" type="button" onClick={() => void openStudent(student)}><span className="table-avatar">{student.name.slice(0, 1)}</span><span><strong>{student.name}</strong><small>打开学员详情</small></span></button></td>
                          <td data-label="类型"><span className="department-cell">学员</span></td>
                          <td data-label="部门"><span className="department-cell">—</span></td>
                          <td data-label="状态"><span className={`status-badge ${student.status === "active" ? "status-active" : "status-former"}`}>{student.status === "active" ? "在册" : "不在册"}</span></td>
                          <td data-label="入职 / 更新日期"><span className="date-cell">{student.updatedAt ? formatDisplayDate(student.updatedAt.slice(0, 10)) : "—"}</span></td>
                          <td data-label="档案提醒"><span className="attention-ok">—</span></td>
                          <td data-label="打开"><button className="row-open-button" type="button" aria-label={`打开${student.name}学员详情`} onClick={() => void openStudent(student)}><span>打开详情</span><ChevronRight size={17} /></button></td>
                        </tr>;
                      }
                      const employee = row.item;
                      const attention = getEmployeeAttention(employee);
                      return <tr key={`employee:${employee.id}`} className={selectedEmployeeId === employee.id ? "is-selected" : ""}>
                        <td data-label="档案"><button className="employee-name-button" type="button" onClick={() => setSelectedEmployeeId(employee.id)}><span className="table-avatar">{employee.name.slice(0, 1)}</span><span><strong>{employee.name}</strong><small>点击查看员工档案</small></span></button></td>
                        <td data-label="类型"><span className="department-cell">员工</span></td>
                        <td data-label="部门"><span className="department-cell">{employee.department || "未填写"}</span></td>
                        <td data-label="状态"><StatusBadge kind="employee" value={employee.status} /></td>
                        <td data-label="入职 / 更新日期"><span className="date-cell">{formatDisplayDate(employee.hireDate)}</span></td>
                        <td data-label="档案提醒"><div className="attention-cell">{attention.length ? attention.map((item) => <span className={`attention-tag ${item === "资料缺失" ? "is-yellow" : "is-rust"}`} key={item}>{item}</span>) : <span className="attention-ok">正常</span>}</div></td>
                        <td data-label="打开"><button className="row-open-button" type="button" aria-label={`打开${employee.name}详情页`} onClick={() => setSelectedEmployeeId(employee.id)}><span>打开详情页</span><ChevronRight size={17} /></button></td>
                      </tr>;
                    })}</tbody></table></div>
                      : <div className="empty-list"><UsersRound size={34} /><h2>{archiveStatus === "student" ? (filters.search ? "没有匹配的学员档案" : "还没有学员档案") : "没有匹配的档案"}</h2><p>{archiveStatus === "student" ? "新增学员只需填写姓名和本人手机号。" : "可以调整筛选条件，或新增一份档案。"}</p>{hasActiveFilters ? <button className="secondary-button" type="button" onClick={clearFilters}>清除筛选</button> : null}</div>}
          <div className="list-footer">
            {!isListLoading && !listError && archiveRows.length ? <>
              <span aria-live="polite">第 {archivePage.startIndex + 1}–{archivePage.endIndex} 条，共 {archiveRows.length} 条</span>
              <button className="secondary-button compact-button" type="button" aria-label="上一页" disabled={archivePage.currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}>上一页</button>
              {pageNumbers.map((page) => <button className={page === archivePage.currentPage ? "primary-button compact-button" : "secondary-button compact-button"} type="button" aria-label={`第${page}页`} aria-current={page === archivePage.currentPage ? "page" : undefined} onClick={() => setCurrentPage(page)} key={page}>{page}</button>)}
              <button className="secondary-button compact-button" type="button" aria-label="下一页" disabled={archivePage.currentPage === archivePage.totalPages} onClick={() => setCurrentPage((page) => Math.min(page + 1, archivePage.totalPages))}>下一页</button>
            </> : null}
          </div>
        </div>
      </section>

      {selectedEmployee ? <EmployeeDrawer employee={selectedEmployee} logs={selectedLogs} canEdit={canWriteEmployee} canReadAttachment={canReadAttachment} canWriteAttachment={canWriteAttachment} canWriteHistory={canWriteHistory} canEditMonthlyAssessment={canEditMonthlyAssessment} monthlyAssessmentMonthKey={initialMonthlyMonthKey} monthlyAssessmentService={data} isCloudMode={isCloudMode} onClose={() => setSelectedEmployeeId(null)} onEdit={() => openEditor(selectedEmployee)} onAddCourse={handleAddCourse} onAddEvent={handleAddEvent} onUploadAttachment={handleUploadAttachment} onViewEventAttachment={handleViewEventAttachment} onViewAttachment={handleViewAttachment} /> : selectedEmployeeId ? <aside className="detail-drawer" aria-label="员工详情加载状态"><div className="empty-list" role={detailError ? "alert" : undefined}>{detailError ? <AlertTriangle size={34} /> : <LoaderCircle size={34} />}<h2>{detailError ? "员工详情加载失败" : isDetailLoading ? "正在加载员工详情" : "员工详情暂不可用"}</h2><p>{detailError ?? "正在读取员工档案和相关操作日志。"}</p>{detailError ? <button className="secondary-button" type="button" onClick={refresh}>重试</button> : null}<button className="text-button" type="button" onClick={() => setSelectedEmployeeId(null)}>关闭</button></div></aside> : null}
      {editorEmployee !== undefined ? <EmployeeFormModal employee={editorEmployee} departments={departments} onClose={() => setEditorEmployee(undefined)} onSave={handleSaveEmployee} /> : null}
      {studentEditor !== undefined ? <StudentFormModal
        key={studentEditor ? `${studentEditor.id}:${isStudentDetailLoading ? "loading" : "ready"}` : "new-student"}
        student={studentEditor}
        detailLoading={Boolean(studentEditor && isStudentDetailLoading)}
        detailError={studentEditor ? studentDetailError : null}
        onRetry={studentEditor ? () => void openStudent(studentEditor) : undefined}
        onClose={closeStudentEditor}
        onSave={handleSaveStudent}
        onArchive={studentEditor ? () => handleSetStudentStatus(studentEditor, "inactive") : undefined}
        onRestore={studentEditor ? () => handleSetStudentStatus(studentEditor, "active") : undefined}
      /> : null}
    </div>
  );
}
