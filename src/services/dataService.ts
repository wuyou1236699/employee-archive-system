import { addDays, addYears, formatDateOnly, getExpiryStatus, isValidDateOnly } from "./dateUtils";
import { app } from "./cloudbaseAdapter";
import { ImageRegistration, ImageRegistrationError } from "./imageRegistration";
import type {
  AuditFilters,
  AuditLog,
  AuditLogInput,
  AccountPermission,
  AccountProfile,
  AttachmentView,
  CourseInput,
  Employee,
  EmployeeDraft,
  EmployeeFilters,
  StudentDraft,
  StudentDetail,
  StudentProfile,
  EventAttachmentView,
  EventInput,
  MonthlyAssessmentFilters,
  MonthlyAssessmentOverview,
  MonthlyAssessmentRecord,
  MonthlyAssessmentSaveInput,
  ServiceResult,
} from "../types";

const ACCOUNT_PERMISSIONS = new Set<AccountPermission>([
  "employee.write",
  "history.write",
  "attachment.read",
  "attachment.write",
  "audit.read",
  "monthly_assessment_edit",
  "quarterly.manage",
]);
const EMPLOYEE_LIST_CACHE_TTL_MS = 30_000;

export interface EmployeeDataService {
  readonly mode: "local-preview" | "cloudbase" | "cloudbase-unconfigured";
  clearCache?(): void;
  getCurrentAccount(): AccountProfile;
  listEmployees(filters: EmployeeFilters): Employee[];
  listStudents(): StudentProfile[];
  getStudent(studentId: string): StudentDetail | undefined;
  getEmployee(employeeId: string): Employee | undefined;
  getDepartments(): string[];
  createEmployee(draft: EmployeeDraft): ServiceResult<Employee>;
  createStudent(draft: StudentDraft): ServiceResult<StudentProfile>;
  updateStudent(studentId: string, draft: StudentDraft, expectedVersion?: number): ServiceResult<StudentProfile>;
  archiveStudent(studentId: string, expectedVersion?: number): ServiceResult<StudentProfile>;
  restoreStudent(studentId: string, expectedVersion?: number): ServiceResult<StudentProfile>;
  updateEmployee(employeeId: string, draft: EmployeeDraft, expectedVersion?: number): ServiceResult<Employee>;
  archiveEmployee(employeeId: string): ServiceResult<Employee>;
  addCourseRecord(employeeId: string, input: CourseInput, expectedVersion?: number): ServiceResult<Employee>;
  addEventRecord(
    employeeId: string,
    input: EventInput,
    attachmentFile?: File,
    onUploadProgress?: EventUploadProgressHandler,
    expectedVersion?: number,
  ): ServiceResult<Employee>;
  uploadAttachment(
    employeeId: string,
    file: File,
    onUploadProgress?: EventUploadProgressHandler,
    expectedVersion?: number,
  ): ServiceResult<Employee>;
  getEventAttachmentUrl(employeeId: string, eventId: string, attachmentId: string): ServiceResult<EventAttachmentView>;
  getAttachmentUrl(employeeId: string, attachmentId: string): ServiceResult<AttachmentView>;
  getMonthlyAssessmentOverview(filters: MonthlyAssessmentFilters): ServiceResult<MonthlyAssessmentOverview>;
  getMonthlyAssessment(employeeId: string, monthKey: string): ServiceResult<MonthlyAssessmentRecord>;
  saveMonthlyAssessment(input: MonthlyAssessmentSaveInput): ServiceResult<MonthlyAssessmentRecord>;
  recordAudit(input: AuditLogInput): ServiceResult<AuditLog>;
  listAuditLogs(filters?: Partial<AuditFilters>): AuditLog[];
}

export interface MonthlyAssessmentService {
  getMonthlyAssessmentOverview(filters: MonthlyAssessmentFilters): ServiceResult<MonthlyAssessmentOverview> | Promise<ServiceResult<MonthlyAssessmentOverview>>;
  getMonthlyAssessment(employeeId: string, monthKey: string): ServiceResult<MonthlyAssessmentRecord> | Promise<ServiceResult<MonthlyAssessmentRecord>>;
  saveMonthlyAssessment(input: MonthlyAssessmentSaveInput): ServiceResult<MonthlyAssessmentRecord> | Promise<ServiceResult<MonthlyAssessmentRecord>>;
}

const LOCAL_ACTOR_ID = "preview-admin";
const LOCAL_ACTOR_NAME = "体验模式管理员";

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const EVENT_ATTACHMENT_MAX_BYTES = ATTACHMENT_MAX_BYTES;
export const EVENT_ATTACHMENT_MIME_TYPES = ATTACHMENT_MIME_TYPES;
export type EventUploadProgressHandler = (progress: number) => void;

function validateImageAttachment(file: File, label: string): string | null {
  if (!ATTACHMENT_MIME_TYPES.includes(file.type as (typeof ATTACHMENT_MIME_TYPES)[number])) {
    return `${label}仅支持 JPG、PNG、WEBP 或 GIF 格式。`;
  }
  if (file.size <= 0) {
    return `${label}内容为空，请重新选择文件。`;
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `${label}不能超过 10 MB。`;
  }
  return null;
}

export function validateEventAttachment(file: File): string | null {
  return validateImageAttachment(file, "事件图片");
}

export function validateAttachment(file: File): string | null {
  return validateImageAttachment(file, "员工附件图片");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const MONTHLY_ASSESSMENT_METRICS = ["meeting", "renewalRate", "influence", "visits", "nineGrid"] as const;

function emptyMonthlyResults() {
  return {
    meeting: "unassessed" as const,
    renewalRate: "unassessed" as const,
    influence: "unassessed" as const,
    visits: "unassessed" as const,
    nineGrid: "unassessed" as const,
  };
}

function emptyMonthlyStats() {
  const metrics = MONTHLY_ASSESSMENT_METRICS.reduce((result, metric) => {
    result[metric] = { achieved: 0, not_achieved: 0, unassessed: 0, achievementRate: null };
    return result;
  }, {} as Record<(typeof MONTHLY_ASSESSMENT_METRICS)[number], { achieved: number; not_achieved: number; unassessed: number; achievementRate: number | null }>);
  return {
    eligibleActiveCount: 0,
    fullyEvaluatedCount: 0,
    partiallyEvaluatedCount: 0,
    unassessedCount: 0,
    metrics,
  };
}

export function filterAuditLogs(logs: readonly AuditLog[], filters: Partial<AuditFilters> = {}): AuditLog[] {
  const name = filters.employeeName?.trim().toLowerCase() ?? "";
  const targetId = filters.targetId?.trim() ?? "";
  return logs.filter((log) => {
    const matchesAction = !filters.action || filters.action === "all" || log.action === filters.action;
    const matchesResult = !filters.result || filters.result === "all" || log.result === filters.result;
    const matchesTarget = !targetId || log.targetId === targetId;
    const matchesName = !name || (log.targetNameSnapshot ?? "").toLowerCase().includes(name);
    return matchesAction && matchesResult && matchesTarget && matchesName;
  });
}

function buildAuditListPayload(filters: Partial<AuditFilters>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    action: filters.action ?? "all",
    result: filters.result ?? "all",
    employeeName: filters.employeeName?.trim() ?? "",
  };
  const targetId = filters.targetId?.trim();
  if (targetId) payload.targetId = targetId;
  return payload;
}

function success<T>(data: T): ServiceResult<T> {
  return { ok: true, data: clone(data) };
}

function failure(message: string, field?: EmployeeDraft | CourseInput | EventInput): ServiceResult<never> {
  if (field) {
    return { ok: false, message };
  }
  return { ok: false, message };
}

function dateAtOffset(days: number): string {
  return formatDateOnly(addDays(new Date(), days));
}

function dateYearsAgo(years: number, additionalDays = 0): string {
  return formatDateOnly(addDays(addYears(new Date(), -years), additionalDays));
}

function makeSeedEmployees(): Employee[] {
  // Entire records are synthesized for the showcase, not anonymized business rows.
  const now = new Date().toISOString();
  return Array.from({ length: 6 }, (_, index): Employee => {
    const number = 1001 + index;
    const former = index === 3;
    return {
      id: `emp-${number}`, version: 1,
      sourceSheet: null, sourceRow: null, sourceSequence: null,
      name: ["示例员工甲", "示例员工乙", "示例员工丙", "示例员工丁", "示例员工戊", "示例员工己"][index],
      status: former ? "former" : "active",
      department: ["演示研发组", "演示支持组", "演示综合组"][index % 3],
      onlyChildStatus: "未填写", personalPhone: index === 2 ? "" : `13800009${100 + index}`,
      workPhone: "", phonePlan: "虚构演示", phoneOwnership: "个人", computerOwnership: "演示设备",
      hireDate: dateYearsAgo(2, index * 7), regularizationDate: dateYearsAgo(2, 90 + index * 7),
      notes: "此档案从空白模板生成，仅供本地展示，没有真实员工来源。",
      contract: index === 5 ? null : { id: `contract-${number}`, type: "演示合同", startDate: dateAtOffset(-120), endDate: dateAtOffset(former ? -30 : index === 0 ? 10 : 150 + index * 30), notes: "虚构日期及合同类型，不含真实条款。" },
      vehicle: index === 0 || index === 4 ? { id: `vehicle-${number}`, model: "演示车辆", plateNumber: `虚构号牌-${index + 1}`, startDate: dateAtOffset(-60), endDate: dateAtOffset(120 + index * 10), notes: "此标识不是合法车牌。" } : null,
      courseRecords: index === 0 ? [{ id: "demo-course-1", courseName: "虚构工具入门", status: "completed", attendedDate: dateAtOffset(-20), note: "重新编写的演示学习记录。" }] : [],
      events: index === 0 ? [{ id: "demo-event-1", eventDate: dateAtOffset(-7), eventType: "演示记录", summary: "本地示例流程练习", detail: "此事件完全虚构。" }] : [],
      attachments: [], createdAt: now, updatedAt: now,
    };
  });
}

function getDraftDateError(label: string, value: string): string | null {
  if (value && !isValidDateOnly(value)) {
    return `${label}必须使用 YYYY-MM-DD 格式。`;
  }
  return null;
}

function validateDraft(draft: EmployeeDraft, employees: Employee[], currentId?: string): ServiceResult<true> {
  if (!draft.name.trim()) {
    return failure("请填写员工姓名。") as ServiceResult<true>;
  }
  if (!draft.department.trim()) {
    return failure("请填写部门或分组。") as ServiceResult<true>;
  }

  const duplicate = employees.find(
    (employee) => employee.id !== currentId && employee.name.trim() === draft.name.trim(),
  );
  if (duplicate) {
    return failure(`已存在同名员工“${duplicate.name}”，请确认不是重复档案。`) as ServiceResult<true>;
  }

  const dateFields: Array<[string, string]> = [
    ["入职日期", draft.hireDate],
    ["转正日期", draft.regularizationDate],
    ["合同开始日期", draft.contractStartDate],
    ["合同结束日期", draft.contractEndDate],
    ["车辆开始日期", draft.vehicleStartDate],
    ["车辆结束日期", draft.vehicleEndDate],
  ];
  for (const [label, value] of dateFields) {
    const error = getDraftDateError(label, value);
    if (error) {
      return failure(error) as ServiceResult<true>;
    }
  }

  if (draft.hireDate && draft.regularizationDate && draft.regularizationDate < draft.hireDate) {
    return failure("转正日期不能早于入职日期。") as ServiceResult<true>;
  }
  if (
    draft.contractStartDate &&
    draft.contractEndDate &&
    draft.contractEndDate < draft.contractStartDate
  ) {
    return failure("合同结束日期不能早于开始日期。") as ServiceResult<true>;
  }
  if (draft.vehicleStartDate && draft.vehicleEndDate && draft.vehicleEndDate < draft.vehicleStartDate) {
    return failure("车辆使用结束日期不能早于开始日期。") as ServiceResult<true>;
  }
  return { ok: true, data: true };
}

function normalizeStudentPhone(value: string): string {
  let phoneNumber = value.normalize("NFKC").trim().replace(/[\s\-‐‑‒–—―]/g, "");
  if (phoneNumber.startsWith("+86")) phoneNumber = phoneNumber.slice(3);
  return phoneNumber;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function draftToEmployee(draft: EmployeeDraft, id: string, current?: Employee): Employee {
  const now = new Date().toISOString();
  const hasContract = Boolean(draft.contractType || draft.contractStartDate || draft.contractEndDate || draft.contractNotes);
  const hasVehicle = Boolean(
    draft.vehicleModel ||
      draft.vehiclePlateNumber ||
      draft.vehicleStartDate ||
      draft.vehicleEndDate ||
      draft.vehicleNotes,
  );

  return {
    id,
    version: current?.version ?? 1,
    sourceSheet: current?.sourceSheet ?? null,
    sourceRow: current?.sourceRow ?? null,
    sourceSequence: current?.sourceSequence ?? null,
    name: draft.name.trim(),
    status: draft.status,
    department: draft.department.trim(),
    onlyChildStatus: current?.onlyChildStatus ?? "未整理",
    personalPhone: draft.personalPhone.trim(),
    workPhone: draft.workPhone.trim(),
    phonePlan: draft.phonePlan.trim(),
    phoneOwnership: draft.phoneOwnership.trim(),
    computerOwnership: draft.computerOwnership.trim(),
    hireDate: draft.hireDate,
    regularizationDate: draft.regularizationDate,
    notes: draft.notes.trim(),
    contract: hasContract
      ? {
          id: current?.contract?.id ?? `${id}-contract`,
          type: draft.contractType.trim() || "当前合同",
          startDate: draft.contractStartDate,
          endDate: draft.contractEndDate,
          notes: draft.contractNotes.trim(),
        }
      : null,
    vehicle: hasVehicle
      ? {
          id: current?.vehicle?.id ?? `${id}-vehicle`,
          model: draft.vehicleModel.trim(),
          plateNumber: draft.vehiclePlateNumber.trim(),
          startDate: draft.vehicleStartDate,
          endDate: draft.vehicleEndDate,
          notes: draft.vehicleNotes.trim(),
        }
      : null,
    courseRecords: current?.courseRecords ?? [],
    events: current?.events ?? [],
    attachments: current?.attachments ?? [],
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
}

function toCloudEmployeePayload(draft: EmployeeDraft): Record<string, unknown> {
  const {
    contractType,
    contractStartDate,
    contractEndDate,
    contractNotes,
    vehicleModel,
    vehiclePlateNumber,
    vehicleStartDate,
    vehicleEndDate,
    vehicleNotes,
    ...employeeFields
  } = draft;
  const hasContract = Boolean(contractType || contractStartDate || contractEndDate || contractNotes);
  const hasVehicle = Boolean(
    vehicleModel || vehiclePlateNumber || vehicleStartDate || vehicleEndDate || vehicleNotes,
  );

  return {
    ...employeeFields,
    contract: hasContract
      ? {
          type: contractType.trim() || "当前合同",
          startDate: contractStartDate,
          endDate: contractEndDate,
          notes: contractNotes.trim(),
        }
      : null,
    vehicle: hasVehicle
      ? {
          model: vehicleModel.trim(),
          plateNumber: vehiclePlateNumber.trim(),
          startDate: vehicleStartDate,
          endDate: vehicleEndDate,
          notes: vehicleNotes.trim(),
        }
      : null,
  };
}

export function employeeToDraft(employee: Employee): EmployeeDraft {
  return {
    name: employee.name,
    status: employee.status,
    department: employee.department,
    personalPhone: employee.personalPhone,
    workPhone: employee.workPhone,
    phonePlan: employee.phonePlan,
    phoneOwnership: employee.phoneOwnership,
    computerOwnership: employee.computerOwnership,
    hireDate: employee.hireDate,
    regularizationDate: employee.regularizationDate,
    notes: employee.notes,
    contractType: employee.contract?.type ?? "",
    contractStartDate: employee.contract?.startDate ?? "",
    contractEndDate: employee.contract?.endDate ?? "",
    contractNotes: employee.contract?.notes ?? "",
    vehicleModel: employee.vehicle?.model ?? "",
    vehiclePlateNumber: employee.vehicle?.plateNumber ?? "",
    vehicleStartDate: employee.vehicle?.startDate ?? "",
    vehicleEndDate: employee.vehicle?.endDate ?? "",
    vehicleNotes: employee.vehicle?.notes ?? "",
  };
}

export function getEmployeeAttention(employee: Employee): string[] {
  const attention: string[] = [];
  if (employee.contract && getExpiryStatus(employee.contract.endDate) !== "normal") {
    attention.push("合同");
  }
  if (employee.vehicle && getExpiryStatus(employee.vehicle.endDate) !== "normal") {
    attention.push("车辆");
  }
  if (!employee.department || !employee.personalPhone || !employee.hireDate) {
    attention.push("资料缺失");
  }
  return attention;
}

export function getEmployeeChangedFields(before: Employee, after: Employee): string[] {
  const pairs: Array<[string, string, string]> = [
    ["姓名", before.name, after.name],
    ["状态", before.status, after.status],
    ["部门", before.department, after.department],
    ["个人手机号", before.personalPhone, after.personalPhone],
    ["工作电话", before.workPhone, after.workPhone],
    ["入职日期", before.hireDate, after.hireDate],
    ["转正日期", before.regularizationDate, after.regularizationDate],
    ["合同结束日期", before.contract?.endDate ?? "", after.contract?.endDate ?? ""],
    ["车辆车牌", before.vehicle?.plateNumber ?? "", after.vehicle?.plateNumber ?? ""],
  ];
  return pairs.filter(([, oldValue, newValue]) => oldValue !== newValue).map(([label]) => label);
}

export class LocalPreviewDataService implements EmployeeDataService {
  readonly mode = "local-preview" as const;
  private employees: Employee[] = makeSeedEmployees();
  private students: StudentProfile[] = [];
  private readonly studentPhones = new Map<string, string>();
  private auditLogs: AuditLog[] = [];
  private sequence = 1100;

  getCurrentAccount(): AccountProfile {
    return {
      accountId: LOCAL_ACTOR_ID,
      username: "development-preview",
      displayName: LOCAL_ACTOR_NAME,
      scope: "all",
      role: "super_admin",
      permissions: ["employee.write", "history.write", "attachment.read", "attachment.write", "audit.read", "monthly_assessment_edit", "quarterly.manage"],
      status: "active",
    };
  }

  listEmployees(filters: EmployeeFilters): Employee[] {
    const search = filters.search.trim().toLowerCase();
    return clone(
      this.employees.filter((employee) => {
        const searchable = `${employee.name} ${employee.department} ${employee.personalPhone} ${employee.workPhone} ${employee.id}`.toLowerCase();
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
      }),
    );
  }

  listStudents(): StudentProfile[] {
    return clone(this.students);
  }

  getStudent(studentId: string): StudentDetail | undefined {
    const student = this.students.find((item) => item.id === studentId);
    const phoneNumber = this.studentPhones.get(studentId);
    return student && phoneNumber ? { ...clone(student), phoneNumber } : undefined;
  }

  getEmployee(employeeId: string): Employee | undefined {
    const employee = this.employees.find((item) => item.id === employeeId);
    return employee ? clone(employee) : undefined;
  }

  getDepartments(): string[] {
    return Array.from(new Set(this.employees.map((employee) => employee.department).filter(Boolean))).sort();
  }

  createEmployee(draft: EmployeeDraft): ServiceResult<Employee> {
    const validation = validateDraft(draft, this.employees);
    if (!validation.ok) {
      return validation;
    }
    const normalizedPhone = normalizeStudentPhone(draft.personalPhone);
    if (normalizedPhone && this.hasStudentPhone(normalizedPhone)) return failure("该个人手机号已登记为学员手机号，无法保存员工档案。");
    const id = `emp-${this.sequence}`;
    this.sequence += 1;
    const employee = draftToEmployee(draft, id);
    this.employees.unshift(employee);
    return success(employee);
  }

  createStudent(draft: StudentDraft): ServiceResult<StudentProfile> {
    const name = draft.name.trim();
    const phoneNumber = normalizeStudentPhone(draft.phoneNumber);
    if (name.length < 2 || name.length > 64 || hasControlCharacters(name)) return failure("请填写有效的学员姓名。");
    if (!/^1[3-9]\d{9}$/.test(phoneNumber)) return failure("请填写有效的本人手机号。");
    if (this.hasStudentPhone(phoneNumber) || this.hasEmployeePhone(phoneNumber)) return failure("该手机号已登记，无法重复建档。");
    const now = new Date().toISOString();
    const student: StudentProfile = {
      id: `stu-${this.sequence++}`,
      recordType: "student",
      name,
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.studentPhones.set(student.id, phoneNumber);
    this.students.unshift(student);
    return success(clone(student));
  }

  updateStudent(studentId: string, draft: StudentDraft, expectedVersion?: number): ServiceResult<StudentProfile> {
    const currentIndex = this.students.findIndex((student) => student.id === studentId);
    if (currentIndex < 0) return failure("未找到要编辑的学员档案。");
    const current = this.students[currentIndex];
    if (expectedVersion !== undefined && current.version !== expectedVersion) return failure("该学员档案已被其他账号更新，请刷新后再保存。");
    const name = draft.name.trim();
    const phoneNumber = normalizeStudentPhone(draft.phoneNumber);
    if (name.length < 2 || name.length > 64 || hasControlCharacters(name)) return failure("请填写有效的学员姓名。");
    if (!/^1[3-9]\d{9}$/.test(phoneNumber)) return failure("请填写有效的本人手机号。");
    if (this.hasStudentPhone(phoneNumber, studentId) || this.hasEmployeePhone(phoneNumber)) return failure("该手机号已登记，无法重复建档。");
    const updated: StudentProfile = { ...current, name, version: current.version + 1, updatedAt: new Date().toISOString() };
    this.students[currentIndex] = updated;
    this.studentPhones.set(studentId, phoneNumber);
    return success(clone(updated));
  }

  archiveStudent(studentId: string, expectedVersion?: number): ServiceResult<StudentProfile> {
    return this.setStudentStatus(studentId, "inactive", expectedVersion);
  }

  restoreStudent(studentId: string, expectedVersion?: number): ServiceResult<StudentProfile> {
    return this.setStudentStatus(studentId, "active", expectedVersion);
  }

  private setStudentStatus(studentId: string, status: StudentProfile["status"], expectedVersion?: number): ServiceResult<StudentProfile> {
    const currentIndex = this.students.findIndex((student) => student.id === studentId);
    if (currentIndex < 0) return failure("未找到要维护的学员档案。");
    const current = this.students[currentIndex];
    if (expectedVersion !== undefined && current.version !== expectedVersion) return failure("该学员档案已被其他账号更新，请刷新后再保存。");
    if (status === "active") {
      const phoneNumber = this.studentPhones.get(studentId) ?? "";
      if (this.hasStudentPhone(phoneNumber, studentId) || this.hasEmployeePhone(phoneNumber)) return failure("该手机号已登记，无法恢复学员档案。");
    }
    const updated: StudentProfile = { ...current, status, version: current.version + 1, updatedAt: new Date().toISOString() };
    this.students[currentIndex] = updated;
    return success(clone(updated));
  }

  private hasStudentPhone(phoneNumber: string, excludedStudentId = ""): boolean {
    return [...this.studentPhones].some(([studentId, existingPhone]) => studentId !== excludedStudentId && existingPhone === phoneNumber);
  }

  private hasEmployeePhone(phoneNumber: string): boolean {
    return this.employees.some((employee) => normalizeStudentPhone(employee.personalPhone) === phoneNumber);
  }

  updateEmployee(employeeId: string, draft: EmployeeDraft): ServiceResult<Employee> {
    const currentIndex = this.employees.findIndex((employee) => employee.id === employeeId);
    if (currentIndex < 0) {
      return failure("未找到要编辑的员工档案。");
    }
    const validation = validateDraft(draft, this.employees, employeeId);
    if (!validation.ok) {
      return validation;
    }
    const normalizedPhone = normalizeStudentPhone(draft.personalPhone);
    if (normalizedPhone && this.hasStudentPhone(normalizedPhone)) return failure("该个人手机号已登记为学员手机号，无法保存员工档案。");
    const current = this.employees[currentIndex];
    const updated = draftToEmployee(draft, employeeId, current);
    this.employees[currentIndex] = updated;
    return success(updated);
  }

  archiveEmployee(): ServiceResult<Employee> {
    return failure("当前为体验模式，不能执行真实员工归档；请切换到正式账号后重试。");
  }

  addCourseRecord(employeeId: string, input: CourseInput): ServiceResult<Employee> {
    const employee = this.employees.find((item) => item.id === employeeId);
    if (!employee) {
      return failure("未找到要添加课程记录的员工。");
    }
    if (!input.courseName.trim()) {
      return failure("请填写课程名称。");
    }
    if (input.attendedDate && !isValidDateOnly(input.attendedDate)) {
      return failure("课程日期必须使用 YYYY-MM-DD 格式。");
    }
    employee.courseRecords.push({
      id: `${employeeId}-course-${this.sequence}`,
      courseName: input.courseName.trim(),
      status: input.status,
      attendedDate: input.attendedDate,
      note: input.note.trim(),
    });
    employee.updatedAt = new Date().toISOString();
    this.sequence += 1;
    return success(employee);
  }

  addEventRecord(employeeId: string, input: EventInput, attachmentFile?: File, _onUploadProgress?: EventUploadProgressHandler, _expectedVersion?: number): ServiceResult<Employee> {
    void employeeId;
    void input;
    void _onUploadProgress;
    void _expectedVersion;
    if (attachmentFile) {
      return failure("当前为体验模式，不能保存事件图片；请切换到正式账号后重试。");
    }
    const employee = this.employees.find((item) => item.id === employeeId);
    if (!employee) {
      return failure("未找到要添加事件记录的员工。");
    }
    if (!input.summary.trim()) {
      return failure("请填写事件摘要。");
    }
    if (input.eventDate && !isValidDateOnly(input.eventDate)) {
      return failure("事件日期必须使用 YYYY-MM-DD 格式。");
    }
    employee.events.push({
      id: `${employeeId}-event-${this.sequence}`,
      eventDate: input.eventDate,
      eventType: input.eventType.trim() || "工作说明",
      summary: input.summary.trim(),
      detail: input.detail.trim(),
    });
    employee.updatedAt = new Date().toISOString();
    this.sequence += 1;
    return success(employee);
  }

  uploadAttachment(_employeeId?: string, _file?: File, _onUploadProgress?: EventUploadProgressHandler, _expectedVersion?: number): ServiceResult<Employee> {
    void _employeeId;
    void _file;
    void _onUploadProgress;
    void _expectedVersion;
    return failure("当前为体验模式，不能上传员工附件；请切换到正式账号后重试。");
  }

  getEventAttachmentUrl(): ServiceResult<EventAttachmentView> {
    return failure("当前为体验模式，不能查看事件图片；请切换到正式账号后重试。");
  }

  getAttachmentUrl(): ServiceResult<AttachmentView> {
    return failure("当前为体验模式，不能查看员工附件；请切换到正式账号后重试。");
  }

  getMonthlyAssessmentOverview(filters: MonthlyAssessmentFilters): ServiceResult<MonthlyAssessmentOverview> {
    return success({
      items: [],
      page: filters.page && filters.page > 0 ? filters.page : 1,
      pageSize: filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 50,
      total: 0,
      stats: emptyMonthlyStats(),
    });
  }

  getMonthlyAssessment(employeeId: string, monthKey: string): ServiceResult<MonthlyAssessmentRecord> {
    return success({
      inScope: false,
      employeeId,
      monthKey,
      employeeName: "",
      department: "",
      employmentStatus: null,
      hasRecord: false,
      results: emptyMonthlyResults(),
      note: "",
      version: 0,
      filledCount: 0,
    });
  }

  saveMonthlyAssessment(input: MonthlyAssessmentSaveInput): ServiceResult<MonthlyAssessmentRecord> {
    void input;
    return failure("当前为体验模式，暂不能保存月度考核；请切换到正式账号后重试。");
  }

  recordAudit(input: AuditLogInput): ServiceResult<AuditLog> {
    const log: AuditLog = {
      id: `audit-${this.sequence}`,
      actorAccountId: LOCAL_ACTOR_ID,
      actorNameSnapshot: LOCAL_ACTOR_NAME,
      action: input.action,
      targetType: input.targetId ? "employee" : "session",
      targetId: input.targetId ?? null,
      targetNameSnapshot: input.targetName ?? null,
      changedFields: input.changedFields ?? [],
      before: input.before ?? null,
      after: input.after ?? null,
      result: input.result ?? "success",
      detail: input.detail,
      createdAt: new Date().toISOString(),
    };
    this.sequence += 1;
    this.auditLogs.unshift(log);
    return success(log);
  }

  listAuditLogs(filters: Partial<AuditFilters> = {}): AuditLog[] {
    return clone(filterAuditLogs(this.auditLogs, filters));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Keep these exact messages aligned with the quarterly backend and preview service.
// Never replace this allowlist with a keyword or substring match.
const QUARTERLY_USER_FACING_ERRORS = new Set([
  "季度填写截止时间已到，不能再填写。",
  "季度截止时间配置无效，暂不能填写，请联系管理员。",
  "季度周期当前未开放填写。",
  "该季度评价任务已撤销。",
  "自评必须先绑定本人员工身份。",
  "自评只能评价当前账号绑定的本人员工。",
  "当前账号身份已变化，请刷新后重试。",
  "季度评价任务已发生变化，请刷新后重试。",
  "季度周期已发生变化，请刷新后重试。",
]);

export function toUserFacingServiceError(error: unknown, fallback: string): string {
  const raw = error instanceof Error
    ? error.message.trim()
    : typeof error === "string"
      ? error.trim()
      : isRecord(error) && typeof error.message === "string"
        ? error.message.trim()
        : "";
  if (!raw) return fallback;
  if (/(CloudBase|employeeArchiveApi|TCB_|CLOUDBASE_|SDK|expectedVersion|storageKey|mimeType|authUid|requestId|响应中的|字段|集合|NOT_IMPLEMENTED|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b)/i.test(raw)) {
    return fallback;
  }
  if (/(token|secret|credential|authorization|bearer\s|api[_-]?key|access[_-]?key|private[_-]?key|password\s*[:=]|密码\s*[:：=]|密钥|凭证)/i.test(raw)) {
    return fallback;
  }
  if (QUARTERLY_USER_FACING_ERRORS.has(raw)) return raw;
  if (raw === "操作日志缺少有效编号，请联系管理员。") return raw;
  if (/(未授权|无权限|没有权限|禁止访问|forbidden|unauthori[sz]ed)/i.test(raw)) {
    return "当前账号没有执行此操作的权限，请联系管理员。";
  }
  if (/(已被其他账号更新|版本冲突|并发冲突|outdated|conflict)/i.test(raw)) {
    return "这条记录已被其他人更新，请刷新后重试。";
  }
  if (/(未找到|找不到|不存在|not found)/i.test(raw)) {
    return "未找到相关记录，请刷新后重试。";
  }
  if (/(请填写|不能为空|必填|缺少)/i.test(raw)) {
    return "请补充必填信息后重试。";
  }
  if (/(格式|不能超过|大小|图片|附件|文件)/i.test(raw)) {
    return "填写内容或附件不符合要求，请检查后重试。";
  }
  if (/(已停用|已关闭|不允许|不能)/i.test(raw)) {
    return "当前记录状态不允许此操作，请刷新后重试。";
  }
  return raw;
}

function getCloudFunctionPayload(response: unknown): unknown {
  const outer = isRecord(response) ? response : {};
  const nested = outer.result;
  if (isRecord(nested) && "data" in nested) return nested.data;
  if (nested !== undefined && nested !== null) return nested;
  if ("data" in outer) return outer.data;
  return response;
}

function getCloudFunctionError(response: unknown): string {
  const outer = isRecord(response) ? response : {};
  const result = isRecord(outer.result) ? outer.result : undefined;
  const error = result?.error ?? outer.error;
  return toUserFacingServiceError(error, "系统暂时无法完成此操作，请稍后重试。");
}

function unwrapCloudFunctionResponse(response: unknown): unknown {
  const payload = getCloudFunctionPayload(response);
  const outer = isRecord(response) ? response : {};
  const result = isRecord(outer.result) ? outer.result : undefined;
  const ok = result?.ok ?? outer.ok;
  if (ok === false || outer.error !== undefined || result?.error !== undefined) {
    throw new Error(getCloudFunctionError(response));
  }
  return payload;
}

function asEmployee(value: unknown): Employee {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("员工档案暂时无法读取，请刷新后重试。");
  }
  return { ...value, version: typeof value.version === "number" && Number.isFinite(value.version) ? value.version : 1 } as unknown as Employee;
}

function asStudentProfile(value: unknown): StudentProfile {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    throw new Error("学员档案暂时无法读取，请刷新后重试。");
  }
  return {
    id: value.id,
    recordType: "student",
    name: value.name,
    status: value.status === "inactive" ? "inactive" : "active",
    version: typeof value.version === "number" && Number.isFinite(value.version) && value.version > 0 ? value.version : 1,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

function asStudentDetail(value: unknown): StudentDetail {
  if (!isRecord(value) || typeof value.phoneNumber !== "string") {
    throw new Error("学员档案详情暂时无法读取，请刷新后重试。");
  }
  return { ...asStudentProfile(value), phoneNumber: value.phoneNumber };
}

function asAuditLog(value: unknown): AuditLog {
  if (!isRecord(value)) throw new Error("未返回有效操作日志。");
  return value as unknown as AuditLog;
}

const MONTHLY_RESULT_VALUES = new Set(["achieved", "not_achieved", "unassessed"] as const);

function asMonthlyResults(value: unknown) {
  if (!isRecord(value)) throw new Error("未返回有效月度考核结果。");
  const results = {
    meeting: value.meeting,
    renewalRate: value.renewalRate,
    influence: value.influence,
    visits: value.visits,
    nineGrid: value.nineGrid,
  };
  for (const metric of MONTHLY_ASSESSMENT_METRICS) {
    const status = results[metric];
    if (typeof status !== "string" || !MONTHLY_RESULT_VALUES.has(status as "achieved" | "not_achieved" | "unassessed")) {
      throw new Error("未返回有效月度考核结果。");
    }
  }
  return {
    meeting: results.meeting as "achieved" | "not_achieved" | "unassessed",
    renewalRate: results.renewalRate as "achieved" | "not_achieved" | "unassessed",
    influence: results.influence as "achieved" | "not_achieved" | "unassessed",
    visits: results.visits as "achieved" | "not_achieved" | "unassessed",
    nineGrid: results.nineGrid as "achieved" | "not_achieved" | "unassessed",
  };
}

function asMonthlyRecord(value: unknown): MonthlyAssessmentRecord {
  if (!isRecord(value) || typeof value.employeeId !== "string" || typeof value.monthKey !== "string") {
    throw new Error("未返回有效月度考核记录。");
  }
  const employmentStatus = value.employmentStatus === "active" || value.employmentStatus === "former" || value.employmentStatus === "archived"
    ? value.employmentStatus
    : null;
  return {
    inScope: value.inScope === true,
    employeeId: value.employeeId,
    monthKey: value.monthKey,
    employeeName: typeof value.employeeName === "string" ? value.employeeName : "",
    department: typeof value.department === "string" ? value.department : "",
    employmentStatus,
    hasRecord: value.hasRecord === true,
    results: asMonthlyResults(value.results),
    note: typeof value.note === "string" ? value.note : "",
    version: typeof value.version === "number" && Number.isInteger(value.version) && value.version >= 0 ? value.version : 0,
    filledCount: typeof value.filledCount === "number" && Number.isInteger(value.filledCount) && value.filledCount >= 0 ? value.filledCount : 0,
  };
}

function asMonthlyOverviewItem(value: unknown) {
  const record = asMonthlyRecord(value);
  if (!record.inScope || !record.employmentStatus) throw new Error("未返回有效月度考核员工范围。");
  return {
    ...record,
    inScope: true as const,
    employmentStatus: record.employmentStatus,
  };
}

function asMonthlyMetricStats(value: unknown) {
  if (!isRecord(value)) throw new Error("未返回有效月度考核统计。");
  const toCount = (candidate: unknown): number => typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
  const rate = value.achievementRate;
  if (rate !== null && (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1)) {
    throw new Error("未返回有效月度考核达成率。");
  }
  return {
    achieved: toCount(value.achieved),
    not_achieved: toCount(value.not_achieved),
    unassessed: toCount(value.unassessed),
    achievementRate: rate as number | null,
  };
}

function asMonthlyOverview(value: unknown): MonthlyAssessmentOverview {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.stats)) {
    throw new Error("未返回有效月度考核总览。");
  }
  const statsSource = value.stats;
  const metricStats = {
    meeting: asMonthlyMetricStats(statsSource.metrics && isRecord(statsSource.metrics) ? statsSource.metrics.meeting : undefined),
    renewalRate: asMonthlyMetricStats(statsSource.metrics && isRecord(statsSource.metrics) ? statsSource.metrics.renewalRate : undefined),
    influence: asMonthlyMetricStats(statsSource.metrics && isRecord(statsSource.metrics) ? statsSource.metrics.influence : undefined),
    visits: asMonthlyMetricStats(statsSource.metrics && isRecord(statsSource.metrics) ? statsSource.metrics.visits : undefined),
    nineGrid: asMonthlyMetricStats(statsSource.metrics && isRecord(statsSource.metrics) ? statsSource.metrics.nineGrid : undefined),
  };
  const toCount = (candidate: unknown): number => typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
  return {
    items: value.items.map(asMonthlyOverviewItem),
    page: toCount(value.page) || 1,
    pageSize: toCount(value.pageSize) || 50,
    total: toCount(value.total),
    stats: {
      eligibleActiveCount: toCount(statsSource.eligibleActiveCount),
      fullyEvaluatedCount: toCount(statsSource.fullyEvaluatedCount),
      partiallyEvaluatedCount: toCount(statsSource.partiallyEvaluatedCount),
      unassessedCount: toCount(statsSource.unassessedCount),
      metrics: metricStats,
    },
  };
}

export function asAccountProfile(value: unknown): AccountProfile {
  const source = isRecord(value) && isRecord(value.account) ? value.account : value;
  if (!isRecord(source)) throw new Error("未返回有效账号资料。");
  const username = typeof source.username === "string" ? source.username.trim() : "";
  const displayName = typeof source.displayName === "string" ? source.displayName.trim() : "";
  if (!username || !displayName) throw new Error("账号资料不完整。");
  const role = source.role === "super_admin" || source.role === "admin" || source.role === "user" ? source.role : "user";
  const permissions = Array.isArray(source.permissions)
    ? source.permissions.filter((permission): permission is AccountPermission => typeof permission === "string" && ACCOUNT_PERMISSIONS.has(permission as AccountPermission))
    : [];
  return {
    accountId: typeof source.accountId === "string" ? source.accountId : undefined,
    username,
    displayName,
    scope: source.scope === "self" ? "self" : "all",
    role,
    permissions,
    status: source.status === "disabled" ? "disabled" : "active",
    identityType: source.identityType === "student" || (typeof source.studentId === "string" && source.studentId.trim())
      ? "student"
      : source.identityType === "employee" || (typeof source.employeeId === "string" && source.employeeId.trim())
        ? "employee"
        : undefined,
    employeeId: typeof source.employeeId === "string" && source.employeeId.trim() ? source.employeeId : null,
    employeeNameSnapshot: typeof source.employeeNameSnapshot === "string" && source.employeeNameSnapshot.trim() ? source.employeeNameSnapshot : null,
    studentId: typeof source.studentId === "string" && source.studentId.trim() ? source.studentId : null,
    studentNameSnapshot: typeof source.studentNameSnapshot === "string" && source.studentNameSnapshot.trim() ? source.studentNameSnapshot : null,
  };
}

function asAttachmentView(value: unknown): AttachmentView {
  if (!isRecord(value) || typeof value.url !== "string" || !value.url.trim()) {
    throw new Error("未返回有效的附件图片地址。");
  }
  return {
    url: value.url,
    fileName: typeof value.fileName === "string" ? value.fileName : "事件图片",
    mimeType: typeof value.mimeType === "string" ? value.mimeType : "image/*",
  };
}

interface UploadedAttachment {
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
}

function safePathSegment(value: string, fallback: string): string {
  const segment = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return segment || fallback;
}

function createAttachmentToken(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function uploadEventAttachment(
  employeeId: string,
  file: File,
  onUploadProgress?: EventUploadProgressHandler,
): Promise<UploadedAttachment> {
  const validationError = validateEventAttachment(file);
  if (validationError) throw new Error(validationError);
  return uploadAttachmentFile(employeeId, file, "events", onUploadProgress);
}

async function uploadGeneralAttachment(
  employeeId: string,
  file: File,
  onUploadProgress?: EventUploadProgressHandler,
): Promise<UploadedAttachment> {
  const validationError = validateAttachment(file);
  if (validationError) throw new Error(validationError);
  return uploadAttachmentFile(employeeId, file, "attachments", onUploadProgress);
}

async function uploadAttachmentFile(
  employeeId: string,
  file: File,
  folder: "events" | "attachments",
  onUploadProgress?: EventUploadProgressHandler,
): Promise<UploadedAttachment> {
  if (!app?.uploadFile) throw new Error("图片服务暂时不可用，请稍后重试。");

  const fileName = safePathSegment(file.name, folder === "events" ? "event-image" : "attachment-image");
  const cloudPath = `employee-archive/${folder}/${safePathSegment(employeeId, "employee")}/${createAttachmentToken()}-${fileName}`;
  onUploadProgress?.(0);
  const result = await app.uploadFile({
    cloudPath,
    filePath: file.name,
    fileContent: file,
    onUploadProgress: (progress: { loaded?: number; total?: number }) => {
      if (progress.total && progress.total > 0) {
        onUploadProgress?.(Math.min(99, Math.round((progress.loaded ?? 0) * 100 / progress.total)));
      }
    },
  });
  if (!result.fileID) throw new Error("附件上传未完成，请稍后重试。");
  onUploadProgress?.(100);
  return {
    storageKey: result.fileID,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  };
}

function asEmployeeList(value: unknown): Employee[] {
  if (Array.isArray(value)) return value.map(asEmployee);
  if (isRecord(value) && Array.isArray(value.items)) return value.items.map(asEmployee);
  throw new Error("未返回有效员工列表。");
}

function asStudentList(value: unknown): StudentProfile[] {
  if (Array.isArray(value)) return value.map(asStudentProfile);
  if (isRecord(value) && Array.isArray(value.items)) return value.items.map(asStudentProfile);
  throw new Error("未返回有效学员列表。");
}

function asAuditList(value: unknown): AuditLog[] {
  if (Array.isArray(value)) return value.map(asAuditLog);
  if (isRecord(value) && Array.isArray(value.items)) return value.items.map(asAuditLog);
  throw new Error("未返回有效操作日志列表。");
}

function serviceFailure(error: unknown): ServiceResult<never> {
  return { ok: false, message: toUserFacingServiceError(error, "系统暂时无法完成此操作，请稍后重试。") };
}

export interface AsyncEmployeeDataService {
  readonly mode: "cloudbase";
  clearCache?(): void;
  getCurrentAccount(): Promise<AccountProfile>;
  listEmployees(filters: EmployeeFilters): Promise<Employee[]>;
  listStudents(): Promise<StudentProfile[]>;
  getStudent(studentId: string): Promise<StudentDetail>;
  getEmployee(employeeId: string): Promise<Employee>;
  getDepartments(): Promise<string[]>;
  createEmployee(draft: EmployeeDraft): Promise<ServiceResult<Employee>>;
  createStudent(draft: StudentDraft): Promise<ServiceResult<StudentProfile>>;
  updateStudent(studentId: string, draft: StudentDraft, expectedVersion: number): Promise<ServiceResult<StudentProfile>>;
  archiveStudent(studentId: string, expectedVersion: number): Promise<ServiceResult<StudentProfile>>;
  restoreStudent(studentId: string, expectedVersion: number): Promise<ServiceResult<StudentProfile>>;
  updateEmployee(employeeId: string, draft: EmployeeDraft, expectedVersion: number): Promise<ServiceResult<Employee>>;
  archiveEmployee(employeeId: string): Promise<ServiceResult<Employee>>;
  addCourseRecord(employeeId: string, input: CourseInput, expectedVersion: number): Promise<ServiceResult<Employee>>;
  addEventRecord(
    employeeId: string,
    input: EventInput,
    attachmentFile?: File,
    onUploadProgress?: EventUploadProgressHandler,
    expectedVersion?: number,
  ): Promise<ServiceResult<Employee>>;
  uploadAttachment(
    employeeId: string,
    file: File,
    onUploadProgress?: EventUploadProgressHandler,
    expectedVersion?: number,
  ): Promise<ServiceResult<Employee>>;
  getEventAttachmentUrl(employeeId: string, eventId: string, attachmentId: string): Promise<ServiceResult<EventAttachmentView>>;
  getAttachmentUrl(employeeId: string, attachmentId: string): Promise<ServiceResult<AttachmentView>>;
  getMonthlyAssessmentOverview(filters: MonthlyAssessmentFilters): Promise<ServiceResult<MonthlyAssessmentOverview>>;
  getMonthlyAssessment(employeeId: string, monthKey: string): Promise<ServiceResult<MonthlyAssessmentRecord>>;
  saveMonthlyAssessment(input: MonthlyAssessmentSaveInput): Promise<ServiceResult<MonthlyAssessmentRecord>>;
  recordAudit(input: AuditLogInput): Promise<ServiceResult<AuditLog>>;
  listAuditLogs(filters?: Partial<AuditFilters>): Promise<AuditLog[]>;
}

export class CloudFunctionDataService implements AsyncEmployeeDataService {
  readonly mode = "cloudbase" as const;
  private readonly imageRegistration = new ImageRegistration();
  private readonly employeeListCache = new Map<string, { promise: Promise<Employee[]>; expiresAt: number }>();

  clearCache(): void {
    this.employeeListCache.clear();
  }

  private async call(route: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!app) throw new Error("系统尚未准备好，请稍后重试。");
    const response = await app.callFunction({
      name: "employeeArchiveApi",
      data: { route, ...payload },
    });
    return unwrapCloudFunctionResponse(response);
  }

  private async registerImage(route: string, payload: Record<string, unknown>): Promise<Employee> {
    if (!app) throw new ImageRegistrationError("系统尚未准备好，尚未提交图片登记。", "not_committed");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: unknown;
    try {
      response = await Promise.race([
        app.callFunction({ name: "employeeArchiveApi", data: { route, ...payload } }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ImageRegistrationError("图片登记响应超时。", "uncertain")), 15_000);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
    const outer: unknown = response;
    const result = isRecord(outer) && isRecord(outer.result) ? outer.result : outer;
    if (isRecord(result) && result.ok === false) {
      const error = isRecord(result.error) ? result.error : {};
      const details = isRecord(error.details) ? error.details : {};
      throw new ImageRegistrationError(
        getCloudFunctionError(response),
        details.submissionOutcome === "not_committed" ? "not_committed" : "uncertain",
        typeof error.code === "string" ? error.code : undefined,
      );
    }
    if (!isRecord(result) || result.ok !== true) throw new ImageRegistrationError("图片登记响应未能确认。", "uncertain");
    const employee = asEmployee(result.data);
    if (employee.id !== payload.employeeId) throw new ImageRegistrationError("图片登记响应未能确认。", "uncertain");
    this.clearCache();
    return employee;
  }

  async getCurrentAccount(): Promise<AccountProfile> {
    return asAccountProfile(await this.call("session"));
  }

  async listEmployees(filters: EmployeeFilters): Promise<Employee[]> {
    const search = filters.search.trim();
    const employees = await this.fetchEmployeesFromCache(search, filters.status);
    return this.filterEmployees(employees, filters);
  }

  async listStudents(): Promise<StudentProfile[]> {
    return this.fetchDirectoryPages("students/list", {}, asStudentList);
  }

  private async fetchDirectoryPages<T>(route: string, filters: Record<string, unknown>, parse: (payload: unknown) => T[]): Promise<T[]> {
    const pageSize = 200;
    const collected: T[] = [];
    for (let page = 1; page <= 1000; page += 1) {
      const payload = await this.call(route, { ...filters, page, pageSize });
      const rows = parse(payload);
      collected.push(...rows);
      const total = isRecord(payload) && Number.isInteger(payload.total) && (payload.total as number) >= 0
        ? payload.total as number : null;
      if (total !== null) {
        if (collected.length >= total) return collected;
        if (rows.length < pageSize) throw new Error("读取人员列表未完成，请刷新后重试。");
      } else if (rows.length < pageSize) return collected;
    }
    throw new Error("人员列表数量过多，请缩小筛选范围后重试。");
  }

  async getStudent(studentId: string): Promise<StudentDetail> {
    return asStudentDetail(await this.call("students/get", { studentId }));
  }

  private fetchEmployeesFromCache(search: string, status: EmployeeFilters["status"]): Promise<Employee[]> {
    const cacheKey = JSON.stringify({ search, status });
    const cached = this.employeeListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const request = this.fetchEmployees(search, status);
    const cacheEntry = { promise: request, expiresAt: Number.POSITIVE_INFINITY };
    this.employeeListCache.set(cacheKey, cacheEntry);
    void request.then(
      () => {
        if (this.employeeListCache.get(cacheKey) === cacheEntry) {
          cacheEntry.expiresAt = Date.now() + EMPLOYEE_LIST_CACHE_TTL_MS;
        }
      },
      () => {
        if (this.employeeListCache.get(cacheKey) === cacheEntry) {
          this.employeeListCache.delete(cacheKey);
        }
      },
    );
    return request;
  }

  private async fetchEmployees(search: string, status: EmployeeFilters["status"]): Promise<Employee[]> {
    try {
      const employees = await this.fetchDirectoryPages("employees/list", {
        keyword: search || undefined,
        status: status === "all" ? undefined : status,
      }, asEmployeeList);
      return employees;
    } catch (error) {
      throw new Error(toUserFacingServiceError(error, "读取员工档案列表失败，请稍后重试。"));
    }
  }

  private filterEmployees(employees: Employee[], filters: EmployeeFilters): Employee[] {
    return employees.filter((employee) => {
      const matchesDepartment = filters.department === "all" || employee.department === filters.department;
      const attention = getEmployeeAttention(employee);
      const matchesAttention =
        filters.attention === "all" ||
        (filters.attention === "contract" && attention.includes("合同")) ||
        (filters.attention === "vehicle" && attention.includes("车辆")) ||
        (filters.attention === "missing" && attention.includes("资料缺失"));
      return matchesDepartment && matchesAttention;
    });
  }

  async getEmployee(employeeId: string): Promise<Employee> {
    return asEmployee(await this.call("employees/get", { employeeId }));
  }

  async getDepartments(): Promise<string[]> {
    const employees = await this.fetchEmployeesFromCache("", "all");
    return Array.from(new Set(employees.map((employee) => employee.department).filter(Boolean))).sort();
  }

  async createEmployee(draft: EmployeeDraft): Promise<ServiceResult<Employee>> {
    try {
      const response = await this.call("employees/create", toCloudEmployeePayload(draft));
      this.clearCache();
      return { ok: true, data: asEmployee(response) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async createStudent(draft: StudentDraft): Promise<ServiceResult<StudentProfile>> {
    try {
      const response = await this.call("students/create", { ...draft });
      return { ok: true, data: asStudentProfile(response) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async updateStudent(studentId: string, draft: StudentDraft, expectedVersion: number): Promise<ServiceResult<StudentProfile>> {
    try {
      const response = await this.call("students/update", { studentId, expectedVersion, ...draft });
      return { ok: true, data: asStudentProfile(response) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async archiveStudent(studentId: string, expectedVersion: number): Promise<ServiceResult<StudentProfile>> {
    try {
      const response = await this.call("students/archive", { studentId, expectedVersion });
      return { ok: true, data: asStudentProfile(response) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async restoreStudent(studentId: string, expectedVersion: number): Promise<ServiceResult<StudentProfile>> {
    try {
      const response = await this.call("students/restore", { studentId, expectedVersion });
      return { ok: true, data: asStudentProfile(response) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async updateEmployee(employeeId: string, draft: EmployeeDraft, expectedVersion: number): Promise<ServiceResult<Employee>> {
    try {
      const response = await this.call("employees/update", {
        employeeId,
        expectedVersion,
        ...toCloudEmployeePayload(draft),
      });
      this.clearCache();
      return { ok: true, data: asEmployee(response) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async archiveEmployee(employeeId: string): Promise<ServiceResult<Employee>> {
    try {
      const response = await this.call("employees/archive", { employeeId });
      this.clearCache();
      return { ok: true, data: asEmployee(response) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async addCourseRecord(employeeId: string, input: CourseInput, expectedVersion: number): Promise<ServiceResult<Employee>> {
    try {
      const response = await this.call("courses/create", { employeeId, expectedVersion, ...input });
      this.clearCache();
      return { ok: true, data: asEmployee(response) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async addEventRecord(
    employeeId: string,
    input: EventInput,
    attachmentFile?: File,
    onUploadProgress?: EventUploadProgressHandler,
    expectedVersion?: number,
  ): Promise<ServiceResult<Employee>> {
    if (!attachmentFile) {
      try {
        const response = await this.call("events/create", { employeeId, expectedVersion, ...input });
        this.clearCache();
        return { ok: true, data: asEmployee(response) };
      } catch (error) { return serviceFailure(error); }
    }
    return this.imageRegistration.submit(
      `events:${employeeId}`, attachmentFile, JSON.stringify(input),
      async () => {
        try {
          const attachment = await uploadEventAttachment(employeeId, attachmentFile, onUploadProgress);
          return { employeeId, expectedVersion, ...input, attachment };
        } catch (error) { throw new Error(toUserFacingServiceError(error, "图片上传未完成，尚未提交登记。")); }
      },
      payload => this.registerImage("events/create", payload),
    );
  }

  async uploadAttachment(
    employeeId: string,
    file: File,
    onUploadProgress?: EventUploadProgressHandler,
    expectedVersion?: number,
  ): Promise<ServiceResult<Employee>> {
    return this.imageRegistration.submit(
      `attachments:${employeeId}`, file, "",
      async () => {
        try {
          const attachment = await uploadGeneralAttachment(employeeId, file, onUploadProgress);
          return { employeeId, expectedVersion, attachment };
        } catch (error) { throw new Error(toUserFacingServiceError(error, "图片上传未完成，尚未提交登记。")); }
      },
      payload => this.registerImage("attachments/upload", payload),
    );
  }

  async getEventAttachmentUrl(
    employeeId: string,
    eventId: string,
    attachmentId: string,
  ): Promise<ServiceResult<EventAttachmentView>> {
    try {
      return {
        ok: true,
        data: asAttachmentView(await this.call("attachments/view", { employeeId, eventId, attachmentId })),
      };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async getAttachmentUrl(employeeId: string, attachmentId: string): Promise<ServiceResult<AttachmentView>> {
    try {
      return {
        ok: true,
        data: asAttachmentView(await this.call("attachments/download", { employeeId, attachmentId })),
      };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async getMonthlyAssessmentOverview(filters: MonthlyAssessmentFilters): Promise<ServiceResult<MonthlyAssessmentOverview>> {
    try {
      const payload: Record<string, unknown> = {
        monthKey: filters.monthKey,
        keyword: filters.keyword.trim(),
        department: filters.department,
        metric: filters.metric,
        metricStatus: filters.metricStatus,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 50,
      };
      return { ok: true, data: asMonthlyOverview(await this.call("monthlyAssessments/overview", payload)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async getMonthlyAssessment(employeeId: string, monthKey: string): Promise<ServiceResult<MonthlyAssessmentRecord>> {
    try {
      return { ok: true, data: asMonthlyRecord(await this.call("monthlyAssessments/get", { employeeId, monthKey })) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async saveMonthlyAssessment(input: MonthlyAssessmentSaveInput): Promise<ServiceResult<MonthlyAssessmentRecord>> {
    try {
      return { ok: true, data: asMonthlyRecord(await this.call("monthlyAssessments/save", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async recordAudit(input: AuditLogInput): Promise<ServiceResult<AuditLog>> {
    try {
      return { ok: true, data: asAuditLog(await this.call("audit/record", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async listAuditLogs(filters: Partial<AuditFilters> = {}): Promise<AuditLog[]> {
    try {
      const payload = buildAuditListPayload(filters);
      const logs: AuditLog[] = [];
      const seenLogIds = new Set<string>();
      const pageSize = 200;
      let expectedTotal: number | null = null;
      for (let page = 1; page <= 100000; page += 1) {
        const response = await this.call("audit/list", { ...payload, page, pageSize });
        const items = asAuditList(response);
        // Preserve compatibility with services that return the complete array.
        if (Array.isArray(response)) return items;
        if (!isRecord(response) || !Number.isInteger(response.total) || Number(response.total) < 0
          || response.page !== page || response.pageSize !== pageSize) {
          throw new Error("未返回有效操作日志分页信息。");
        }
        const total = Number(response.total);
        if (expectedTotal !== null && total !== expectedTotal) {
          throw new Error("操作日志在读取期间发生变化，请刷新后重试。");
        }
        expectedTotal = total;
        if (logs.length + items.length > total) {
          throw new Error("操作日志分页读取重复，请刷新后重试。");
        }
        for (const item of items) {
          if (!item.id) {
            throw new Error("操作日志缺少有效编号，请联系管理员。");
          }
          if (seenLogIds.has(item.id)) {
            throw new Error("操作日志分页读取重复，请刷新后重试。");
          }
          seenLogIds.add(item.id);
        }
        logs.push(...items);
        if (logs.length === total) return logs;
        if (items.length < pageSize) throw new Error("操作日志分页读取未完成，请稍后重试。");
      }
      throw new Error("操作日志数量过多，请缩小筛选范围后重试。");
    } catch (error) {
      throw new Error(toUserFacingServiceError(error, "读取操作日志失败，请稍后重试。"));
    }
  }
}

export class UnconfiguredCloudBaseDataService implements EmployeeDataService {
  readonly mode = "cloudbase-unconfigured" as const;

  private unavailable<T>(): ServiceResult<T> {
    return failure("当前无法使用档案数据服务，请稍后重试。") as ServiceResult<T>;
  }

  getCurrentAccount(): AccountProfile {
    return { username: "", displayName: "", scope: "all", role: "user", permissions: [], status: "active" };
  }

  listEmployees(): Employee[] {
    return [];
  }

  listStudents(): StudentProfile[] {
    return [];
  }

  getStudent(): StudentDetail | undefined {
    return undefined;
  }

  getEmployee(): Employee | undefined {
    return undefined;
  }

  getDepartments(): string[] {
    return [];
  }

  createEmployee(): ServiceResult<Employee> {
    return this.unavailable();
  }

  createStudent(): ServiceResult<StudentProfile> {
    return this.unavailable();
  }

  updateStudent(): ServiceResult<StudentProfile> {
    return this.unavailable();
  }

  archiveStudent(): ServiceResult<StudentProfile> {
    return this.unavailable();
  }

  restoreStudent(): ServiceResult<StudentProfile> {
    return this.unavailable();
  }

  updateEmployee(): ServiceResult<Employee> {
    return this.unavailable();
  }

  archiveEmployee(): ServiceResult<Employee> {
    return this.unavailable();
  }

  addCourseRecord(): ServiceResult<Employee> {
    return this.unavailable();
  }

  addEventRecord(): ServiceResult<Employee> {
    return this.unavailable();
  }

  uploadAttachment(): ServiceResult<Employee> {
    return this.unavailable();
  }

  getEventAttachmentUrl(): ServiceResult<EventAttachmentView> {
    return this.unavailable();
  }

  getAttachmentUrl(): ServiceResult<AttachmentView> {
    return this.unavailable();
  }

  getMonthlyAssessmentOverview(): ServiceResult<MonthlyAssessmentOverview> {
    return this.unavailable();
  }

  getMonthlyAssessment(): ServiceResult<MonthlyAssessmentRecord> {
    return this.unavailable();
  }

  saveMonthlyAssessment(input: MonthlyAssessmentSaveInput): ServiceResult<MonthlyAssessmentRecord> {
    void input;
    return this.unavailable();
  }

  recordAudit(): ServiceResult<AuditLog> {
    return this.unavailable();
  }

  listAuditLogs(): AuditLog[] {
    return [];
  }
}
