import {
  BriefcaseBusiness,
  CalendarDays,
  Car,
  CheckCircle2,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  FileClock,
  FileText,
  GraduationCap,
  History,
  Image as ImageIcon,
  Laptop,
  LockKeyhole,
  LoaderCircle,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type {
  AttachmentView,
  AuditLog,
  CourseInput,
  Employee,
  EventAttachmentView,
  EventInput,
  MonthlyAssessmentMetric,
  MonthlyAssessmentRecord,
  MonthlyAssessmentResults,
  MonthlyAssessmentStatus,
  ServiceResult,
} from "../types";
import { formatDisplayDate, getExpiryLabel, getExpiryStatus, getYearsOfService } from "../services/dateUtils";
import { ATTACHMENT_MIME_TYPES, getEmployeeAttention, toUserFacingServiceError, validateAttachment, validateEventAttachment, type EventUploadProgressHandler, type MonthlyAssessmentService } from "../services/dataService";
import { formatFileSize, formatTimestamp, getAuditActionLabel, getAuditDetail } from "../utils/labels";
import { TextAreaField, TextField } from "./Field";
import { StatusBadge } from "./StatusBadge";

interface EmployeeDrawerProps {
  employee: Employee;
  logs: AuditLog[];
  canEdit: boolean;
  canReadAttachment: boolean;
  canWriteAttachment: boolean;
  canWriteHistory: boolean;
  canEditMonthlyAssessment: boolean;
  monthlyAssessmentMonthKey?: string;
  monthlyAssessmentService: MonthlyAssessmentService;
  isCloudMode: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAddCourse: (input: CourseInput) => ServiceResult<Employee> | Promise<ServiceResult<Employee>>;
  onAddEvent: (
    input: EventInput,
    attachmentFile?: File,
    onUploadProgress?: EventUploadProgressHandler,
  ) => ServiceResult<Employee> | Promise<ServiceResult<Employee>>;
  onUploadAttachment: (
    file: File,
    onUploadProgress?: EventUploadProgressHandler,
  ) => ServiceResult<Employee> | Promise<ServiceResult<Employee>>;
  onViewEventAttachment: (eventId: string, attachmentId: string) => ServiceResult<EventAttachmentView> | Promise<ServiceResult<EventAttachmentView>>;
  onViewAttachment: (attachmentId: string) => ServiceResult<AttachmentView> | Promise<ServiceResult<AttachmentView>>;
}

type CourseFormState = Omit<CourseInput, "status">;

const EMPTY_COURSE: CourseFormState = {
  courseName: "",
  attendedDate: "",
  note: "",
};

const EMPTY_EVENT: EventInput = {
  eventDate: "",
  eventType: "特殊事件",
  summary: "",
  detail: "",
};

const MONTHLY_ASSESSMENT_METRICS: Array<{ value: MonthlyAssessmentMetric; label: string }> = [
  { value: "meeting", label: "月度参会" },
  { value: "renewalRate", label: "月度续费率" },
  { value: "influence", label: "月度感召" },
  { value: "visits", label: "月度走访" },
  { value: "nineGrid", label: "月度九宫格考核" },
];

const MONTHLY_ASSESSMENT_STATUS_OPTIONS: Array<{ value: MonthlyAssessmentStatus; label: string }> = [
  { value: "achieved", label: "达成" },
  { value: "not_achieved", label: "未达成" },
  { value: "unassessed", label: "未评价" },
];

function currentShanghaiMonthKey(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value ?? ""}-${parts.find((part) => part.type === "month")?.value ?? ""}`;
}

function emptyMonthlyResults(): MonthlyAssessmentResults {
  return {
    meeting: "unassessed",
    renewalRate: "unassessed",
    influence: "unassessed",
    visits: "unassessed",
    nineGrid: "unassessed",
  };
}

function monthlyStatusLabel(status: MonthlyAssessmentStatus): string {
  return MONTHLY_ASSESSMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "未评价";
}

function valueOrMissing(value: string): string {
  return value || "未填写";
}

function onlyChildDisplayValue(value: string): string {
  const normalized = value.trim();
  return !normalized || normalized === "未填写" || normalized === "未整理" ? "否" : normalized;
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong className={mono ? "mono-value" : ""}>{valueOrMissing(value)}</strong>
    </div>
  );
}

function DetailSection({ icon, index, title, children, tone = "paper" }: { icon: React.ReactNode; index: string; title: string; children: React.ReactNode; tone?: "paper" | "dark" }) {
  return (
    <section className={`detail-section detail-section-${tone}`}>
      <div className="detail-section-heading">
        <div className="detail-section-title">
          <span className="section-icon">{icon}</span>
          <div>
            <span className="section-index">{index}</span>
            <h3>{title}</h3>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

export function EmployeeDrawer({ employee, logs, canEdit, canReadAttachment, canWriteAttachment, canWriteHistory, canEditMonthlyAssessment, monthlyAssessmentMonthKey, monthlyAssessmentService, isCloudMode, onClose, onEdit, onAddCourse, onAddEvent, onUploadAttachment, onViewEventAttachment, onViewAttachment }: EmployeeDrawerProps) {
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseFormState>({ ...EMPTY_COURSE });
  const [event, setEvent] = useState<EventInput>({ ...EMPTY_EVENT });
  const [eventAttachment, setEventAttachment] = useState<File | null>(null);
  const [eventAttachmentError, setEventAttachmentError] = useState<string | null>(null);
  const [eventUploadProgress, setEventUploadProgress] = useState<number | null>(null);
  const [generalAttachmentFile, setGeneralAttachmentFile] = useState<File | null>(null);
  const [generalAttachmentError, setGeneralAttachmentError] = useState<string | null>(null);
  const [generalUploadProgress, setGeneralUploadProgress] = useState<number | null>(null);
  const [generalAttachmentMessage, setGeneralAttachmentMessage] = useState<string | null>(null);
  const [isGeneralAttachmentSaving, setIsGeneralAttachmentSaving] = useState(false);
  const generalAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<EventAttachmentView | null>(null);
  const [attachmentPreviewType, setAttachmentPreviewType] = useState<"event" | "employee">("event");
  const [attachmentViewError, setAttachmentViewError] = useState<string | null>(null);
  const [isAttachmentLoading, setIsAttachmentLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isCourseSaving, setIsCourseSaving] = useState(false);
  const [isEventSaving, setIsEventSaving] = useState(false);
  const [monthlyMonthKey, setMonthlyMonthKey] = useState(monthlyAssessmentMonthKey || currentShanghaiMonthKey());
  const [monthlyRecord, setMonthlyRecord] = useState<MonthlyAssessmentRecord | null>(null);
  const [monthlyDraft, setMonthlyDraft] = useState<MonthlyAssessmentResults>(emptyMonthlyResults);
  const [monthlyNote, setMonthlyNote] = useState("");
  const [isMonthlyLoading, setIsMonthlyLoading] = useState(true);
  const [isMonthlySaving, setIsMonthlySaving] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);
  const [monthlySaveError, setMonthlySaveError] = useState<string | null>(null);
  const [monthlyMessage, setMonthlyMessage] = useState<string | null>(null);
  const [monthlyReloadToken, setMonthlyReloadToken] = useState(0);
  const attention = getEmployeeAttention(employee);

  useEffect(() => {
    setMonthlyMonthKey(monthlyAssessmentMonthKey || currentShanghaiMonthKey());
  }, [employee.id, monthlyAssessmentMonthKey]);

  useEffect(() => {
    let cancelled = false;
    setIsMonthlyLoading(true);
    setMonthlyError(null);
    setMonthlySaveError(null);
    setMonthlyMessage(null);
    setMonthlyRecord(null);
    void Promise.resolve(monthlyAssessmentService.getMonthlyAssessment(employee.id, monthlyMonthKey))
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setMonthlyDraft(emptyMonthlyResults());
          setMonthlyNote("");
          setMonthlyError(result.message);
          return;
        }
        setMonthlyRecord(result.data);
        setMonthlyDraft(result.data.results);
        setMonthlyNote(result.data.note);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMonthlyDraft(emptyMonthlyResults());
        setMonthlyNote("");
        setMonthlyError(toUserFacingServiceError(error, "读取月度考核失败，请稍后重试。"));
      })
      .finally(() => {
        if (!cancelled) setIsMonthlyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employee.id, monthlyAssessmentService, monthlyMonthKey, monthlyReloadToken]);

  async function submitMonthlyAssessment() {
    if (!canEditMonthlyAssessment || !monthlyRecord?.inScope || isMonthlySaving) return;
    setIsMonthlySaving(true);
    setMonthlySaveError(null);
    setMonthlyMessage(null);
    try {
      const result = await monthlyAssessmentService.saveMonthlyAssessment({
        employeeId: employee.id,
        monthKey: monthlyMonthKey,
        results: monthlyDraft,
        note: monthlyNote,
        expectedVersion: monthlyRecord.version,
      });
      if (!result.ok) {
        setMonthlySaveError(result.message);
        return;
      }
      setMonthlyRecord(result.data);
      setMonthlyDraft(result.data.results);
      setMonthlyNote(result.data.note);
      setMonthlyMessage("月度考核已保存。");
    } catch (error) {
      setMonthlySaveError(toUserFacingServiceError(error, "保存月度考核失败，请稍后重试。"));
    } finally {
      setIsMonthlySaving(false);
    }
  }

  function handleEventAttachmentChange(changeEvent: ChangeEvent<HTMLInputElement>) {
    const file = changeEvent.target.files?.[0] ?? null;
    setEventAttachmentError(null);
    setFormError(null);
    setEventAttachment(null);
    if (!file) return;
    if (!canWriteAttachment) {
      changeEvent.currentTarget.value = "";
      setEventAttachmentError("当前账号没有附件上传权限。请联系总管理员授权。");
      return;
    }
    if (!isCloudMode) {
      changeEvent.currentTarget.value = "";
      setEventAttachmentError("当前为体验模式，不能保存事件图片；请切换到正式账号后重试。");
      return;
    }
    const validationError = validateEventAttachment(file);
    if (validationError) {
      changeEvent.currentTarget.value = "";
      setEventAttachmentError(validationError);
      return;
    }
    setEventAttachment(file);
  }

  function handleGeneralAttachmentChange(changeEvent: ChangeEvent<HTMLInputElement>) {
    const file = changeEvent.target.files?.[0] ?? null;
    changeEvent.currentTarget.value = "";
    setGeneralAttachmentError(null);
    setGeneralAttachmentMessage(null);
    setGeneralAttachmentFile(null);
    if (!file) return;
    if (!canWriteAttachment) {
      setGeneralAttachmentError("当前账号没有附件上传权限。请联系总管理员授权。");
      return;
    }
    if (!isCloudMode) {
      changeEvent.currentTarget.value = "";
      setGeneralAttachmentError("当前为体验模式，不能上传员工附件；请切换到正式账号后重试。");
      return;
    }
    const validationError = validateAttachment(file);
    if (validationError) {
      changeEvent.currentTarget.value = "";
      setGeneralAttachmentError(validationError);
      return;
    }
    setGeneralAttachmentFile(file);
    void submitGeneralAttachment(file);
  }

  async function submitCourse() {
    if (isCourseSaving) return;
    setIsCourseSaving(true);
    setFormError(null);
    try {
      const result = await onAddCourse({ ...course, status: "completed" });
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setCourse({ ...EMPTY_COURSE });
      setShowCourseForm(false);
    } catch (error) {
      setFormError(toUserFacingServiceError(error, "保存课程记录失败，请稍后重试。"));
    } finally {
      setIsCourseSaving(false);
    }
  }

  async function submitEvent() {
    if (isEventSaving) return;
    setIsEventSaving(true);
    setFormError(null);
    setEventAttachmentError(null);
    setEventUploadProgress(eventAttachment ? 0 : null);
    if (!event.summary.trim()) {
      setFormError("请先填写事件摘要，再保存事件记录或上传图片。");
      setIsEventSaving(false);
      setEventUploadProgress(null);
      return;
    }
    try {
      const result = await onAddEvent(event, eventAttachment ?? undefined, (progress) => setEventUploadProgress(progress));
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setEvent({ ...EMPTY_EVENT });
      setEventAttachment(null);
      setEventUploadProgress(null);
      setShowEventForm(false);
    } catch (error) {
      setFormError(toUserFacingServiceError(error, "保存事件记录失败，请稍后重试。"));
    } finally {
      setIsEventSaving(false);
      setEventUploadProgress(null);
    }
  }

  async function submitGeneralAttachment(fileOverride?: File) {
    if (isGeneralAttachmentSaving) return;
    const file = fileOverride ?? generalAttachmentFile;
    if (!file) {
      setGeneralAttachmentError("请先选择要上传的员工附件图片。");
      return;
    }
    setIsGeneralAttachmentSaving(true);
    setGeneralAttachmentError(null);
    setGeneralAttachmentMessage(null);
    setGeneralUploadProgress(0);
    try {
      const result = await onUploadAttachment(file, (progress) => setGeneralUploadProgress(progress));
      if (!result.ok) {
        setGeneralAttachmentError(result.message);
        return;
      }
      setGeneralAttachmentFile(null);
      setGeneralAttachmentMessage("附件已上传并保存到该员工档案。");
    } catch (error) {
      setGeneralAttachmentError(toUserFacingServiceError(error, "上传员工附件失败，请稍后重试。"));
    } finally {
      setIsGeneralAttachmentSaving(false);
      setGeneralUploadProgress(null);
    }
  }

  async function openEventAttachment(eventId: string, attachmentId: string) {
    if (!canReadAttachment) {
      setAttachmentViewError("当前账号没有附件查看权限。请联系总管理员授权。");
      return;
    }
    if (isAttachmentLoading) return;
    setAttachmentViewError(null);
    setAttachmentPreview(null);
    setAttachmentPreviewType("event");
    setIsAttachmentLoading(true);
    try {
      const result = await onViewEventAttachment(eventId, attachmentId);
      if (!result.ok) {
        setAttachmentViewError(result.message);
        return;
      }
      setAttachmentPreview(result.data);
    } catch (error) {
      setAttachmentViewError(toUserFacingServiceError(error, "查看事件图片失败，请稍后重试。"));
    } finally {
      setIsAttachmentLoading(false);
    }
  }

  async function openGeneralAttachment(attachmentId: string) {
    if (!canReadAttachment) {
      setAttachmentViewError("当前账号没有附件查看权限。请联系总管理员授权。");
      return;
    }
    if (isAttachmentLoading) return;
    setAttachmentViewError(null);
    setAttachmentPreview(null);
    setAttachmentPreviewType("employee");
    setIsAttachmentLoading(true);
    try {
      const result = await onViewAttachment(attachmentId);
      if (!result.ok) {
        setAttachmentViewError(result.message);
        return;
      }
      setAttachmentPreview(result.data);
    } catch (error) {
      setAttachmentViewError(toUserFacingServiceError(error, "查看员工附件失败，请稍后重试。"));
    } finally {
      setIsAttachmentLoading(false);
    }
  }

  function closeAttachmentPreview() {
    setAttachmentPreview(null);
    setAttachmentViewError(null);
    setAttachmentPreviewType("event");
  }

  return (
    <aside className="detail-drawer" aria-label={`${employee.name} 员工详情`}>
      <header className="drawer-header">
        <div className="drawer-topline">
          <span className="eyebrow">员工档案详情</span>
          <button className="icon-button" type="button" aria-label="关闭员工详情" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="drawer-identity">
          <div className="person-mark" aria-hidden="true"><UserRound size={25} /></div>
          <div>
            <h2>{employee.name}</h2>
            <p>{employee.department || "部门未填写"}</p>
          </div>
          <StatusBadge kind="employee" value={employee.status} />
        </div>
        <div className="drawer-actions">
          {canEdit ? <button className="primary-button compact-button" type="button" onClick={onEdit}><Pencil size={15} />编辑资料</button> : <span className="permission-readout"><LockKeyhole size={14} />当前账号为只读</span>}
          <span className="attention-summary">
            {attention.length ? <><ShieldAlert size={15} /> {attention.join(" / ")}</> : <><CheckCircle2 size={15} /> 资料状态正常</>}
          </span>
        </div>
      </header>

      <div className="drawer-scroll">
        <DetailSection index="01" title="个人概览" icon={<UserRound size={17} />}>
          <div className="info-grid">
            <InfoRow label="部门 / 分组" value={employee.department} />
            <InfoRow label="独生子女" value={onlyChildDisplayValue(employee.onlyChildStatus)} />
            <div className="info-row info-row-sensitive">
              <span><Phone size={14} /> 个人手机号</span>
              <strong className="mono-value">{valueOrMissing(employee.personalPhone)}</strong>
            </div>
            <div className="info-row info-row-sensitive">
              <span><Phone size={14} /> 工作电话</span>
              <strong className="mono-value">{valueOrMissing(employee.workPhone)}</strong>
            </div>
            <InfoRow label="手机套餐 / 话补" value={employee.phonePlan} />
            <InfoRow label="手机归属" value={employee.phoneOwnership} />
            <InfoRow label="电脑归属" value={employee.computerOwnership} />
          </div>
        </DetailSection>

        <DetailSection index="02" title="任职信息" icon={<BriefcaseBusiness size={17} />} tone="dark">
          <div className="info-grid info-grid-dark">
            <InfoRow label="入职日期" value={formatDisplayDate(employee.hireDate)} mono />
            <InfoRow label="转正日期" value={formatDisplayDate(employee.regularizationDate)} mono />
            <InfoRow label="工龄" value={getYearsOfService(employee.hireDate)} />
          </div>
        </DetailSection>

        <DetailSection index="03" title="合同信息" icon={<FileClock size={17} />}>
          {employee.contract ? (
            <div className="record-block">
              <div className="record-block-heading"><strong>{employee.contract.type}</strong><StatusBadge kind="expiry" value={getExpiryStatusForEmployee(employee.contract.endDate)} /></div>
              <div className="date-range"><span>{formatDisplayDate(employee.contract.startDate)}</span><span className="range-line" /><span>{formatDisplayDate(employee.contract.endDate)}</span></div>
              <p className="record-note">{valueOrMissing(employee.contract.notes)}</p>
              <div className="expiry-caption"><CalendarDays size={14} /> {getExpiryLabel(getExpiryStatusForEmployee(employee.contract.endDate), employee.contract.endDate)}</div>
            </div>
          ) : <div className="empty-inline"><FileText size={17} /><span>未建立合同记录</span></div>}
        </DetailSection>

        <DetailSection index="04" title="设备与车辆" icon={<Car size={17} />}>
          <div className="subsection-label"><Car size={14} /> 车辆使用</div>
          {employee.vehicle ? (
            <div className="record-block compact-record">
              <div className="record-block-heading"><strong>{valueOrMissing(employee.vehicle.model)}</strong><StatusBadge kind="expiry" value={getExpiryStatusForEmployee(employee.vehicle.endDate)} /></div>
              <div className="info-grid"><InfoRow label="车牌" value={employee.vehicle.plateNumber} mono /><InfoRow label="使用期" value={`${formatDisplayDate(employee.vehicle.startDate)} — ${formatDisplayDate(employee.vehicle.endDate)}`} /></div>
              <p className="record-note">{valueOrMissing(employee.vehicle.notes)}</p>
            </div>
          ) : <div className="empty-inline"><Car size={17} /><span>未建立车辆使用记录</span></div>}
          <div className="subsection-label subsection-label-spaced"><Laptop size={14} /> 设备归属</div>
          <div className="equipment-line"><span>手机：{valueOrMissing(employee.phoneOwnership)}</span><span>电脑：{valueOrMissing(employee.computerOwnership)}</span></div>
        </DetailSection>

        <DetailSection index="05" title="课程记录" icon={<GraduationCap size={17} />}>
          <div className="record-list">
            {employee.courseRecords.length ? employee.courseRecords.map((record) => (
              <button
                className={`timeline-record timeline-record-button ${expandedCourseId === record.id ? "is-expanded" : ""}`}
                key={record.id}
                type="button"
                aria-expanded={expandedCourseId === record.id}
                onClick={() => setExpandedCourseId((current) => current === record.id ? null : record.id)}
              >
                <div className="timeline-marker" />
                <div className="timeline-content">
                  <div className="timeline-heading"><strong>{record.courseName}</strong><span className="timeline-heading-actions">{expandedCourseId === record.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span></div>
                  {expandedCourseId === record.id ? (
                    <div className="course-detail">
                      {record.attendedDate ? <span>参加日期：{formatDisplayDate(record.attendedDate)}</span> : null}
                      {record.note ? <p>{record.note}</p> : null}
                      {!record.attendedDate && !record.note ? <span>已记录参加，暂无具体日期或说明。</span> : null}
                    </div>
                  ) : <span>{record.attendedDate || record.note ? "含日期或活动说明 · 点击查看" : "已有参加记录 · 点击查看"}</span>}
                </div>
              </button>
            )) : <div className="empty-inline"><GraduationCap size={17} /><span>暂无课程记录</span></div>}
          </div>
          {canWriteHistory && showCourseForm ? (
            <div className="inline-form">
              <div className="inline-form-heading"><strong>新增课程记录</strong><button className="text-button" type="button" onClick={() => setShowCourseForm(false)}>收起</button></div>
              <TextField label="课程名称" required value={course.courseName} onChange={(input) => setCourse((current) => ({ ...current, courseName: input.target.value }))} />
              <TextField label="参加日期" type="date" value={course.attendedDate} onChange={(input) => setCourse((current) => ({ ...current, attendedDate: input.target.value }))} />
              <TextAreaField label="备注" rows={2} value={course.note} onChange={(input) => setCourse((current) => ({ ...current, note: input.target.value }))} />
              {formError ? <div className="form-message form-message-error">{formError}</div> : null}
              <button className="secondary-button full-button" type="button" onClick={submitCourse} disabled={isCourseSaving}>{isCourseSaving ? <LoaderCircle size={15} /> : <Plus size={15} />}{isCourseSaving ? "保存中…" : "保存课程记录"}</button>
            </div>
          ) : canWriteHistory ? <button className="add-record-button" type="button" onClick={() => { setFormError(null); setShowCourseForm(true); }}><Plus size={15} />新增课程记录</button> : <div className="empty-inline"><GraduationCap size={17} /><span>当前账号暂不支持新增课程记录</span></div>}
        </DetailSection>

        <DetailSection index="06" title="特殊事件" icon={<History size={17} />} tone="dark">
          <div className="record-list">
            {employee.events.length ? employee.events.map((record) => {
              const eventAttachments = record.attachments ?? [];
              return (
                <div className="timeline-record timeline-record-dark" key={record.id}>
                  <div className="timeline-marker" />
                  <div className="timeline-content">
                    <div className="timeline-heading"><strong>{record.summary}</strong>{record.eventDate ? <span>{formatDisplayDate(record.eventDate)}</span> : null}</div>
                    <span>{record.eventType} · {valueOrMissing(record.detail)}</span>
                    {eventAttachments.length ? eventAttachments.map((attachment) => (
                      <button className="text-button event-attachment-button" type="button" key={attachment.id} onClick={() => void openEventAttachment(record.id, attachment.id)} disabled={!canReadAttachment || isAttachmentLoading}>
                        <Paperclip size={13} />{canReadAttachment ? "查看图片" : "暂无查看权限"} · {attachment.fileName}
                      </button>
                    )) : null}
                  </div>
                </div>
              );
            }) : <div className="empty-inline empty-inline-dark"><History size={17} /><span>暂无事件记录</span></div>}
          </div>
          {canWriteHistory && showEventForm ? (
            <div className="inline-form inline-form-dark">
              <div className="inline-form-heading"><strong>新增事件记录</strong><button className="text-button" type="button" onClick={() => { setShowEventForm(false); setEventAttachment(null); setEventAttachmentError(null); setEventUploadProgress(null); }}>收起</button></div>
              <div className="form-grid form-grid-two"><TextField label="事件日期" type="date" value={event.eventDate} onChange={(input) => setEvent((current) => ({ ...current, eventDate: input.target.value }))} /><TextField label="事件类型" value={event.eventType} onChange={(input) => setEvent((current) => ({ ...current, eventType: input.target.value }))} /></div>
              <TextField label="事件摘要" required value={event.summary} onChange={(input) => setEvent((current) => ({ ...current, summary: input.target.value }))} />
              <TextAreaField label="详细说明" rows={3} value={event.detail} onChange={(input) => setEvent((current) => ({ ...current, detail: input.target.value }))} />
              <TextField label="事件图片（可选）" type="file" accept={ATTACHMENT_MIME_TYPES.join(",")} hint={!canWriteAttachment ? "当前账号没有附件上传权限；仍可保存不带图片的事件记录。" : isCloudMode ? "支持 JPG、PNG、WEBP 或 GIF，最大 10 MB。" : "当前为体验模式，不能保存图片；请切换到正式账号后添加。"} onChange={handleEventAttachmentChange} disabled={isEventSaving || !canWriteAttachment} />
              {eventAttachment ? <span className="field-hint" aria-live="polite"><ImageIcon size={13} />已选择：{eventAttachment.name}（{formatFileSize(eventAttachment.size)}）</span> : null}
              {eventAttachmentError ? <div className="form-message form-message-error" role="alert">{eventAttachmentError}</div> : null}
              {eventAttachment && isEventSaving ? <div className="form-message" role="status" aria-live="polite"><LoaderCircle size={15} />正在上传图片{eventUploadProgress !== null ? ` ${eventUploadProgress}%` : ""}，请稍候…</div> : null}
              {formError ? <div className="form-message form-message-error">{formError}</div> : null}
              <button className="secondary-button full-button" type="button" onClick={submitEvent} disabled={isEventSaving}>{isEventSaving ? <LoaderCircle size={15} /> : <Plus size={15} />}{isEventSaving ? (eventAttachment ? "上传并保存中…" : "保存中…") : "保存事件记录"}</button>
            </div>
          ) : canWriteHistory ? <button className="add-record-button add-record-button-dark" type="button" onClick={() => { setFormError(null); setShowEventForm(true); }}><Plus size={15} />新增特殊事件</button> : <div className="empty-inline empty-inline-dark"><History size={17} /><span>当前账号暂不支持新增特殊事件</span></div>}
        </DetailSection>

        <DetailSection index="07" title="月度考核" icon={<ClipboardCheck size={17} />}>
          <div className="monthly-drawer-toolbar">
            <label className="filter-select monthly-drawer-month-select">
              <span className="filter-label">考核月份</span>
              <input
                aria-label="选择员工月度考核月份"
                type="month"
                max={currentShanghaiMonthKey()}
                value={monthlyMonthKey}
                onChange={(event) => setMonthlyMonthKey(event.target.value)}
                disabled={isMonthlyLoading || isMonthlySaving}
              />
            </label>
            {monthlyRecord?.inScope ? <span className="monthly-drawer-progress">已填写 {monthlyRecord.filledCount} / 5</span> : null}
          </div>
          {isMonthlyLoading ? <div className="empty-inline"><LoaderCircle size={17} /><span>正在读取该月份的月度考核</span></div> : null}
          {!isMonthlyLoading && monthlyError ? <div className="form-message form-message-error" role="alert"><ShieldAlert size={15} />{monthlyError}<button className="text-button" type="button" onClick={() => setMonthlyReloadToken((current) => current + 1)}>重试</button></div> : null}
            {!isMonthlyLoading && !monthlyError && monthlyRecord && !monthlyRecord.inScope ? <div className="empty-inline"><ClipboardCheck size={17} /><span>该员工不在此月份的考核范围内。</span></div> : null}
          {!isMonthlyLoading && !monthlyError && monthlyRecord?.inScope ? (
            <div className="monthly-drawer-content">
              <div className="monthly-drawer-status-grid">
                {MONTHLY_ASSESSMENT_METRICS.map((metric) => (
                  <label className={`monthly-drawer-status monthly-status-${monthlyDraft[metric.value]}`} key={metric.value}>
                    <span>{metric.label}</span>
                    <select
                      aria-label={`${metric.label}评价`}
                      value={monthlyDraft[metric.value]}
                      disabled={!canEditMonthlyAssessment || isMonthlySaving}
                      onChange={(event) => setMonthlyDraft((current) => ({ ...current, [metric.value]: event.target.value as MonthlyAssessmentStatus }))}
                    >
                      {MONTHLY_ASSESSMENT_STATUS_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <TextAreaField
                label="整体评价说明（可选）"
                rows={3}
                maxLength={2000}
                value={monthlyNote}
                disabled={!canEditMonthlyAssessment || isMonthlySaving}
                onChange={(event) => setMonthlyNote(event.target.value)}
              />
              {!canEditMonthlyAssessment ? <div className="monthly-drawer-readonly"><LockKeyhole size={14} />当前账号只有查看权限，不能修改月度考核。</div> : null}
              {monthlyMessage ? <div className="form-message form-message-success" role="status"><CheckCircle2 size={15} />{monthlyMessage}</div> : null}
              {monthlySaveError ? <div className="form-message form-message-error" role="alert"><ShieldAlert size={15} />{monthlySaveError}</div> : null}
              {canEditMonthlyAssessment ? <button className="secondary-button full-button" type="button" onClick={() => void submitMonthlyAssessment()} disabled={isMonthlySaving}>{isMonthlySaving ? <LoaderCircle size={15} /> : <ClipboardCheck size={15} />}{isMonthlySaving ? "保存中…" : "保存月度考核"}</button> : null}
              <span className="field-hint">状态：{MONTHLY_ASSESSMENT_METRICS.map((metric) => `${metric.label} ${monthlyStatusLabel(monthlyDraft[metric.value])}`).join(" · ")}</span>
            </div>
          ) : null}
        </DetailSection>

        <DetailSection index="08" title="补充说明" icon={<FileText size={17} />}>
          {employee.notes ? <div className="employee-notes">{employee.notes}</div> : <div className="empty-inline"><FileText size={17} /><span>暂无补充说明</span></div>}
        </DetailSection>

        <DetailSection index="09" title="附件" icon={<Paperclip size={17} />}>
          {employee.attachments.length ? <div className="attachment-list">{employee.attachments.map((attachment) => {
            const canViewAttachment = isCloudMode && canReadAttachment && attachment.mimeType.startsWith("image/");
            return <button className="attachment-row attachment-row-button" key={attachment.id} type="button" onClick={() => void openGeneralAttachment(attachment.id)} disabled={!canViewAttachment || isAttachmentLoading} aria-label={canViewAttachment ? `查看附件${attachment.fileName}` : `${attachment.fileName}暂无在线预览`}>
              <FileText size={17} /><span className="attachment-row-content"><strong>{attachment.fileName}</strong><span>{attachment.visibility === "sensitive" ? "内部附件" : "员工附件"} · {formatFileSize(attachment.size)}</span></span><span className="attachment-state">{canViewAttachment ? (isAttachmentLoading ? "加载中…" : "点击查看") : canReadAttachment ? "暂无预览" : "无查看权限"}</span>
            </button>;
          })}</div> : <div className="empty-attachment"><Paperclip size={21} /><strong>暂无员工附件</strong><span>可在这里上传员工附件；特殊事件图片请在上方的事件表单中添加。</span></div>}
          {isCloudMode && canWriteAttachment ? <div className="attachment-upload-panel">
            <input ref={generalAttachmentInputRef} id="general-attachment-input" className="file-input-hidden" type="file" accept={ATTACHMENT_MIME_TYPES.join(",")} onChange={handleGeneralAttachmentChange} disabled={isGeneralAttachmentSaving} />
            <button className="secondary-button full-button" type="button" onClick={() => generalAttachmentInputRef.current?.click()} disabled={isGeneralAttachmentSaving} aria-controls="general-attachment-input">
              {isGeneralAttachmentSaving ? <LoaderCircle size={15} /> : <Paperclip size={15} />}{isGeneralAttachmentSaving ? "上传中…" : "上传附件"}
            </button>
            {generalAttachmentError ? <div className="form-message form-message-error" role="alert">{generalAttachmentError}</div> : null}
            {isGeneralAttachmentSaving ? <div className="form-message" role="status" aria-live="polite"><LoaderCircle size={15} />正在上传附件{generalUploadProgress !== null ? ` ${generalUploadProgress}%` : ""}，请稍候…</div> : null}
            {generalAttachmentMessage ? <div className="form-message form-message-success" role="status" aria-live="polite"><CheckCircle2 size={15} />{generalAttachmentMessage}</div> : null}
          </div> : <div className="attachment-upload-note"><Paperclip size={15} /><span>{!isCloudMode ? "当前为体验模式，不能上传员工附件；请切换到正式账号后使用。特殊事件图片请在事件表单中添加。" : "当前账号没有附件上传权限，请联系总管理员授权。"}</span></div>}
        </DetailSection>

        <DetailSection index="10" title="相关修改记录" icon={<History size={17} />}>
          {logs.length ? <div className="mini-log-list">{logs.slice(0, 5).map((log) => <div className="mini-log-row" key={log.id}><span>{formatTimestamp(log.createdAt)}</span><strong>{getAuditActionLabel(log.action)}</strong><em>{getAuditDetail(log)}</em></div>)}</div> : <div className="empty-inline"><History size={17} /><span>暂无相关操作日志</span></div>}
        </DetailSection>

        <div className="drawer-footer-note">查看事件图片或员工附件会留下操作记录；修改档案也会自动记录。</div>
      </div>
      {attachmentPreview || isAttachmentLoading || attachmentViewError ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeAttachmentPreview}>
          <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="event-attachment-title" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}>
            <header className="editor-header">
              <div><span className="eyebrow">{attachmentPreviewType === "event" ? "事件附件" : "员工附件"}</span><h2 id="event-attachment-title">{attachmentPreviewType === "event" ? "查看事件图片" : "查看员工附件图片"}</h2></div>
              <button className="icon-button" type="button" aria-label="关闭图片预览" onClick={closeAttachmentPreview}><X size={19} /></button>
            </header>
            <div className="editor-body">
              {isAttachmentLoading ? <div className="empty-list" aria-live="polite"><LoaderCircle size={30} /><h2>正在加载图片</h2><p>正在准备图片预览。</p></div> : null}
              {attachmentViewError ? <div className="empty-list" role="alert"><ShieldAlert size={30} /><h2>图片暂时无法查看</h2><p>{attachmentViewError}</p><button className="secondary-button" type="button" onClick={closeAttachmentPreview}>关闭</button></div> : null}
              {attachmentPreview ? <div>
                <img src={attachmentPreview.url} alt={attachmentPreview.fileName} style={{ display: "block", maxHeight: "64vh", maxWidth: "100%", objectFit: "contain", width: "100%" }} onError={() => { setAttachmentPreview(null); setAttachmentViewError("图片预览加载失败，请稍后重试。"); }} />
                <p className="record-note">{attachmentPreviewType === "event" ? "事件图片" : "员工附件"} · {attachmentPreview.fileName}</p>
              </div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

function getExpiryStatusForEmployee(endDate: string) {
  return getExpiryStatus(endDate);
}
