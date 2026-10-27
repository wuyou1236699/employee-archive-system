import {
  Ban,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Download,
  EyeOff,
  History,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountRole } from "../types";
import { toUserFacingServiceError } from "../services/dataService";
import { beijingCurrentQuarterKey, quarterlyNaturalOpeningAt, type QuarterlyTaskDetail, type QuarterlyTaskDetailReader } from "../services/quarterlyReviewService";
import { EMPLOYEE_LIST_PAGE_SIZE, paginateEmployees } from "./employeePagination";
import {
  getQuarterlyValidationReport,
  QUARTERLY_SCORE_MAX,
  QUARTERLY_SCORE_MIN,
  quarterlyGradeForScore,
} from "../quarterly/quarterlyValidation";
import { QUARTERLY_SCORING_STANDARD } from "../quarterly/scoringStandards";
import { QuarterlyRatingEditor } from "../quarterly/QuarterlyRatingEditor";
import { downloadQuarterlyEvaluationWorkbook } from "../quarterly/quarterlyExcelExport";
import { createAvailabilityClock, type AvailabilityClock, type TaskWriteState } from "../quarterly/taskAvailability";
import {
  QUARTERLY_DIMENSIONS,
  QUARTERLY_STATUS_LABELS,
  QUARTERLY_TYPE_LABELS,
  type QuarterlyAssignmentEmployee,
  type QuarterlyAssignmentOptions,
  emptyQuarterlyReasons,
  emptyQuarterlyScores,
  type QuarterlyOverview,
  type QuarterlyPeriod,
  type QuarterlyPeriodInput,
  type QuarterlyPendingRelation,
  type QuarterlyRecord,
  type QuarterlyRecordFilters,
  type QuarterlyRecordStatus,
  type QuarterlyReasons,
  type QuarterlyRevisionInput,
  type QuarterlyResultItem,
  type QuarterlyReviewService,
  type QuarterlyReviewType,
  type QuarterlyScores,
  type QuarterlyTask,
  type QuarterlyTaskAssignmentInput,
  type QuarterlyTaskCopyPreview,
  type QuarterlyTaskCopySummary,
  type QuarterlyTaskMaterializationPreview,
  type QuarterlyTaskDraftInput,
  type QuarterlyTaskFilters,
} from "../quarterly/types";

export interface QuarterlyAssessmentsPageProps {
  data: QuarterlyReviewService;
  role: AccountRole;
  displayName: string;
  onOpenAccount?: () => void;
  onOpenEmployeeHistory?: (employeeId: string) => void;
  initialPeriodKey?: string;
  employeeId?: string | null;
  studentId?: string | null;
}
type UserTab = "tasks" | "results";
type AdminTab = "mine" | "overviewRecords" | "roster";
type ManagerAction = "return" | "void" | "revise";
type Feedback = { kind: "success" | "error"; message: string };

const TASK_DETAIL_REFRESH_INTERVAL_MS = 30_000;
const ASSIGNMENT_REFRESH_MESSAGE = "人员选择暂时不可用，请刷新后重试。";
const SELF_ASSIGNMENT_MESSAGE = "自评只能由当前账号绑定的本人完成。";
const MATERIALIZATION_BATCH_SIZE = 5;
const MATERIALIZATION_MAX_BATCHES = 20;
const availabilityClockCache = new WeakMap<NonNullable<QuarterlyTask["availability"]>, ReturnType<typeof createAvailabilityClock>>();

const REVIEW_TYPE_OPTIONS: Array<{ value: QuarterlyReviewType | "all"; label: string }> = [
  { value: "all", label: "全部类型" },
  { value: "self", label: QUARTERLY_TYPE_LABELS.self },
  { value: "first", label: QUARTERLY_TYPE_LABELS.first },
  { value: "second", label: QUARTERLY_TYPE_LABELS.second },
];

type AdminRosterCategory = QuarterlyReviewType | "pending" | "all";

const ADMIN_ROSTER_CATEGORIES: Array<{ value: AdminRosterCategory; label: string }> = [
  { value: "self", label: QUARTERLY_TYPE_LABELS.self },
  { value: "first", label: QUARTERLY_TYPE_LABELS.first },
  { value: "second", label: QUARTERLY_TYPE_LABELS.second },
  { value: "pending", label: "待处理关系" },
  { value: "all", label: "全部" },
];

const RECORD_STATUS_OPTIONS: Array<{ value: QuarterlyRecordStatus | "all" | "pending"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待处理" },
  { value: "draft", label: QUARTERLY_STATUS_LABELS.draft },
  { value: "submitted", label: QUARTERLY_STATUS_LABELS.submitted },
  { value: "returned", label: QUARTERLY_STATUS_LABELS.returned },
  { value: "void", label: QUARTERLY_STATUS_LABELS.void },
];

function getErrorMessage(error: unknown, fallback: string): string {
  return toUserFacingServiceError(error, fallback);
}

function isAdminRole(role: AccountRole): boolean {
  return role === "admin" || role === "super_admin";
}

function periodStatusLabel(status: QuarterlyPeriod["status"]): string {
  const labels: Record<QuarterlyPeriod["status"], string> = {
    draft: "草稿周期",
    open: "填写中",
    closed: "已关闭",
    archived: "已归档",
  };
  return labels[status];
}

function periodDisplayName(period?: Pick<QuarterlyPeriod, "periodName"> | null, periodKey?: string): string {
  if (period?.periodName) return period.periodName;
  const match = /^([0-9]{4})-Q([1-4])$/i.exec(periodKey ?? "");
  if (!match) return "当前周期";
  const quarterNames = ["第一", "第二", "第三", "第四"];
  return `${match[1]}年${quarterNames[Number(match[2]) - 1]}季度`;
}

interface QuarterChoice {
  periodKey: string;
  periodName: string;
}

function periodNameFromKey(periodKey: string): string {
  return periodDisplayName(null, periodKey);
}

function quarterChoices(periods: QuarterlyPeriod[]): QuarterChoice[] {
  const currentQuarter = beijingCurrentQuarterKey();
  const keys = new Set<string>([currentQuarter]);
  for (const period of periods) {
    const periodKey = period.periodKey.toUpperCase();
    if (/^\d{4}-Q[1-4]$/.test(periodKey) && periodKey <= currentQuarter && period.taskCount > 0) keys.add(periodKey);
  }
  return [...keys]
    .sort((left, right) => right.localeCompare(left))
    .map((periodKey) => ({ periodKey, periodName: periodNameFromKey(periodKey) }));
}

function preferredInitialPeriodKey(periods: QuarterlyPeriod[], currentPeriodKey: string, initialPeriodKey: string | undefined, isAdmin: boolean): string {
  const currentQuarter = beijingCurrentQuarterKey();
  const available = new Set(quarterChoices(periods).map((choice) => choice.periodKey));
  const isSelectable = (key: string) => available.has(key.toUpperCase());
  if (currentPeriodKey && isSelectable(currentPeriodKey)
    && (isAdmin || currentPeriodKey.toUpperCase() <= currentQuarter)) return currentPeriodKey;
  const requestedInitial = initialPeriodKey?.toUpperCase();

  // An open period is the one employees can actually work in. A newer draft
  // period may be current on the calendar but still waiting to be opened. Use
  // only periods that the selector exposes, so an empty historical period
  // cannot become the selected value without a matching option.
  const latestOpenPeriod = periods
    .filter((period) => isSelectable(period.periodKey)
      && period.periodKey.toUpperCase() <= currentQuarter && period.status === "open")
    .sort((left, right) => right.periodKey.localeCompare(left.periodKey))[0];
  if (latestOpenPeriod) return latestOpenPeriod.periodKey;

  const latestDraftPeriod = periods
    .filter((period) => isSelectable(period.periodKey)
      && period.periodKey.toUpperCase() <= currentQuarter && period.status === "draft")
    .sort((left, right) => right.periodKey.localeCompare(left.periodKey))[0];
  if (latestDraftPeriod) return latestDraftPeriod.periodKey;

  if (isAdmin) {
    if (requestedInitial && isSelectable(requestedInitial) && requestedInitial <= currentQuarter) return requestedInitial;
    return currentQuarter;
  }

  const requestedPeriod = requestedInitial
    ? periods.find((period) => period.periodKey.toUpperCase() === requestedInitial
      && isSelectable(period.periodKey) && requestedInitial <= currentQuarter && period.taskCount > 0)
    : undefined;
  if (requestedPeriod) return requestedPeriod.periodKey;
  return periods
    .filter((period) => isSelectable(period.periodKey)
      && period.taskCount > 0 && period.periodKey.toUpperCase() <= currentQuarter)
    .sort((left, right) => right.periodKey.localeCompare(left.periodKey))[0]?.periodKey ?? currentQuarter;
}

function recordStatusLabel(status: QuarterlyRecordStatus | null): string {
  return status ? QUARTERLY_STATUS_LABELS[status] : "待填写";
}

function formatDueAt(value: string | null): string {
  if (!value) return "未设置截止时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDateTimeLocalValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function toShanghaiIsoValue(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00+08:00` : normalized;
}

function taskStatusClass(task: QuarterlyTask): string {
  if (task.status === "revoked") return "void";
  return task.record?.status ?? "pending";
}

function taskStatusText(task: QuarterlyTask): string {
  if (task.status === "revoked") return "已撤销";
  return task.record ? recordStatusLabel(task.record.status) : "待填写";
}

function taskWriteState(task: QuarterlyTask, employeeId?: string | null, availabilityClock?: AvailabilityClock): TaskWriteState {
  if (task.status === "revoked") {
    return {
      canWrite: false,
      reason: "当前季度评价任务已被撤销，不能填写。",
      dueAt: task.availability?.dueAt ?? task.dueAt,
      millisecondsUntilDue: null,
    };
  }
  if (task.type === "self" && (!employeeId || task.evaluateeEmployeeId !== employeeId || task.evaluatorEmployeeIdSnapshot !== employeeId)) {
    return {
      canWrite: false,
      reason: SELF_ASSIGNMENT_MESSAGE,
      dueAt: task.availability?.dueAt ?? task.dueAt,
      millisecondsUntilDue: null,
    };
  }
  if (availabilityClock) return availabilityClock.read();
  if (!task.availability) return createAvailabilityClock(undefined).read();
  let clock = availabilityClockCache.get(task.availability);
  if (!clock) {
    clock = createAvailabilityClock(task.availability);
    availabilityClockCache.set(task.availability, clock);
  }
  return clock.read();
}

function taskDueAt(task: QuarterlyTask): string | null {
  return task.availability ? task.availability.dueAt : task.dueAt;
}

function taskAvailabilityMessage(task: QuarterlyTask, employeeId?: string | null): string | null {
  const state = taskWriteState(task, employeeId);
  return state.canWrite ? null : state.reason ?? "当前任务暂不能填写。";
}

function matchesSearch(values: Array<string | null>, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return values.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

function assignmentEmployeeLabel(employee: QuarterlyAssignmentEmployee): string {
  const department = employee.department.trim() || "未填写部门";
  const statusLabel = employee.status === "active" ? "在职" : employee.status === "former" ? "历史员工" : "已归档";
  return `${employee.name} · ${department} · ${statusLabel}`;
}

function recordSummaryFromRecord(record: QuarterlyRecord): QuarterlyTask["record"] {
  return {
    id: record.id,
    status: record.status,
    total: record.total,
    version: record.version,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
    returnedReason: record.returnedReason,
  };
}

function modeNotice(data: QuarterlyReviewService): string {
  if (data.mode === "local-preview") return "当前为体验模式，提交内容仅用于查看流程，不会保存到正式档案。";
  if (data.mode === "cloudbase-unconfigured") return "当前评价功能暂时不可用，请联系管理员。";
  return "提交后将按当前账号的评价权限处理。";
}

function periodInputFromPeriod(period: QuarterlyPeriod | null, periodKey: string): QuarterlyPeriodInput {
  const resolvedPeriodKey = (period?.periodKey ?? periodKey).toUpperCase();
  return {
    periodKey: resolvedPeriodKey,
    periodName: periodNameFromKey(resolvedPeriodKey),
    status: period?.status ?? "draft",
    ...(period ? { expectedVersion: period.version } : {}),
    dueAt: period?.dueAt ?? null,
    scoringStandardVersion: period?.scoringStandardVersion ?? QUARTERLY_SCORING_STANDARD.version,
  };
}

export function QuarterlyAssessmentsPage({
  data,
  role,
  displayName,
  onOpenAccount,
  onOpenEmployeeHistory,
  initialPeriodKey,
  employeeId = null,
  studentId = null,
}: QuarterlyAssessmentsPageProps) {
  const isAdmin = isAdminRole(role);
  const [periods, setPeriods] = useState<QuarterlyPeriod[]>([]);
  const [periodKey, setPeriodKey] = useState("");
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [userTab, setUserTab] = useState<UserTab>("tasks");
  const [adminTab, setAdminTab] = useState<AdminTab>("mine");
  const [reloadToken, setReloadToken] = useState(0);
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(null);
  const openEmployeeHistory = onOpenEmployeeHistory ?? setHistoryEmployeeId;
  const activePeriod = useMemo(() => periods.find((period) => period.periodKey === periodKey) ?? null, [periodKey, periods]);
  const onPeriodsChanged = useCallback((nextPeriod: QuarterlyPeriod) => {
    setPeriods((current) => current.some((period) => period.periodKey === nextPeriod.periodKey)
      ? current.map((period) => period.periodKey === nextPeriod.periodKey ? nextPeriod : period)
      : [...current, nextPeriod]);
  }, []);
  const activePeriodStatus = activePeriod?.status ?? null;
  const activePeriodOpensAt = activePeriod?.opensAt ?? null;

  useEffect(() => {
    let cancelled = false;
    setPeriodsLoading(true);
    setWorkspaceError(null);
    void Promise.resolve(data.listPeriods())
      .then((nextPeriods) => {
        if (cancelled) return;
        setPeriods(nextPeriods);
        setPeriodKey((currentPeriodKey) => preferredInitialPeriodKey(nextPeriods, currentPeriodKey, initialPeriodKey, isAdmin));
      })
      .catch((error: unknown) => {
        if (!cancelled) setWorkspaceError(getErrorMessage(error, "读取季度评价周期失败。"));
      })
      .finally(() => {
        if (!cancelled) setPeriodsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, initialPeriodKey, isAdmin, reloadToken]);

  useEffect(() => {
    if (activePeriodStatus !== "draft" || !activePeriodOpensAt) return;
    const opensAt = Date.parse(activePeriodOpensAt);
    if (!Number.isFinite(opensAt)) return;

    let cancelled = false;
    let pollInterval: number | undefined;
    const refreshServerStatus = () => {
      void Promise.resolve(data.listPeriods())
        .then((nextPeriods) => {
          if (cancelled) return;
          setPeriods(nextPeriods);
          setWorkspaceError(null);
        })
        .catch((error: unknown) => {
          if (!cancelled) setWorkspaceError(getErrorMessage(error, "刷新季度评价周期失败。"));
        });
    };
    const startPollingForServerStatus = () => {
      refreshServerStatus();
      pollInterval = window.setInterval(refreshServerStatus, 15_000);
    };
    const firstRefreshDelay = Math.max(0, opensAt - Date.now() - 30_000);
    const pollTimeout = window.setTimeout(startPollingForServerStatus, firstRefreshDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(pollTimeout);
      if (pollInterval !== undefined) window.clearInterval(pollInterval);
    };
  }, [activePeriodOpensAt, activePeriodStatus, data]);

  const headerLabel = isAdmin ? "季度评价管理" : "季度评价";

  return (
    <div className="page-frame quarterly-assessment-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{headerLabel}</span>
          <h1>季度评价</h1>
          <p>{isAdmin ? "查看季度评价关系、任务和提交记录。" : "完成我的评价，并在结果公布后查看反馈。"}</p>
        </div>
        <div className="page-header-actions">
          <div className="assessment-count"><ClipboardCheck size={16} /><strong>{periodsLoading ? "—" : periods.length}</strong><span>个评价周期</span></div>
          <span className="permission-readout"><UserRound size={14} />{displayName || "当前账号"}</span>
        </div>
      </header>

      <div className="form-message" role="status" aria-live="polite"><CalendarDays size={15} />{modeNotice(data)}</div>
      {workspaceError ? <div className="form-message form-message-error" role="alert"><ShieldAlert size={15} />{workspaceError}<button className="text-button" type="button" onClick={() => setReloadToken((value) => value + 1)}>重试</button></div> : null}
      {periodsLoading ? <div className="empty-list" aria-live="polite"><LoaderCircle size={32} /><h2>正在读取季度评价</h2><p>请稍候，正在读取可用周期。</p></div> : isAdmin ? <AdminWorkspace data={data} periods={periods} activePeriod={activePeriod} periodKey={periodKey} setPeriodKey={setPeriodKey} activeTab={adminTab} setActiveTab={setAdminTab} userTab={userTab} setUserTab={setUserTab} displayName={displayName} employeeId={employeeId} onOpenAccount={onOpenAccount} onPeriodsChanged={onPeriodsChanged} onOpenEmployeeHistory={openEmployeeHistory} /> : <UserWorkspace data={data} periods={periods} activePeriod={activePeriod} periodKey={periodKey} setPeriodKey={setPeriodKey} displayName={displayName} employeeId={employeeId} studentId={studentId} tab={userTab} setTab={setUserTab} onOpenAccount={onOpenAccount} />}
      {isAdmin && historyEmployeeId ? <EmployeeQuarterlyHistory key={historyEmployeeId} data={data} employeeId={historyEmployeeId} currentPeriodKey={periodKey} onClose={() => setHistoryEmployeeId(null)} /> : null}
    </div>
  );
}

function EmployeeQuarterlyHistory({ data, employeeId, currentPeriodKey, onClose }: { data: QuarterlyReviewService; employeeId: string; currentPeriodKey: string; onClose: () => void }) {
  const [records, setRecords] = useState<QuarterlyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.resolve().then(() => data.listEmployeeHistory({ employeeId })).then((rows) => {
      if (!cancelled) setRecords(rows);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(toUserFacingServiceError(cause, "员工季度历史读取失败，请重试。"));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [data, employeeId, retry]);

  const historyGroups = useMemo(() => {
    const groups = new Map<string, {
      periodKey: string;
      periodName: string;
      recordsByType: Record<QuarterlyReviewType, QuarterlyRecord[]>;
    }>();
    for (const record of records) {
      const periodKey = record.periodKey.trim().toUpperCase();
      let group = groups.get(periodKey);
      if (!group) {
        group = {
          periodKey,
          periodName: record.periodName || periodNameFromKey(periodKey),
          recordsByType: { self: [], first: [], second: [] },
        };
        groups.set(periodKey, group);
      }
      group.recordsByType[record.type].push(record);
    }
    return [...groups.values()].sort((left, right) => right.periodKey.localeCompare(left.periodKey));
  }, [records]);
  const normalizedCurrentPeriodKey = currentPeriodKey.trim().toUpperCase();
  const defaultPeriodKey = historyGroups.find((group) => group.periodKey === normalizedCurrentPeriodKey)?.periodKey
    ?? historyGroups[0]?.periodKey;
  const selectedHistoryPeriod = selectedPeriodKey === "all"
    ? "all"
    : selectedPeriodKey && historyGroups.some((group) => group.periodKey === selectedPeriodKey)
      ? selectedPeriodKey
      : defaultPeriodKey ?? "all";
  const visibleHistoryGroups = selectedHistoryPeriod === "all"
    ? historyGroups
    : historyGroups.filter((group) => group.periodKey === selectedHistoryPeriod);
  const visibleHistoryCount = visibleHistoryGroups.reduce((count, group) => count
    + group.recordsByType.self.length + group.recordsByType.first.length + group.recordsByType.second.length, 0);

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="quarterly-history-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="editor-header"><div><span className="eyebrow">季度评价</span><h2 id="quarterly-history-title">员工季度历史{records[0] ? ` · ${records[0].evaluateeNameSnapshot}` : ""}</h2></div><button ref={closeButton} className="secondary-button compact-button" type="button" onClick={onClose}>关闭</button></header>
      <div className="editor-body">
        <div className="quarterly-history-toolbar">
          <label className="quarterly-history-filter"><span>查看季度</span><select className="quarterly-history-quarter-select" aria-label="查看季度" value={selectedHistoryPeriod} disabled={loading || Boolean(error)} onChange={(event) => setSelectedPeriodKey(event.target.value)}>
            {historyGroups.map((group) => <option key={group.periodKey} value={group.periodKey}>{group.periodName}</option>)}
            <option value="all">全部季度</option>
          </select></label>
          <span className="quarterly-history-count" aria-live="polite">{loading || error ? "—" : `${visibleHistoryCount} 条评价`}</span>
        </div>
        {loading ? <div className="empty-list" role="status"><LoaderCircle size={30} /><p>正在读取员工季度历史…</p></div> : error ? <div className="form-message form-message-error" role="alert">{error}<button className="text-button" type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div> : visibleHistoryGroups.length ? <div className="record-list">{visibleHistoryGroups.map((group) => {
          const groupRecordCount = group.recordsByType.self.length + group.recordsByType.first.length + group.recordsByType.second.length;
          return <section className="detail-section" data-quarterly-history-period={group.periodKey} key={group.periodKey}>
            <div className="detail-section-heading"><h4>{group.periodName}</h4><span>{groupRecordCount} 条评价</span></div>
            {(["self", "first", "second"] as QuarterlyReviewType[]).map((type) => {
              const typeRecords = group.recordsByType[type];
              return typeRecords.length ? <section className="record-list" data-quarterly-history-type={type} key={type} aria-label={`${group.periodName}${QUARTERLY_TYPE_LABELS[type]}`}>
                <div className="detail-section-heading"><h4>{QUARTERLY_TYPE_LABELS[type]}</h4><span>{typeRecords.length} 条</span></div>
                {typeRecords.map((record) => <details className="detail-section" data-quarterly-history-record={record.id} key={record.id}>
                  <summary className="detail-section-heading"><span>{record.evaluatorNameSnapshot} · {record.typeLabel} · 总分：{record.total ?? "—"}</span><span className="quarterly-history-record-actions"><span className="quarterly-history-expand-hint">点击展开详情</span><span className={`status-badge status-${record.status}`}>{QUARTERLY_STATUS_LABELS[record.status]}</span></span></summary>
                  <div className="quarterly-result-scores">{QUARTERLY_DIMENSIONS.map((dimension) => <span key={dimension}>{dimension}：{record.scores[dimension] ?? "—"}</span>)}</div>
                  <div className="quarterly-result-reasons"><ul>{QUARTERLY_DIMENSIONS.map((dimension) => <li key={dimension}>{dimension}：{record.reasons[dimension]?.trim() || "未填写理由"}</li>)}</ul></div>
                </details>)}
              </section> : null;
            })}
          </section>;
        })}</div> : <div className="empty-list"><History size={30} /><p>该员工暂无季度评价历史。</p></div>}
      </div>
    </section>
  </div>;
}

interface PeriodSelectorProps {
  periods: QuarterlyPeriod[];
  periodKey: string;
  onChange: (value: string) => void;
  label?: string;
}

function PeriodSelector({ periods, periodKey, onChange, label = "当前周期", showAllQuarters = false }: PeriodSelectorProps & { showAllQuarters?: boolean }) {
  const choices = showAllQuarters ? quarterChoices(periods) : periods.map((period) => ({ periodKey: period.periodKey, periodName: period.periodName }));
  const canShowSelectedFallback = !showAllQuarters || periodKey === beijingCurrentQuarterKey();
  return (
    <label className="filter-select"><span className="filter-label">{label}</span><select className="quarterly-period-select" aria-label={label} value={periodKey} onChange={(event) => onChange(event.target.value)}><option value="">请选择周期</option>{periodKey && canShowSelectedFallback && !choices.some((choice) => choice.periodKey === periodKey) ? <option value={periodKey}>{periodNameFromKey(periodKey)}</option> : null}{choices.map((choice) => { const period = periods.find((item) => item.periodKey === choice.periodKey); return <option value={choice.periodKey} key={choice.periodKey}>{choice.periodName}{period ? ` · ${periodStatusLabel(period.status)}` : " · 待安排"}</option>; })}</select></label>
  );
}

interface UserWorkspaceProps {
  data: QuarterlyReviewService;
  periods: QuarterlyPeriod[];
  activePeriod: QuarterlyPeriod | null;
  periodKey: string;
  setPeriodKey: (value: string) => void;
  displayName: string;
  employeeId: string | null;
  studentId: string | null;
  tab: UserTab;
  setTab: (value: UserTab) => void;
  onOpenAccount?: () => void;
  showPeriodSelector?: boolean;
}

function UserWorkspace({ data, periods, activePeriod, periodKey, setPeriodKey, employeeId, studentId, tab, setTab, showPeriodSelector = true }: UserWorkspaceProps) {
  return (
    <section className="quarterly-workspace">
      {showPeriodSelector ? <section className="filter-rail quarterly-filter-rail"><PeriodSelector periods={periods} periodKey={periodKey} onChange={setPeriodKey} label="查看季度" showAllQuarters /></section> : null}
      <nav className="segmented-control" aria-label="季度评价工作区"><button className={tab === "tasks" ? "is-active" : ""} type="button" onClick={() => setTab("tasks")}><ClipboardList size={15} />我的评价</button><button className={tab === "results" ? "is-active" : ""} type="button" onClick={() => setTab("results")}><CheckCircle2 size={15} />我的结果</button></nav>
      {tab === "tasks" ? <UserTaskWorkspace data={data} activePeriod={activePeriod} periodKey={periodKey} employeeId={employeeId} studentId={studentId} /> : <UserResultsWorkspace data={data} periodKey={periodKey} />}
    </section>
  );
}

interface UserTaskWorkspaceProps {
  data: QuarterlyReviewService;
  activePeriod: QuarterlyPeriod | null;
  periodKey: string;
  employeeId: string | null;
  studentId: string | null;
}

function UserTaskWorkspace({ data, activePeriod, periodKey, employeeId, studentId }: UserTaskWorkspaceProps) {
  const [filters, setFilters] = useState<QuarterlyTaskFilters>({ periodKey, type: studentId ? "all" : "self", status: "all" });
  const [tasks, setTasks] = useState<QuarterlyTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const selectedTaskIdRef = useRef("");
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<QuarterlyTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [backgroundRefreshError, setBackgroundRefreshError] = useState<string | null>(null);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [taskListVersion, setTaskListVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFilters((current) => ({ ...current, type: studentId ? "all" : "self" }));
  }, [studentId]);

  useEffect(() => {
    setFilters((current) => ({ ...current, periodKey }));
    selectedTaskIdRef.current = "";
    setSelectedTaskId("");
    setSelectedTaskDetail(null);
    setDetailError(null);
    setBackgroundRefreshError(null);
  }, [periodKey]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSelectedTaskDetail(null);
    setDetailError(null);
    setBackgroundRefreshError(null);
    void Promise.resolve(data.getMyTasks(filters))
      .then((nextTasks) => {
        if (cancelled) return;
        setTasks(nextTasks);
        setTaskListVersion((value) => value + 1);
        if (selectedTaskIdRef.current && !nextTasks.some((task) => task.id === selectedTaskIdRef.current)) {
          selectedTaskIdRef.current = "";
        }
        setSelectedTaskId((currentId) => nextTasks.some((task) => task.id === currentId) ? currentId : "");
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError, "读取我的季度评价任务失败。"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, filters]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    let cancelled = false;
    const task = tasksRef.current.find((item) => item.id === selectedTaskId) ?? null;
    if (!task) {
      setSelectedTaskDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const detailReader = data as QuarterlyReviewService & Partial<QuarterlyTaskDetailReader>;
    setDetailLoading(true);
    setDetailError(null);
    setBackgroundRefreshError(null);
    let requestSequence = 0;
    let detailRequestInFlight = false;
    const readDetail = async (background: boolean): Promise<void> => {
      if (detailRequestInFlight) return;
      detailRequestInFlight = true;
      const requestId = ++requestSequence;
      try {
        const detail = detailReader.getTaskDetail
          ? await Promise.resolve(detailReader.getTaskDetail(task.id))
          : { task, record: null };
        if (cancelled || requestId !== requestSequence) return;
        const refreshedTask = detail?.task ?? task;
        setTasks((current) => current.map((item) => item.id === task.id
          ? { ...item, status: refreshedTask.status, dueAt: refreshedTask.dueAt, availability: refreshedTask.availability }
          : item));
        if (background) {
          setBackgroundRefreshError(null);
          setSelectedTaskDetail((current) => current && current.task.id === task.id
            ? { ...current, task: { ...current.task, status: refreshedTask.status, dueAt: refreshedTask.dueAt, availability: refreshedTask.availability } }
            : current);
          return;
        }
        setSelectedTaskDetail(detail ?? { task, record: null });
      } catch (error: unknown) {
        if (cancelled || requestId !== requestSequence) return;
        throw error;
      } finally {
        detailRequestInFlight = false;
      }
    };
    const markBackgroundRefreshFailure = (refreshError: unknown): void => {
      if (cancelled) return;
      setBackgroundRefreshError(getErrorMessage(refreshError, "当前任务状态刷新失败，请刷新页面后重试。"));
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, availability: undefined } : item));
      setSelectedTaskDetail((current) => current && current.task.id === task.id
        ? { ...current, task: { ...current.task, availability: undefined } }
        : current);
    };
    void readDetail(false)
      .catch((loadError: unknown) => {
        if (!cancelled) setDetailError(getErrorMessage(loadError, "读取季度评价详情失败。"));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    const refreshInBackground = (): void => {
      void readDetail(true).catch(markBackgroundRefreshFailure);
    };
    const refreshTimer = detailReader.getTaskDetail ? window.setInterval(refreshInBackground, TASK_DETAIL_REFRESH_INTERVAL_MS) : undefined;
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible" && detailReader.getTaskDetail) refreshInBackground();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [data, detailRefreshToken, periodKey, selectedTaskId, taskListVersion]);

  function updateFilter<K extends keyof QuarterlyTaskFilters>(key: K, value: QuarterlyTaskFilters[K]): void {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function openTask(taskId: string): void {
    selectedTaskIdRef.current = taskId;
    setSelectedTaskId(taskId);
    setSelectedTaskDetail(null);
    setDetailError(null);
    setBackgroundRefreshError(null);
  }

  function returnToTaskList(): void {
    selectedTaskIdRef.current = "";
    setSelectedTaskId("");
    setSelectedTaskDetail(null);
    setDetailLoading(false);
    setDetailError(null);
    setBackgroundRefreshError(null);
  }

  function handleSaved(record: QuarterlyRecord): void {
    setTasks((current) => current.map((task) => task.id === record.taskId ? { ...task, record: recordSummaryFromRecord(record) } : task));
    if (selectedTaskIdRef.current !== record.taskId) return;
    setSelectedTaskDetail((current) => current?.task.id === record.taskId
      ? { ...current, record, task: { ...current.task, record: recordSummaryFromRecord(record) } }
      : current);
  }

  return (
    <div className="quarterly-user-panel">
      {selectedTaskId ? <>
        <div className="list-toolbar"><div><span className="eyebrow">当前评价 · {periodDisplayName(activePeriod, periodKey)}</span><strong>{selectedTask ? `${selectedTask.evaluateeNameSnapshot} · ${selectedTask.typeLabel}` : "评价任务"}</strong></div><button className="secondary-button compact-button" type="button" onClick={returnToTaskList}>返回任务列表</button></div>
        {selectedTask ? <>
          <div className="quarterly-task-list" aria-label="当前评价任务">
            <article className="detail-section quarterly-task-item" data-review-type={selectedTask.type}>
              <div className="detail-section-heading"><div><span className="section-index">{selectedTask.typeLabel}</span><h3>{selectedTask.evaluateeNameSnapshot}</h3></div><span className={`status-badge status-${selectedTask.record?.status ?? "pending"}`}>{recordStatusLabel(selectedTask.record?.status ?? null)}</span></div>
              <p className="drawer-subtitle">{selectedTask.evaluateeDepartmentSnapshot} · 评价人：{selectedTask.evaluatorNameSnapshot}</p>
              <div className="quarterly-task-meta"><span><CalendarDays size={14} />{taskDueAt(selectedTask) ? `截止：${formatDueAt(taskDueAt(selectedTask))}` : "截止：不限"}</span>{selectedTask.record?.total !== null && selectedTask.record?.total !== undefined ? <span>总分 {selectedTask.record.total}</span> : <span>尚未形成总分</span>}</div>
              {taskAvailabilityMessage(selectedTask, employeeId) ? <p className="field-hint" role="status">{taskAvailabilityMessage(selectedTask, employeeId)}</p> : null}
            </article>
          </div>
          {backgroundRefreshError ? <div className="form-message form-message-error" role="alert"><ShieldAlert size={15} />{backgroundRefreshError}<button className="text-button" type="button" onClick={() => setDetailRefreshToken((value) => value + 1)}>刷新任务状态</button></div> : null}
          {detailLoading ? <div className="empty-list" aria-live="polite"><LoaderCircle size={30} /><h2>正在读取评价详情</h2><p>请稍候，正在读取已保存的草稿和评分。</p></div> : null}
          {!detailLoading && detailError ? <div className="empty-list" role="alert"><ShieldAlert size={30} /><h2>评价详情加载失败</h2><p>{detailError}</p></div> : null}
          {!detailLoading && !detailError && selectedTaskDetail ? <QuarterlyTaskForm key={selectedTask.id} data={data} task={selectedTaskDetail.task} record={selectedTaskDetail.record} employeeId={employeeId} onSaved={handleSaved} /> : null}
        </> : <div className="empty-list" role="alert"><ShieldAlert size={30} /><h2>任务暂不可用</h2><p>该任务已不在当前列表中，请返回任务列表后重新选择。</p><button className="secondary-button compact-button" type="button" onClick={returnToTaskList}>返回任务列表</button></div>}
      </> : <>
        <div className="list-toolbar"><div><span className="eyebrow">当前评价 · {periodDisplayName(activePeriod, periodKey)}</span><strong>我的评价任务</strong></div><span className="toolbar-meta">周期、评价人和被评价人由管理员设定</span></div>
        <section className="filter-rail quarterly-filter-rail"><label className="filter-select"><span className="filter-label">评价类型</span><select aria-label="按评价类型筛选" value={filters.type} onChange={(event) => updateFilter("type", event.target.value as QuarterlyTaskFilters["type"])}>{REVIEW_TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label className="filter-select"><span className="filter-label">任务状态</span><select aria-label="按任务状态筛选" value={filters.status} onChange={(event) => updateFilter("status", event.target.value as QuarterlyTaskFilters["status"])}>{RECORD_STATUS_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></section>
        {isLoading ? <div className="empty-list" aria-live="polite"><LoaderCircle size={30} /><h2>正在加载我的任务</h2><p>请稍候。</p></div> : error ? <div className="empty-list" role="alert"><ShieldAlert size={30} /><h2>任务加载失败</h2><p>{error}</p></div> : tasks.length ? <div className="quarterly-task-list" aria-label="我的季度评价任务">{tasks.map((task) => { const availabilityMessage = taskAvailabilityMessage(task, employeeId); return <article className="detail-section quarterly-task-item" data-review-type={task.type} key={task.id}><div className="detail-section-heading"><div><span className="section-index">{task.typeLabel}</span><h3>{task.evaluateeNameSnapshot}</h3></div><span className={`status-badge status-${task.record?.status ?? "pending"}`}>{recordStatusLabel(task.record?.status ?? null)}</span></div><p className="drawer-subtitle">{task.evaluateeDepartmentSnapshot} · 评价人：{task.evaluatorNameSnapshot}</p><div className="quarterly-task-meta"><span><CalendarDays size={14} />{taskDueAt(task) ? `截止：${formatDueAt(taskDueAt(task))}` : "截止：不限"}</span>{task.record?.total !== null && task.record?.total !== undefined ? <span>总分 {task.record.total}</span> : <span>尚未形成总分</span>}</div>{availabilityMessage ? <p className="field-hint" role="status">{availabilityMessage}</p> : null}{task.record?.status === "submitted" ? <span className="quarterly-submitted-indicator">已提交</span> : <button className="primary-button compact-button" type="button" onClick={() => openTask(task.id)}>进入评价</button>}</article>; })}</div> : <div className="empty-list"><ClipboardList size={32} /><h2>暂无评价任务</h2><p>当前周期没有分配给你的评价任务。</p></div>}
      </>}
    </div>
  );
}

interface QuarterlyTaskFormProps {
  data: QuarterlyReviewService;
  task: QuarterlyTask;
  record: QuarterlyRecord | null;
  employeeId: string | null;
  onSaved: (record: QuarterlyRecord) => void;
}

export function QuarterlyTaskForm({ data, task, record, employeeId, onSaved }: QuarterlyTaskFormProps) {
  const [scores, setScores] = useState<QuarterlyScores>(() => record ? { ...record.scores } : emptyQuarterlyScores());
  const [reasons, setReasons] = useState(() => record ? { ...record.reasons } : emptyQuarterlyReasons());
  const [expectedVersion, setExpectedVersion] = useState(record?.version ?? task.record?.version ?? 0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [savingAction, setSavingAction] = useState<"draft" | "submit" | null>(null);
  const [showSubmitErrors, setShowSubmitErrors] = useState(false);
  const taskFormRef = useRef<HTMLElement | null>(null);
  const availabilityClock = useMemo(() => createAvailabilityClock(task.availability), [task.availability]);
  const [, setAvailabilityTick] = useState(0);
  const writeState = taskWriteState(task, employeeId, availabilityClock);
  const report = getQuarterlyValidationReport(scores, reasons, "submit");
  const recordStatus = record?.status ?? task.record?.status ?? null;
  const isReadOnly = recordStatus === "submitted" || recordStatus === "void";
  const displayDueAt = task.availability ? writeState.dueAt : task.dueAt;

  useEffect(() => {
    const refreshTimer = window.setInterval(() => setAvailabilityTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(refreshTimer);
  }, [availabilityClock, employeeId, task.id]);

  function updateScore(dimension: keyof QuarterlyScores, rawValue: string): void {
    const value = rawValue.trim() === "" ? null : Number(rawValue);
    setScores((current) => ({ ...current, [dimension]: value === null || Number.isFinite(value) ? value : null }));
    setFeedback(null);
  }

  function updateReason(dimension: keyof QuarterlyScores, value: string): void {
    setReasons((current) => ({ ...current, [dimension]: value }));
    setFeedback(null);
  }

  function focusFirstMissingScore(dimension: (typeof QUARTERLY_DIMENSIONS)[number]): void {
    const cards = taskFormRef.current?.querySelectorAll<HTMLElement>("[data-quarterly-dimension]");
    const card = Array.from(cards ?? []).find((item) => item.dataset.quarterlyDimension === dimension);
    const target = card?.querySelector<HTMLSelectElement>("[data-quarterly-score-select]")
      ?? card?.querySelector<HTMLInputElement>("[data-quarterly-grade-picker] input[type=radio]");
    if (!target) return;

    window.requestAnimationFrame(() => {
      if (!target.isConnected) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
  }

  async function save(action: "draft" | "submit"): Promise<void> {
    const currentWriteState = taskWriteState(task, employeeId, availabilityClock);
    if (!currentWriteState.canWrite) {
      setFeedback({ kind: "error", message: currentWriteState.reason ?? "当前任务暂不能填写。" });
      return;
    }
    const validation = getQuarterlyValidationReport(scores, reasons, action === "submit" ? "submit" : "draft");
    if (!validation.ok) {
      if (action === "submit") {
        const missingScoreDimensions = QUARTERLY_DIMENSIONS.filter((dimension) => {
          const score = scores[dimension];
          return score === null
            || !Number.isInteger(score)
            || score < QUARTERLY_SCORE_MIN
            || score > QUARTERLY_SCORE_MAX;
        });
        if (missingScoreDimensions.length > 0) {
          const additionalMessages = QUARTERLY_DIMENSIONS
            .filter((dimension) => !missingScoreDimensions.includes(dimension))
            .map((dimension) => validation.errors[dimension])
            .filter((message): message is string => Boolean(message));
          setShowSubmitErrors(true);
          setFeedback({
            kind: "error",
            message: [
              `档位选择不等于具体分数。请为以下维度选择对应档位范围内的具体分数：${missingScoreDimensions.join("、")}。`,
              ...additionalMessages,
            ].join(" "),
          });
          focusFirstMissingScore(missingScoreDimensions[0]);
          return;
        }
      }
      setFeedback({ kind: "error", message: validation.message });
      return;
    }
    setSavingAction(action);
    setFeedback(null);
    try {
      const input: QuarterlyTaskDraftInput = { taskId: task.id, scores, reasons, expectedVersion };
      const result = await Promise.resolve(action === "submit" ? data.submit(input) : data.saveDraft(input));
      if (result.ok) {
        setExpectedVersion(result.data.version);
        setScores(result.data.scores);
        setReasons(result.data.reasons);
        setShowSubmitErrors(false);
        setFeedback({ kind: "success", message: action === "submit" ? "季度评价已提交。" : "草稿已保存。" });
        onSaved(result.data);
      } else {
        setFeedback({ kind: "error", message: result.message });
      }
    } catch (error: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(error, "季度评价保存失败，请稍后重试。") });
    } finally {
      setSavingAction(null);
    }
  }

  return (
    <section ref={taskFormRef} className="form-section quarterly-task-form" aria-label={`填写${task.typeLabel}任务`}>
      <div className="form-section-heading"><div><span className="eyebrow">季度评价表</span><h2>{task.evaluateeNameSnapshot} · {task.typeLabel}</h2></div><span className={`status-badge status-${recordStatus ?? "pending"}`}>{recordStatusLabel(recordStatus)}</span></div>
      <div className="form-grid form-grid-three"><ReadOnlyField label="周期" value={task.periodName} /><ReadOnlyField label="评价人" value={task.evaluatorNameSnapshot} /><ReadOnlyField label="被评价人" value={`${task.evaluateeNameSnapshot} · ${task.evaluateeDepartmentSnapshot}`} /><ReadOnlyField label="截止时间" value={displayDueAt ? formatDueAt(displayDueAt) : "不限"} /></div>
      {record?.returnedReason || task.record?.returnedReason ? <div className="form-message form-message-error" role="note"><RotateCcw size={15} />退回理由：{record?.returnedReason ?? task.record?.returnedReason}</div> : null}
      {!isReadOnly && !writeState.canWrite ? <div className="form-message form-message-error" role="alert"><CalendarDays size={15} />{writeState.reason ?? "当前任务暂不能填写。"}{writeState.dueAt ? ` 截止时间：${formatDueAt(writeState.dueAt)}。` : ""}</div> : null}
      <QuarterlyRatingEditor
        scores={scores}
        reasons={reasons}
        errors={report.errors}
        disabled={isReadOnly || !writeState.canWrite || savingAction !== null}
        showErrors={showSubmitErrors}
        onScoreChange={updateScore}
        onReasonChange={updateReason}
      />
      {feedback ? <div className={`form-message form-message-${feedback.kind === "error" ? "error" : "success"}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.kind === "error" ? <ShieldAlert size={15} /> : <CheckCircle2 size={15} />}{feedback.message}</div> : null}
      <footer className="editor-footer"><span className="required-note">草稿可暂不填写完整；正式提交必须完成六维评分。</span><div className="editor-actions"><button className="secondary-button" type="button" disabled={isReadOnly || !writeState.canWrite || savingAction !== null} onClick={() => void save("draft")}><Save size={15} />{savingAction === "draft" ? "保存中…" : "保存草稿"}</button><button className="primary-button" type="button" disabled={isReadOnly || !writeState.canWrite || savingAction !== null} onClick={() => void save("submit")}><Send size={15} />{savingAction === "submit" ? "提交中…" : "提交评价"}</button></div></footer>
    </section>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div className="field"><span className="field-label">{label}</span><div className="field-control" aria-readonly="true">{value || "—"}</div></div>;
}

interface UserResultsWorkspaceProps {
  data: QuarterlyReviewService;
  periodKey: string;
}

function UserResultsWorkspace({ data, periodKey }: UserResultsWorkspaceProps) {
  const [results, setResults] = useState<QuarterlyResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void Promise.resolve(data.getMyResults(periodKey || undefined))
      .then((nextResults) => {
        if (!cancelled) setResults(nextResults.filter((result) => result.direction === "submitted" && result.status === "submitted"));
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError, "读取我的季度评价结果失败。"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, periodKey]);

  return (
    <div className="quarterly-result-panel">
      <div className="list-toolbar"><div><span className="eyebrow">评价结果 · {periodDisplayName(results[0] ?? null, periodKey)}</span><strong>我的结果</strong></div><span className="toolbar-meta">这里只显示当前账号提交的评价；他人评价仅管理员可查看</span></div>
      {isLoading ? <div className="empty-list"><LoaderCircle size={30} /><h2>正在读取我的结果</h2><p>请稍候。</p></div> : error ? <div className="empty-list" role="alert"><ShieldAlert size={30} /><h2>结果加载失败</h2><p>{error}</p></div> : results.length ? <div className="record-list">{results.map((result) => <article className="detail-section quarterly-result-item" data-review-type={result.type} key={result.id}>
        {result.published && result.status !== "unpublished" ? <>
          <div className="detail-section-heading"><div><span className="section-index">{result.direction === "submitted" ? "已提交" : "已接收"}</span><h3>{result.periodName} · {result.typeLabel}</h3></div><span className={`status-badge status-${result.status}`}>{result.status === "submitted" ? "已提交" : recordStatusLabel(result.status)}</span></div>
          <p>{result.direction === "submitted" ? `被评价人：${result.evaluateeName ?? "—"}` : `评价人：${result.evaluatorName ?? "—"}`}</p>
          <strong>总分：{result.total ?? "—"}</strong>
          {result.scores ? <div className="quarterly-result-scores" aria-label="六维评分">{QUARTERLY_DIMENSIONS.map((dimension) => {
            const score = result.scores?.[dimension] ?? null;
            const grade = quarterlyGradeForScore(score);
            return <span key={dimension}>{dimension}：{score ?? "—"}{grade ? ` 分（${grade}）` : ""}</span>;
          })}</div> : null}
          {result.reasons ? <div className="quarterly-result-reasons"><strong>评价理由</strong><ul>{QUARTERLY_DIMENSIONS.filter((dimension) => result.reasons?.[dimension].trim()).map((dimension) => <li key={dimension}>{dimension}：{result.reasons?.[dimension]}</li>)}</ul></div> : null}
        </> : <div className="empty-inline"><EyeOff size={18} /><div><strong>尚未公布</strong><span>该结果目前不可查看分数、评价人和理由。</span></div></div>}
      </article>)}</div> : <div className="empty-list"><ClipboardCheck size={32} /><h2>暂无季度评价结果</h2><p>已提交的评价会显示在这里。</p></div>}
    </div>
  );
}

interface AdminWorkspaceProps {
  data: QuarterlyReviewService;
  periods: QuarterlyPeriod[];
  activePeriod: QuarterlyPeriod | null;
  periodKey: string;
  setPeriodKey: (value: string) => void;
  activeTab: AdminTab;
  setActiveTab: (value: AdminTab) => void;
  userTab: UserTab;
  setUserTab: (value: UserTab) => void;
  displayName: string;
  employeeId: string | null;
  onOpenAccount?: () => void;
  onPeriodsChanged: (period: QuarterlyPeriod) => void;
  onOpenEmployeeHistory?: (employeeId: string) => void;
}

function AdminWorkspace({ data, periods, activePeriod, periodKey, setPeriodKey, activeTab, setActiveTab, userTab, setUserTab, displayName, employeeId, onOpenAccount, onPeriodsChanged, onOpenEmployeeHistory }: AdminWorkspaceProps) {
  const [overview, setOverview] = useState<QuarterlyOverview | null>(null);
  const [records, setRecords] = useState<QuarterlyRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordFilters, setRecordFilters] = useState<QuarterlyRecordFilters>({ periodKey, type: "all", status: "all", keyword: "" });
  const [assignInput, setAssignInput] = useState<QuarterlyTaskAssignmentInput>({ periodKey, type: "self", evaluatorEmployeeId: "", evaluateeEmployeeId: "", dueAt: activePeriod?.dueAt ?? null });
  const [editingTask, setEditingTask] = useState<QuarterlyTask | null>(null);
  const [assignmentOptions, setAssignmentOptions] = useState<QuarterlyAssignmentOptions | null>(null);
  const [assignmentOptionsLoading, setAssignmentOptionsLoading] = useState(false);
  const [assignmentOptionsError, setAssignmentOptionsError] = useState<string | null>(null);
  const [assignmentOptionsReloadToken, setAssignmentOptionsReloadToken] = useState(0);
  const [materializationPreview, setMaterializationPreview] = useState<QuarterlyTaskMaterializationPreview | null>(null);
  const [materializationPreviewLoading, setMaterializationPreviewLoading] = useState(false);
  const [materializationExecuting, setMaterializationExecuting] = useState(false);
  const [materializationAcknowledged, setMaterializationAcknowledged] = useState(false);
  const [copyPreview, setCopyPreview] = useState<QuarterlyTaskCopyPreview | null>(null);
  const [copyPreviewLoading, setCopyPreviewLoading] = useState(false);
  const [copyExecuting, setCopyExecuting] = useState(false);
  const [copyAcknowledged, setCopyAcknowledged] = useState(false);
  const [action, setAction] = useState<{ recordId: string; kind: ManagerAction } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [revisionScores, setRevisionScores] = useState<QuarterlyScores>(emptyQuarterlyScores());
  const [revisionReasons, setRevisionReasons] = useState<QuarterlyReasons>(emptyQuarterlyReasons());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [savingAction, setSavingAction] = useState<"assign" | "manager" | null>(null);
  const [closingPeriod, setClosingPeriod] = useState(false);
  const [bindingRelationId, setBindingRelationId] = useState<string | null>(null);
  const [exportingType, setExportingType] = useState<QuarterlyReviewType | "all" | null>(null);

  useEffect(() => {
    if (data.mode !== "cloudbase" || periodKey !== beijingCurrentQuarterKey() || activePeriod) return;
    let cancelled = false;
    void Promise.resolve(data.savePeriod(periodInputFromPeriod(null, periodKey)))
      .then((result) => {
        if (cancelled) return;
        if (result.ok) onPeriodsChanged(result.data);
        else setError(result.message);
      })
      .catch((saveError: unknown) => {
        if (!cancelled) setError(getErrorMessage(saveError, "建立季度失败，请刷新后重试。"));
      });
    return () => { cancelled = true; };
  }, [activePeriod, data, onPeriodsChanged, periodKey]);

  useEffect(() => {
    setRecordFilters((current) => ({ ...current, periodKey }));
    setAssignInput((current) => ({ ...current, periodKey, dueAt: activePeriod?.dueAt ?? current.dueAt }));
    setEditingTask(null);
    setMaterializationPreview(null);
    setMaterializationAcknowledged(false);
    setCopyPreview(null);
    setCopyAcknowledged(false);
  }, [activePeriod, periodKey]);

  useEffect(() => {
    if (!periodKey || (activeTab !== "overviewRecords" && activeTab !== "roster")) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const loadOverview = Promise.resolve(data.getOverview(periodKey)).then((result) => {
      if (cancelled) return;
      if (result.ok) setOverview(result.data);
      else setError(result.message);
    });
    const request = activeTab === "overviewRecords"
      ? Promise.all([
        loadOverview,
        Promise.resolve(data.listRecordsAll(recordFilters)).then((nextRecords) => { if (!cancelled) setRecords(nextRecords); }),
      ])
      : loadOverview;
    void request.catch((loadError: unknown) => {
      if (!cancelled) setError(getErrorMessage(loadError, "读取季度评价管理数据失败。"));
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, data, periodKey, recordFilters]);

  useEffect(() => {
    if (activeTab !== "roster") return;
    let cancelled = false;
    setAssignmentOptionsLoading(true);
    setAssignmentOptionsError(null);
    void Promise.resolve(data.getAssignmentOptions())
      .then((options) => {
        if (!cancelled) setAssignmentOptions(options);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setAssignmentOptions(null);
          setAssignmentOptionsError(getErrorMessage(loadError, ASSIGNMENT_REFRESH_MESSAGE));
        }
      })
      .finally(() => {
        if (!cancelled) setAssignmentOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, assignmentOptionsReloadToken, data]);

  useEffect(() => {
    if (assignInput.type !== "self") return;
    const evaluatorEmployeeId = assignInput.evaluateeEmployeeId;
    if (assignInput.evaluatorEmployeeId === evaluatorEmployeeId) return;
    setAssignInput((current) => ({ ...current, evaluatorEmployeeId, evaluatorAccountId: undefined }));
  }, [assignInput.evaluateeEmployeeId, assignInput.evaluatorEmployeeId, assignInput.type]);

  async function exportSubmittedRecords(type: QuarterlyReviewType | "all"): Promise<void> {
    if (exportingType !== null) return;
    const exportPeriodKey = periodKey;
    const exportPeriodName = periodDisplayName(activePeriod, periodKey);
    const typeLabel = type === "all" ? "所有评价" : QUARTERLY_TYPE_LABELS[type];
    setExportingType(type);
    setFeedback({ kind: "success", message: `正在读取${typeLabel}已提交记录并生成工作簿…` });
    try {
      const records = await Promise.resolve(data.listRecordsAll({
        periodKey: exportPeriodKey,
        type,
        status: "submitted",
        keyword: "",
      }));
      const exportedCount = await downloadQuarterlyEvaluationWorkbook(records, exportPeriodKey, exportPeriodName, type);
      setFeedback({
        kind: "success",
        message: exportedCount
          ? `已导出 ${exportedCount} 条${typeLabel}记录（${exportPeriodName}）。`
          : `${exportPeriodName}暂无已提交的${typeLabel}记录，未生成文件。`,
      });
    } catch (error: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(error, `导出${typeLabel}失败，请稍后重试。`) });
    } finally {
      setExportingType(null);
    }
  }

  function evaluatorEmployeeIdForTask(task: QuarterlyTask): string {
    return task.evaluatorEmployeeIdSnapshot?.trim()
      || assignmentOptions?.accounts.find((account) => account.accountId === task.evaluatorAccountId)?.employeeId?.trim()
      || "";
  }

  async function refreshRosterPeriod(targetPeriodKey: string): Promise<void> {
    try {
      const [overviewResult, updatedPeriods] = await Promise.all([
        Promise.resolve(data.getOverview(targetPeriodKey)),
        Promise.resolve(data.listPeriods()),
      ]);
      if (overviewResult.ok) setOverview(overviewResult.data);
      else setError(overviewResult.message);
      const updatedPeriod = updatedPeriods.find((period) => period.periodKey === targetPeriodKey);
      if (updatedPeriod) onPeriodsChanged(updatedPeriod);
    } catch (refreshError: unknown) {
      setError(getErrorMessage(refreshError, "任务已保存，但刷新管理数据失败。请刷新页面查看。"));
    }
  }

  async function closeActivePeriod(): Promise<void> {
    if (!activePeriod || activePeriod.status !== "open" || closingPeriod) return;
    if (!window.confirm(`截止${periodDisplayName(activePeriod, activePeriod.periodKey)}后，未提交的评价将不能继续提交；已有评价和任务会保留。确认截止吗？`)) return;
    setFeedback(null);
    setClosingPeriod(true);
    try {
      const result = await Promise.resolve(data.savePeriod({
        ...periodInputFromPeriod(activePeriod, activePeriod.periodKey),
        status: "closed",
      }));
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.message });
        return;
      }
      onPeriodsChanged(result.data);
      setFeedback({ kind: "success", message: `${periodDisplayName(result.data, result.data.periodKey)}已截止；已有评价和任务已保留。` });
    } catch (closeError: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(closeError, "截止季度失败，请刷新后重试。") });
    } finally {
      setClosingPeriod(false);
    }
  }

  function beginEditingTask(task: QuarterlyTask): void {
    const evaluatorEmployeeId = evaluatorEmployeeIdForTask(task);
    if (task.sourceLocked) {
      setFeedback({ kind: "error", message: "这条来源名单任务须在来源关系核对流程中处理，不能在任务列表中编辑或撤销。" });
      return;
    }
    if (task.record) {
      setFeedback({ kind: "error", message: "这条任务已有评价记录，不能再编辑或撤销。" });
      return;
    }
    if (!evaluatorEmployeeId || !Number.isInteger(task.version) || !task.version) {
      setFeedback({ kind: "error", message: "这条任务缺少可核对的员工身份或版本信息，暂不能编辑；请刷新后重试。" });
      return;
    }
    setEditingTask(task);
    setAssignInput({
      periodKey: task.periodKey,
      type: task.type,
      evaluatorEmployeeId,
      evaluatorAccountId: task.evaluatorEmployeeIdSnapshot ? undefined : task.evaluatorAccountId ?? undefined,
      evaluateeEmployeeId: task.evaluateeEmployeeId,
      dueAt: task.dueAt ?? activePeriod?.dueAt ?? null,
    });
    setFeedback(null);
  }

  function cancelTaskEditing(): void {
    setEditingTask(null);
    setAssignInput({ periodKey, type: "self", evaluatorEmployeeId: "", evaluateeEmployeeId: "", dueAt: activePeriod?.dueAt ?? null });
  }

  async function assignTask(): Promise<void> {
    setFeedback(null);
    if (!assignmentOptions || !assignmentOptions.employees.length) {
      setFeedback({ kind: "error", message: assignmentOptionsError ?? "人员名单为空，暂不能安排评价任务。" });
      return;
    }
    const selectedEvaluator = assignmentOptions.employees.find((employee) => employee.employeeId === assignInput.evaluatorEmployeeId);
    const selectedEmployee = assignmentOptions.employees.find((employee) => employee.employeeId === assignInput.evaluateeEmployeeId);
    if (!selectedEvaluator || selectedEvaluator.status !== "active") {
      setFeedback({ kind: "error", message: "请选择在职评价人。" });
      return;
    }
    if (!selectedEmployee) {
      setFeedback({ kind: "error", message: "请选择被评价员工。" });
      return;
    }
    if (assignInput.type === "self" && selectedEvaluator.employeeId !== selectedEmployee.employeeId) {
      setFeedback({ kind: "error", message: SELF_ASSIGNMENT_MESSAGE });
      return;
    }
    const newInput = {
      periodKey: assignInput.periodKey,
      type: assignInput.type,
      evaluatorEmployeeId: selectedEvaluator.employeeId,
      evaluateeEmployeeId: selectedEmployee.employeeId,
      dueAt: assignInput.dueAt,
    };
    setSavingAction("assign");
    try {
      let result: Awaited<ReturnType<typeof data.assignTask>>;
      let editRequiresNewTask = false;
      if (editingTask) {
        const oldEvaluatorEmployeeId = evaluatorEmployeeIdForTask(editingTask);
        if (!oldEvaluatorEmployeeId || !Number.isInteger(editingTask.version) || !editingTask.version) {
          setFeedback({ kind: "error", message: "原任务缺少可核对的员工身份或版本信息，未作修改；请刷新后重试。" });
          return;
        }
        const identityUnchanged = editingTask.periodKey === newInput.periodKey
          && editingTask.type === newInput.type
          && oldEvaluatorEmployeeId === newInput.evaluatorEmployeeId
          && editingTask.evaluateeEmployeeId === newInput.evaluateeEmployeeId;
        if (identityUnchanged) {
          result = await Promise.resolve(data.saveTask({
            ...newInput,
            evaluatorAccountId: editingTask.evaluatorEmployeeIdSnapshot ? undefined : editingTask.evaluatorAccountId ?? undefined,
            status: "active",
            expectedVersion: editingTask.version,
          }));
        } else {
          const confirmMessage = `这次修改会改变评价关系。系统将先撤销“${editingTask.evaluatorNameSnapshot} → ${editingTask.evaluateeNameSnapshot}”原任务，再安排新关系；如果新任务添加失败，原任务仍保持已撤销，可重新添加。\n\n是否继续？`;
          if (!window.confirm(confirmMessage)) return;
          const revoked = await Promise.resolve(data.saveTask({
            periodKey: editingTask.periodKey,
            type: editingTask.type,
            evaluatorEmployeeId: oldEvaluatorEmployeeId,
            evaluatorAccountId: editingTask.evaluatorEmployeeIdSnapshot ? undefined : editingTask.evaluatorAccountId ?? undefined,
            evaluateeEmployeeId: editingTask.evaluateeEmployeeId,
            dueAt: editingTask.dueAt,
            status: "revoked",
            expectedVersion: editingTask.version,
          }));
          if (!revoked.ok) {
            setFeedback({ kind: "error", message: revoked.message });
            return;
          }
          setEditingTask(null);
          editRequiresNewTask = true;
          result = await Promise.resolve(data.assignTask(newInput));
          if (!result.ok) {
            setFeedback({ kind: "error", message: `原任务已撤销，但新任务未能添加：${result.message} 原任务仍保持已撤销；新关系保留在表单中，可重新安排。` });
            await refreshRosterPeriod(assignInput.periodKey);
            return;
          }
        }
      } else {
        result = await Promise.resolve(data.assignTask(newInput));
      }
      if (result.ok) {
        setFeedback({ kind: "success", message: editRequiresNewTask ? "原任务已撤销，新评价任务已安排。" : editingTask ? "评价任务修改已保存。" : "评价任务已安排。" });
        setEditingTask(null);
        setAssignInput({ periodKey: assignInput.periodKey, type: "self", evaluatorEmployeeId: "", evaluateeEmployeeId: "", dueAt: activePeriod?.dueAt ?? null });
        await refreshRosterPeriod(assignInput.periodKey);
      } else setFeedback({ kind: "error", message: result.message });
    } catch (error: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(error, "安排评价任务失败，请稍后重试。") });
    } finally {
      setSavingAction(null);
    }
  }

  async function bindPendingRelationToStudent(relationId: string, studentId: string): Promise<void> {
    if (bindingRelationId || savingAction || copyExecuting) return;
    const currentPeriod = activePeriod;
    const relation = overview?.pendingRelations.find((item) => item.id === relationId);
    const student = assignmentOptions?.students.find((item) => item.studentId === studentId);
    if (!currentPeriod || !["draft", "open"].includes(currentPeriod.status)) {
      setFeedback({ kind: "error", message: "季度周期已关闭或归档，不能绑定待处理关系。" });
      return;
    }
    if (!relation || relation.type === "self" || relation.evaluatorEmployeeIdSnapshot) {
      setFeedback({ kind: "error", message: "待处理关系已变化或已有员工身份，请刷新后重新核对。" });
      return;
    }
    if (!student) {
      setFeedback({ kind: "error", message: "请选择当前有效名单中的学员档案。" });
      return;
    }
    setFeedback(null);
    setBindingRelationId(relationId);
    try {
      const result = await Promise.resolve(data.bindPendingRelationToStudent({
        relationId,
        studentId,
        expectedRosterVersion: currentPeriod.rosterVersion,
        acknowledged: true,
      }));
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.message });
        return;
      }
      setFeedback({
        kind: "success",
        message: result.data.alreadyBound
          ? `这条来源关系已绑定到学员档案“${student.name}”，任务保持不变。`
          : `已将这条来源关系明确绑定到学员档案“${student.name}”，只创建了这一条评价任务。`,
      });
      await refreshRosterPeriod(relation.periodKey);
    } catch (bindError: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(bindError, "绑定来源关系失败，请刷新后重新核对。") });
    } finally {
      setBindingRelationId(null);
    }
  }

  async function revokeTask(task: QuarterlyTask): Promise<void> {
    if (task.sourceLocked) {
      setFeedback({ kind: "error", message: "这条来源名单任务须在来源关系核对流程中处理，不能在任务列表中撤销。" });
      return;
    }
    if (task.record) {
      setFeedback({ kind: "error", message: "这条任务已有评价记录，不能撤销。" });
      return;
    }
    const evaluatorEmployeeId = evaluatorEmployeeIdForTask(task);
    if (!evaluatorEmployeeId || !Number.isInteger(task.version) || !task.version) {
      setFeedback({ kind: "error", message: "这条任务缺少可核对的员工身份或版本信息，暂不能撤销；请刷新后重试。" });
      return;
    }
    if (!window.confirm(`确定撤销“${task.evaluatorNameSnapshot} → ${task.evaluateeNameSnapshot}”这条评价任务吗？撤销后不计入当前周期任务总数。`)) return;
    setFeedback(null);
    setSavingAction("assign");
    try {
      const result = await Promise.resolve(data.saveTask({
        periodKey: task.periodKey,
        type: task.type,
        evaluatorEmployeeId,
        evaluatorAccountId: task.evaluatorEmployeeIdSnapshot ? undefined : task.evaluatorAccountId ?? undefined,
        evaluateeEmployeeId: task.evaluateeEmployeeId,
        dueAt: task.dueAt,
        status: "revoked",
        expectedVersion: task.version,
      }));
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.message });
        return;
      }
      if (editingTask?.id === task.id) cancelTaskEditing();
      setFeedback({ kind: "success", message: "评价任务已撤销，不再计入当前周期任务总数。" });
      await refreshRosterPeriod(task.periodKey);
    } catch (error: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(error, "撤销评价任务失败，请刷新后重试。") });
    } finally {
      setSavingAction(null);
    }
  }

  async function previewConfirmedTaskMaterialization(): Promise<void> {
    if (!periodKey || activePeriod?.status !== "draft") {
      setFeedback({ kind: "error", message: "请先选择一个草稿周期，再核对待生成任务。" });
      return;
    }
    setFeedback(null);
    setMaterializationPreview(null);
    setMaterializationAcknowledged(false);
    setMaterializationPreviewLoading(true);
    try {
      const result = await Promise.resolve(data.previewConfirmedTaskMaterialization(periodKey));
      if (result.ok) {
        if (result.data.periodKey !== periodKey) {
          setFeedback({ kind: "error", message: "预检周期与当前选择不一致，请重新核对。" });
          return;
        }
        setMaterializationPreview(result.data);
      } else setFeedback({ kind: "error", message: result.message });
    } catch (previewError: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(previewError, "读取任务预检结果失败，请稍后重试。") });
    } finally {
      setMaterializationPreviewLoading(false);
    }
  }

  async function materializeConfirmedTasks(): Promise<void> {
    if (!materializationPreview || materializationPreview.periodKey !== periodKey || !materializationAcknowledged) {
      setFeedback({ kind: "error", message: "请先预览当前周期，并确认预检数量。" });
      return;
    }
    if (materializationPreview.eligibleCount < 1) {
      setFeedback({ kind: "error", message: "当前没有可生成的新任务。" });
      return;
    }
    if (materializationPreview.conflictCount > 0) {
      setFeedback({ kind: "error", message: `预检发现 ${materializationPreview.conflictCount} 项冲突，尚未生成任务。请先核对后重新预检。` });
      setMaterializationPreview(null);
      setMaterializationAcknowledged(false);
      return;
    }
    setFeedback(null);
    setMaterializationExecuting(true);
    const totals = { created: 0, reused: 0, skipped: 0, processed: 0, conflicts: 0, failed: 0 };
    let latestPreview = materializationPreview;
    let remainingCount = materializationPreview.eligibleCount;
    let completed = false;
    let stopMessage = "";
    let errorSummary: string[] = [];
    const maxBatches = Math.max(1, Math.min(MATERIALIZATION_MAX_BATCHES, Math.ceil(materializationPreview.eligibleCount / MATERIALIZATION_BATCH_SIZE) + 1));
    try {
      for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
        if (latestPreview.conflictCount > 0) {
          totals.conflicts += latestPreview.conflictCount;
          stopMessage = `重新预检发现 ${latestPreview.conflictCount} 项冲突`;
          break;
        }
        const expectedEligibleCount = latestPreview.eligibleCount;
        if (expectedEligibleCount < 1) {
          stopMessage = "重新预检后没有可继续处理的任务，但服务端尚未确认全部完成";
          break;
        }
        const result = await Promise.resolve(data.materializeConfirmedTasks({
          periodKey,
          acknowledged: true,
          expectedEligibleCount,
          expectedPreviewToken: latestPreview.previewToken,
        }));
        if (!result.ok) {
          stopMessage = result.message;
          break;
        }
        const batch = result.data;
        totals.created += batch.createdCount;
        totals.reused += batch.reusedCount;
        totals.skipped += batch.skippedCount;
        totals.processed += batch.processedCount;
        totals.conflicts += batch.conflictCount;
        totals.failed += batch.failedCount;
        remainingCount = batch.remainingCount;
        errorSummary = batch.errorSummary;
        if (batch.conflictCount > 0 || batch.failedCount > 0 || errorSummary.length > 0) {
          stopMessage = `本批次发现冲突 ${batch.conflictCount} 项、失败 ${batch.failedCount} 项`;
          break;
        }
        if (batch.complete) {
          completed = true;
          remainingCount = 0;
          break;
        }
        if (batch.processedCount < 1 || batch.remainingCount < 1) {
          stopMessage = "本批次未能确认继续进度";
          break;
        }
        if (batchIndex === maxBatches - 1) {
          stopMessage = "已达到本轮续跑上限";
          break;
        }
        const nextPreview = await Promise.resolve(data.previewConfirmedTaskMaterialization(periodKey));
        if (!nextPreview.ok) {
          stopMessage = `重新预检失败：${nextPreview.message}`;
          break;
        }
        latestPreview = nextPreview.data;
        remainingCount = latestPreview.eligibleCount;
        if (latestPreview.conflictCount > 0) {
          totals.conflicts += latestPreview.conflictCount;
          stopMessage = `重新预检发现 ${latestPreview.conflictCount} 项冲突`;
          break;
        }
        if (latestPreview.eligibleCount < 1 || latestPreview.eligibleCount >= expectedEligibleCount) {
          stopMessage = "重新预检发现待处理数量没有减少，已停止以避免重复生成";
          break;
        }
      }
      let scheduleFailure: string | null = null;
      let scheduledCurrentPeriod: QuarterlyPeriod | null = null;
      const shouldScheduleQuarter = completed;
      if (shouldScheduleQuarter) {
        try {
          const latestPeriods = await Promise.resolve(data.listPeriods());
          const latestPeriod = latestPeriods.find((period) => period.periodKey === periodKey);
          const naturalOpeningAt = quarterlyNaturalOpeningAt(periodKey);
          if (!latestPeriod) {
            scheduleFailure = "找不到已生成任务对应的周期";
          } else if (latestPeriod.status === "open"
            && naturalOpeningAt !== null
            && Date.parse(latestPeriod.opensAt ?? "") === Date.parse(naturalOpeningAt)) {
            scheduledCurrentPeriod = latestPeriod;
          } else if (latestPeriod.status === "closed" || latestPeriod.status === "archived") {
            scheduleFailure = "周期已关闭或归档，不能按季度开放";
          } else {
            const scheduleResult = await Promise.resolve(data.schedulePeriod({ periodKey, expectedVersion: latestPeriod.version }));
            if (scheduleResult.ok) {
              scheduledCurrentPeriod = scheduleResult.data;
              if (scheduleResult.data.status !== "open" && periodKey === beijingCurrentQuarterKey()) scheduleFailure = "周期已排期，但服务器尚未确认当前季度已开放";
            } else scheduleFailure = scheduleResult.message;
          }
        } catch (scheduleError: unknown) {
          scheduleFailure = getErrorMessage(scheduleError, "季度开放操作未完成");
        }
      }
      if (completed) {
        const unmatchedMessage = latestPreview.unmatchedCount > 0 ? `未匹配的 ${latestPreview.unmatchedCount} 项未生成。` : "";
        if (shouldScheduleQuarter && scheduleFailure) {
          setFeedback({ kind: "error", message: `任务已生成，但尚未开放，可重试。新建 ${totals.created} 项，复用 ${totals.reused} 项，跳过 ${totals.skipped} 项。${scheduleFailure}。` });
        } else if (shouldScheduleQuarter && scheduledCurrentPeriod?.status === "open") {
          setFeedback({ kind: "success", message: `任务已生成并按自然季度开放：新建 ${totals.created} 项，复用 ${totals.reused} 项，跳过 ${totals.skipped} 项。${unmatchedMessage}结果公布仍由管理员另行控制。` });
        } else if (shouldScheduleQuarter && scheduledCurrentPeriod) {
          setFeedback({ kind: "success", message: `任务已生成，名单已确认，将于 ${formatDueAt(quarterlyNaturalOpeningAt(periodKey))} 按季度开放。${unmatchedMessage}` });
        } else {
          setFeedback({ kind: "success", message: `任务生成完成：新建 ${totals.created} 项，复用 ${totals.reused} 项，跳过 ${totals.skipped} 项。${unmatchedMessage}` });
        }
      } else {
        const details = errorSummary.length ? `系统提示：${errorSummary.slice(0, 3).join("；")}。` : "";
        setFeedback({ kind: "error", message: `已处理 ${totals.processed} 项（新建 ${totals.created}、复用 ${totals.reused}、跳过 ${totals.skipped}）；剩余 ${remainingCount} 项。${stopMessage}。${details}请重新预检，确认后再继续。` });
      }
      setMaterializationPreview(null);
      setMaterializationAcknowledged(false);
      if (totals.processed > 0 || completed) {
        try {
          const [overviewResult, updatedPeriods] = await Promise.all([
            Promise.resolve(data.getOverview(periodKey)),
            Promise.resolve(data.listPeriods()),
          ]);
          if (overviewResult.ok) setOverview(overviewResult.data);
          else setError(overviewResult.message);
          const updatedPeriod = updatedPeriods.find((period) => period.periodKey === periodKey);
          if (updatedPeriod) onPeriodsChanged(updatedPeriod);
        } catch (refreshError: unknown) {
          setError(getErrorMessage(refreshError, "任务处理结果已保存，但刷新管理数据失败。请刷新页面查看。"));
        }
      }
    } catch (materializeError: unknown) {
      const failureMessage = getErrorMessage(materializeError, "批次处理发生错误。");
      const details = errorSummary.length ? `系统提示：${errorSummary.slice(0, 3).join("；")}。` : "";
      setFeedback({ kind: "error", message: `已处理 ${totals.processed} 项（新建 ${totals.created}、复用 ${totals.reused}、跳过 ${totals.skipped}）；剩余 ${remainingCount} 项。${failureMessage} ${details}请重新预检，确认后再继续。` });
      setMaterializationPreview(null);
      setMaterializationAcknowledged(false);
      if (totals.processed > 0) {
        try {
          const [overviewResult, updatedPeriods] = await Promise.all([
            Promise.resolve(data.getOverview(periodKey)),
            Promise.resolve(data.listPeriods()),
          ]);
          if (overviewResult.ok) setOverview(overviewResult.data);
          else setError(overviewResult.message);
          const updatedPeriod = updatedPeriods.find((period) => period.periodKey === periodKey);
          if (updatedPeriod) onPeriodsChanged(updatedPeriod);
        } catch (refreshError: unknown) {
          setError(getErrorMessage(refreshError, "任务处理结果已保存，但刷新管理数据失败。请刷新页面查看。"));
        }
      }
    } finally {
      setMaterializationExecuting(false);
    }
  }

  async function previewPreviousTaskCopy(): Promise<void> {
    if (!periodKey || activePeriod?.periodKey !== periodKey || activePeriod.status !== "draft" || activePeriod.rosterLocked) {
      setFeedback({ kind: "error", message: "请选择名单尚未锁定的草稿周期，再核对上季度任务。" });
      return;
    }
    setFeedback(null);
    setCopyPreview(null);
    setCopyAcknowledged(false);
    setCopyPreviewLoading(true);
    try {
      const result = await Promise.resolve(data.previewPreviousTaskCopy(periodKey));
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.message });
        return;
      }
      if (result.data.targetPeriodKey !== periodKey || result.data.sourcePeriodKey === periodKey) {
        setFeedback({ kind: "error", message: "预检返回的来源或目标周期不一致，请重新读取周期后再试。" });
        return;
      }
      setCopyPreview(result.data);
    } catch (previewError: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(previewError, "读取上季度任务预检结果失败，请稍后重试。") });
    } finally {
      setCopyPreviewLoading(false);
    }
  }

  async function copyPreviousTasks(): Promise<void> {
    if (!copyPreview || copyPreview.targetPeriodKey !== periodKey || !copyAcknowledged) {
      setFeedback({ kind: "error", message: "请先核对上季度任务，并确认本次复制数量。" });
      return;
    }
    if (!activePeriod || activePeriod.status !== "draft" || activePeriod.rosterLocked) {
      setFeedback({ kind: "error", message: "目标周期已锁定或开放，不能复制评价任务。" });
      setCopyPreview(null);
      setCopyAcknowledged(false);
      return;
    }
    if (copyPreview.eligibleCount < 1) {
      setFeedback({ kind: "error", message: "当前没有可安全复制的上季度任务。" });
      return;
    }
    setFeedback(null);
    setCopyExecuting(true);
    let latestPreview = copyPreview;
    let latestSummary: QuarterlyTaskCopySummary | null = copyPreview;
    let latestSummaryIsResult = false;
    let totalProcessed = 0;
    let totalCopied = 0;
    let remainingCount = copyPreview.eligibleCount;
    let failedCount = 0;
    let errorSummary: string[] = [];
    let completed = false;
    let stopMessage = "";
    const maxBatches = Math.max(1, Math.min(MATERIALIZATION_MAX_BATCHES, Math.ceil(copyPreview.eligibleCount / MATERIALIZATION_BATCH_SIZE) + 1));
    try {
      for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
        const expectedEligibleCount = latestPreview.eligibleCount;
        const result = await Promise.resolve(data.copyPreviousTasks({
          periodKey,
          acknowledged: true,
          expectedPreviewToken: latestPreview.previewToken,
          expectedEligibleCount,
        }));
        if (!result.ok) {
          stopMessage = result.message;
          break;
        }
        const batch = result.data;
        latestSummary = batch;
        latestSummaryIsResult = true;
        totalProcessed += batch.processedCount;
        totalCopied += batch.copiedCount;
        remainingCount = batch.remainingCount;
        failedCount = batch.failedCount;
        errorSummary = batch.errorSummary;
        if (batch.failedCount > 0) {
          stopMessage = `本批次有 ${batch.failedCount} 项失败`;
          break;
        }
        if (batch.complete) {
          completed = true;
          remainingCount = 0;
          break;
        }
        if (batch.processedCount < 1 || batch.remainingCount < 1) {
          stopMessage = "本批次未能确认继续进度";
          break;
        }
        if (batchIndex === maxBatches - 1) {
          stopMessage = "已达到本轮续跑上限";
          break;
        }
        const nextPreview = await Promise.resolve(data.previewPreviousTaskCopy(periodKey));
        if (!nextPreview.ok) {
          stopMessage = `重新预检失败：${nextPreview.message}`;
          break;
        }
        if (nextPreview.data.targetPeriodKey !== periodKey || nextPreview.data.sourcePeriodKey !== latestPreview.sourcePeriodKey) {
          stopMessage = "重新预检返回的来源或目标周期发生变化";
          break;
        }
        latestPreview = nextPreview.data;
        latestSummary = nextPreview.data;
        latestSummaryIsResult = false;
        remainingCount = latestPreview.eligibleCount;
        if (latestPreview.eligibleCount >= expectedEligibleCount) {
          stopMessage = "重新预检发现待复制数量没有减少，已停止以避免重复操作";
          break;
        }
      }
      const categorySummary = latestSummary
        ? `${latestSummaryIsResult ? `目标季度现有同关系 ${latestSummary.alreadyPresentCount} 项（含本次新增）` : `复制前目标已有 ${latestSummary.alreadyPresentCount} 项`}、身份异常 ${latestSummary.identityErrorCount} 项、来源重复 ${latestSummary.duplicateSourceCount} 项、目标重复 ${latestSummary.duplicateTargetCount} 项、记录冲突 ${latestSummary.recordConflictCount} 项、冲突汇总 ${latestSummary.conflictCount} 项。`
        : "";
      if (completed && latestSummary) {
        const details = errorSummary.length ? `处理提示：${errorSummary.slice(0, 3).join("；")}。` : "";
        setFeedback({ kind: "success", message: `已处理完可复制任务：从 ${latestSummary.sourcePeriodName} 复制到 ${latestSummary.targetPeriodName}，新增 ${totalCopied} 项。${categorySummary}非活动来源 ${latestSummary.ignoredInactiveCount} 项已忽略。${details}` });
      } else {
        const details = errorSummary.length ? `系统提示：${errorSummary.slice(0, 3).join("；")}。` : "";
        setFeedback({ kind: "error", message: `已处理 ${totalProcessed} 项，新增 ${totalCopied} 项，失败 ${failedCount} 项；仍有 ${remainingCount} 项待复制。${stopMessage}。${categorySummary}${details}请重新预检后继续。` });
      }
      setCopyPreview(null);
      setCopyAcknowledged(false);
      if (totalProcessed > 0 || completed) await refreshRosterPeriod(periodKey);
    } catch (copyError: unknown) {
      setFeedback({ kind: "error", message: `复制任务未完成，已新增 ${totalCopied} 项，仍有 ${remainingCount} 项待复制。${getErrorMessage(copyError, "请重新预检后继续。")}` });
      setCopyPreview(null);
      setCopyAcknowledged(false);
      if (totalProcessed > 0) await refreshRosterPeriod(periodKey);
    } finally {
      setCopyExecuting(false);
    }
  }

  async function applyManagerAction(): Promise<void> {
    if (!action) return;
    const record = records.find((item) => item.id === action.recordId);
    if (!record) return;
    if (action.kind === "revise") {
      const validation = getQuarterlyValidationReport(revisionScores, revisionReasons, "submit");
      if (!validation.ok) {
        setFeedback({ kind: "error", message: validation.message });
        return;
      }
    }
    if (!actionReason.trim()) {
      setFeedback({ kind: "error", message: action.kind === "return" ? "请填写退回理由。" : action.kind === "void" ? "请填写作废理由。" : "请填写管理员修订或代录原因。" });
      return;
    }
    const currentAction = action;
    setSavingAction("manager");
    try {
      const input = { recordId: record.id, reason: actionReason, expectedVersion: record.version };
      const result = await Promise.resolve(
        currentAction.kind === "return"
          ? data.returnRecord(input)
          : currentAction.kind === "void"
            ? data.voidRecord(input)
            : data.reviseRecord({ ...input, scores: revisionScores, reasons: revisionReasons } satisfies QuarterlyRevisionInput),
      );
      if (result.ok) {
        setRecords((current) => current.map((item) => item.id === result.data.id ? result.data : item));
        setFeedback({ kind: "success", message: currentAction.kind === "return" ? "记录已退回。" : currentAction.kind === "void" ? "记录已作废。" : "管理员修订已保存。" });
        setAction(null);
        setActionReason("");
        setRevisionScores(emptyQuarterlyScores());
        setRevisionReasons(emptyQuarterlyReasons());
        const overviewResult = await Promise.resolve(data.getOverview(periodKey));
        if (overviewResult.ok) setOverview(overviewResult.data);
      } else setFeedback({ kind: "error", message: result.message });
    } catch (error: unknown) {
      setFeedback({ kind: "error", message: getErrorMessage(error, "季度评价管理操作失败，请稍后重试。") });
    } finally {
      setSavingAction(null);
    }
  }

return <section className="quarterly-admin-workspace"><div className="list-toolbar"><div><span className="eyebrow">管理周期 · {periodDisplayName(activePeriod, periodKey)}</span><strong>季度评价管理</strong></div><PeriodSelector periods={periods} periodKey={periodKey} onChange={setPeriodKey} label="查看季度" showAllQuarters />{activeTab !== "mine" && activePeriod?.status === "open" ? <button className="primary-button compact-button" type="button" disabled={closingPeriod} onClick={() => void closeActivePeriod()}><CalendarDays size={14} />{closingPeriod ? "正在截止…" : "截止本周期"}</button> : null}</div><nav className="segmented-control" aria-label="季度评价管理工作区"><button className={activeTab === "mine" ? "is-active" : ""} type="button" onClick={() => setActiveTab("mine")}><UserRound size={15} />我的评价</button><button className={activeTab === "overviewRecords" ? "is-active" : ""} type="button" onClick={() => setActiveTab("overviewRecords")}><ClipboardCheck size={15} />概览与记录</button><button className={activeTab === "roster" ? "is-active" : ""} type="button" onClick={() => setActiveTab("roster")}><UsersRound size={15} />任务名单</button></nav>{activeTab !== "mine" && feedback ? <div className={`form-message form-message-${feedback.kind === "error" ? "error" : "success"}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.kind === "error" ? <ShieldAlert size={15} /> : <CheckCircle2 size={15} />}{feedback.message}</div> : null}{activeTab !== "mine" && error ? <div className="form-message form-message-error" role="alert"><ShieldAlert size={15} />{error}</div> : null}{activeTab === "mine" ? <UserWorkspace data={data} periods={periods} activePeriod={activePeriod} periodKey={periodKey} setPeriodKey={setPeriodKey} displayName={displayName} employeeId={employeeId} studentId={null} tab={userTab} setTab={setUserTab} onOpenAccount={onOpenAccount} showPeriodSelector={false} /> : isLoading ? <div className="empty-list"><LoaderCircle size={30} /><h2>正在读取管理数据</h2><p>请稍候。</p></div> : activeTab === "overviewRecords" ? <div className="quarterly-admin-panel"><AdminOverview overview={overview} onExport={exportSubmittedRecords} exportingType={exportingType} /><AdminRecords records={records} filters={recordFilters} setFilters={setRecordFilters} action={action} setAction={setAction} actionReason={actionReason} setActionReason={setActionReason} revisionScores={revisionScores} revisionReasons={revisionReasons} setRevisionScores={setRevisionScores} setRevisionReasons={setRevisionReasons} applyManagerAction={applyManagerAction} onOpenEmployeeHistory={onOpenEmployeeHistory} busy={savingAction === "manager"} /></div> : <AdminRoster overview={overview} period={activePeriod} input={assignInput} setInput={setAssignInput} assignmentOptions={assignmentOptions} assignmentOptionsLoading={assignmentOptionsLoading} assignmentOptionsError={assignmentOptionsError} onRetryAssignmentOptions={() => setAssignmentOptionsReloadToken((value) => value + 1)} onAssign={assignTask} canBindPendingRelations={data.mode === "cloudbase"} bindingRelationId={bindingRelationId} onBindPendingRelation={bindPendingRelationToStudent} editingTaskId={editingTask?.id ?? null} onEditTask={beginEditingTask} onCancelEdit={cancelTaskEditing} onRevokeTask={revokeTask} materializationPreview={materializationPreview} materializationPreviewLoading={materializationPreviewLoading} materializationExecuting={materializationExecuting} materializationAcknowledged={materializationAcknowledged} setMaterializationAcknowledged={setMaterializationAcknowledged} canMaterialize={data.mode === "cloudbase"} onPreviewMaterialization={previewConfirmedTaskMaterialization} onMaterializeConfirmed={materializeConfirmedTasks} copyPreview={copyPreview} copyPreviewLoading={copyPreviewLoading} copyExecuting={copyExecuting} copyAcknowledged={copyAcknowledged} setCopyAcknowledged={setCopyAcknowledged} canCopyPrevious={data.mode === "cloudbase"} onPreviewPreviousTaskCopy={previewPreviousTaskCopy} onCopyPreviousTasks={copyPreviousTasks} canSchedulePeriod={data.mode === "cloudbase"} onOpenEmployeeHistory={onOpenEmployeeHistory} busy={savingAction === "assign" || copyExecuting} />}</section>;
}

function submittedFinalScoreSummary(records: QuarterlyRecord[], type: QuarterlyReviewType): { average: number | null; sampleCount: number } {
  const minimumTotal = QUARTERLY_SCORE_MIN * QUARTERLY_DIMENSIONS.length;
  const maximumTotal = QUARTERLY_SCORE_MAX * QUARTERLY_DIMENSIONS.length;
  const scores = records
    .filter((record) => record.type === type && record.status === "submitted")
    .map((record) => record.total)
    .filter((score): score is number => typeof score === "number"
      && Number.isInteger(score)
      && score >= minimumTotal
      && score <= maximumTotal);
  const sampleCount = scores.length;
  return {
    average: sampleCount ? scores.reduce((sum, score) => sum + score, 0) / sampleCount : null,
    sampleCount,
  };
}

function AdminOverview({
  overview,
  onExport,
  exportingType,
}: {
  overview: QuarterlyOverview | null;
  onExport: (type: QuarterlyReviewType | "all") => void;
  exportingType: QuarterlyReviewType | "all" | null;
}) {
  if (!overview) return <div className="empty-list"><ClipboardCheck size={32} /><h2>暂无周期概览</h2><p>请选择一个管理周期。</p></div>;
  return <>
    <section className="metric-strip quarterly-overview-metrics">
      <div className="metric-card metric-card-blue"><span>任务总数</span><strong>{overview.taskCount}</strong><small>当前周期</small></div>
      <div className="metric-card metric-card-green"><span>已提交</span><strong>{overview.submittedTaskCount}</strong><small>完成率 {overview.completionRate === null ? "—" : `${Math.round(overview.completionRate * 100)}%`}</small></div>
      <div className="metric-card metric-card-rust"><span>草稿 / 退回</span><strong>{overview.draftTaskCount + overview.returnedTaskCount}</strong><small>需要跟进</small></div>
      <div className="metric-card metric-card-muted"><span>作废</span><strong>{overview.revokedTaskCount}</strong><small>不计入完成</small></div>
    </section>
    <section className="detail-section">
      <div className="detail-section-heading"><div><span className="eyebrow">BY REVIEW TYPE</span><h2>评价类型进度</h2><p>导出当前季度已提交的评价，包含各项分数与文字理由。</p></div><button className="primary-button compact-button quarterly-export-button" type="button" disabled={exportingType !== null} onClick={() => onExport("all")}><Download size={14} />{exportingType === "all" ? "正在生成…" : "导出所有评价 .xlsx"}</button></div>
      <div className="record-list quarterly-type-progress-grid">{(["self", "first", "second"] as const).map((type) => {
        const counts = overview.byType[type];
        const pendingTasks = overview.tasks.filter((task) => task.type === type && task.status === "active"
          && (overview.records.find((record) => record.taskId === task.id)?.status ?? task.record?.status) !== "submitted");
        const scoreSummary = type === "first" || type === "second"
          ? submittedFinalScoreSummary(overview.records, type)
          : null;
        return <div className={`audit-action-button quarterly-type-progress-card quarterly-type-progress-${type}`} key={type}>
          <strong>{QUARTERLY_TYPE_LABELS[type]}</strong>
          <span>{counts.submitted} / {counts.total} 已提交</span>
          <details key={`${overview.period?.periodKey ?? ""}-${type}`}>
            <summary>{counts.pending} 待处理 · 点击查看名单</summary>
            {pendingTasks.length ? <ul>{pendingTasks.map((task) => {
              const status = overview.records.find((record) => record.taskId === task.id)?.status ?? task.record?.status;
              return <li key={task.id}><strong>{task.evaluatorNameSnapshot || "未匹配评价人"}</strong> → {task.evaluateeNameSnapshot}（{status ? QUARTERLY_STATUS_LABELS[status] : "待填写"}）</li>;
            })}</ul> : <p>暂无待处理任务。</p>}
          </details>
          {scoreSummary ? <span>{scoreSummary.average !== null
            ? `已提交评价平均分：${scoreSummary.average.toFixed(1)} 分`
            : "已提交评价平均分：暂无"}</span> : null}
          <button className="primary-button compact-button quarterly-export-button" type="button" disabled={exportingType !== null} onClick={() => onExport(type)}>
            <Download size={14} />
            {exportingType === type ? "正在生成…" : `导出${QUARTERLY_TYPE_LABELS[type]} .xlsx`}
          </button>
        </div>;
      })}</div>
    </section>
  </>;
}

interface AdminRecordsProps {
  records: QuarterlyRecord[];
  filters: QuarterlyRecordFilters;
  setFilters: (value: QuarterlyRecordFilters) => void;
  action: { recordId: string; kind: ManagerAction } | null;
  setAction: (value: { recordId: string; kind: ManagerAction } | null) => void;
  actionReason: string;
  setActionReason: (value: string) => void;
  revisionScores: QuarterlyScores;
  revisionReasons: QuarterlyReasons;
  setRevisionScores: (value: QuarterlyScores) => void;
  setRevisionReasons: (value: QuarterlyReasons) => void;
  applyManagerAction: () => Promise<void>;
  onOpenEmployeeHistory?: (employeeId: string) => void;
  busy: boolean;
}

function AdminRecords({ records, filters, setFilters, action, setAction, actionReason, setActionReason, revisionScores, revisionReasons, setRevisionScores, setRevisionReasons, applyManagerAction, onOpenEmployeeHistory, busy }: AdminRecordsProps) {
  function openAction(record: QuarterlyRecord, kind: ManagerAction): void {
    setAction({ recordId: record.id, kind });
    setActionReason("");
    if (kind === "revise") {
      setRevisionScores({ ...record.scores });
      setRevisionReasons({ ...record.reasons });
    }
  }

  function closeAction(): void {
    setAction(null);
    setActionReason("");
    setRevisionScores(emptyQuarterlyScores());
    setRevisionReasons(emptyQuarterlyReasons());
  }

  return <section className="detail-section quarterly-records-section"><div className="detail-section-heading"><div><span className="eyebrow">按条件筛选</span><h2>评价记录</h2><p className="field-hint">按评价人、被评价人、类型和状态筛选，并查看评价明细。</p></div><ClipboardList size={20} /></div><section className="filter-rail quarterly-filter-rail"><label className="search-box"><ClipboardList size={16} /><input aria-label="搜索季度评价记录" placeholder="按评价人、被评价人或部门搜索" value={filters.keyword} disabled={busy} onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} /></label><label className="filter-select"><span className="filter-label">评价类型</span><select aria-label="记录评价类型" value={filters.type} disabled={busy} onChange={(event) => setFilters({ ...filters, type: event.target.value as QuarterlyRecordFilters["type"] })}>{REVIEW_TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label className="filter-select"><span className="filter-label">记录状态</span><select aria-label="记录状态" value={filters.status} disabled={busy} onChange={(event) => setFilters({ ...filters, status: event.target.value as QuarterlyRecordFilters["status"] })}>{RECORD_STATUS_OPTIONS.filter((option) => option.value !== "pending").map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></section><div className="form-message"><ShieldAlert size={15} />管理员可退回、作废或在留痕前提下修订/代录；修订必须填写完整六维评分及处理原因。</div>{records.length ? <div className="record-list">{records.map((record) => <article className="detail-section quarterly-record-item" key={record.id}><div className="detail-section-heading"><div><span className="section-index">{record.typeLabel}</span><h3>{record.evaluateeNameSnapshot}</h3></div><span className={`status-badge status-${record.status}`}>{QUARTERLY_STATUS_LABELS[record.status]}</span></div><p>{record.evaluateeDepartmentSnapshot} · 评价人：{record.evaluatorNameSnapshot} · 总分：{record.total ?? "—"}</p><div className="editor-actions"><button className="text-button" type="button" onClick={() => onOpenEmployeeHistory?.(record.evaluateeEmployeeId)} disabled={busy || !onOpenEmployeeHistory}><History size={14} />员工季度历史</button>{record.status !== "void" ? <><button className="secondary-button compact-button" type="button" disabled={busy} onClick={() => openAction(record, "revise")}><Save size={14} />修订/代录</button><button className="secondary-button compact-button" type="button" disabled={busy} onClick={() => openAction(record, "return")}><RotateCcw size={14} />退回</button><button className="secondary-button compact-button" type="button" disabled={busy} onClick={() => openAction(record, "void")}><Ban size={14} />作废</button></> : null}</div>{action?.recordId === record.id ? <div className="inline-form-dark">{action.kind === "revise" ? <AdminRevisionFields scores={revisionScores} reasons={revisionReasons} setScores={setRevisionScores} setReasons={setRevisionReasons} busy={busy} /> : null}<label className="field"><span className="field-label">{action.kind === "return" ? "退回理由" : action.kind === "void" ? "作废理由" : "管理员修订/代录原因"}<em>*</em></span><input className="field-control" value={actionReason} disabled={busy} onChange={(event) => setActionReason(event.target.value)} placeholder={action.kind === "revise" ? "请填写可审计、可追溯的处理原因" : "请填写给对方可读的处理理由"} /></label><div className="editor-actions"><button className="secondary-button compact-button" type="button" disabled={busy} onClick={closeAction}>取消</button><button className="primary-button compact-button" type="button" disabled={busy} onClick={() => void applyManagerAction()}>{busy ? "处理中…" : action.kind === "revise" ? "保存修订" : "确认处理"}</button></div></div> : null}</article>)}</div> : <div className="empty-list"><ClipboardList size={32} /><h2>暂无季度评价记录</h2><p>当前筛选条件下没有记录。</p></div>}</section>;
}

interface AdminRevisionFieldsProps {
  scores: QuarterlyScores;
  reasons: QuarterlyReasons;
  setScores: (value: QuarterlyScores) => void;
  setReasons: (value: QuarterlyReasons) => void;
  busy: boolean;
}

function AdminRevisionFields({ scores, reasons, setScores, setReasons, busy }: AdminRevisionFieldsProps) {
  const report = getQuarterlyValidationReport(scores, reasons, "submit");
  function updateScore(dimension: keyof QuarterlyScores, rawValue: string): void {
    const value = rawValue.trim() === "" ? null : Number(rawValue);
    setScores({ ...scores, [dimension]: value === null || Number.isFinite(value) ? value : null });
  }
  function updateReason(dimension: keyof QuarterlyScores, value: string): void {
    setReasons({ ...reasons, [dimension]: value });
  }
  return (
    <QuarterlyRatingEditor
      scores={scores}
      reasons={reasons}
      errors={report.errors}
      disabled={busy}
      showSummary={false}
      inputLabelPrefix="管理员修订"
      onScoreChange={updateScore}
      onReasonChange={updateReason}
    />
  );
}

interface AdminRosterProps {
  overview: QuarterlyOverview | null;
  period: QuarterlyPeriod | null;
  input: QuarterlyTaskAssignmentInput;
  setInput: (value: AdminRosterProps["input"]) => void;
  assignmentOptions: QuarterlyAssignmentOptions | null;
  assignmentOptionsLoading: boolean;
  assignmentOptionsError: string | null;
  onRetryAssignmentOptions: () => void;
  onAssign: () => Promise<void>;
  canBindPendingRelations: boolean;
  bindingRelationId: string | null;
  onBindPendingRelation: (relationId: string, studentId: string) => Promise<void>;
  editingTaskId: string | null;
  onEditTask: (task: QuarterlyTask) => void;
  onCancelEdit: () => void;
  onRevokeTask: (task: QuarterlyTask) => Promise<void>;
  materializationPreview: QuarterlyTaskMaterializationPreview | null;
  materializationPreviewLoading: boolean;
  materializationExecuting: boolean;
  materializationAcknowledged: boolean;
  setMaterializationAcknowledged: (value: boolean) => void;
  canMaterialize: boolean;
  onPreviewMaterialization: () => Promise<void>;
  onMaterializeConfirmed: () => Promise<void>;
  copyPreview: QuarterlyTaskCopyPreview | null;
  copyPreviewLoading: boolean;
  copyExecuting: boolean;
  copyAcknowledged: boolean;
  setCopyAcknowledged: (value: boolean) => void;
  canCopyPrevious: boolean;
  onPreviewPreviousTaskCopy: () => Promise<void>;
  onCopyPreviousTasks: () => Promise<void>;
  canSchedulePeriod: boolean;
  onOpenEmployeeHistory?: (employeeId: string) => void;
  busy: boolean;
}

function AdminRoster({ overview, period, input, setInput, assignmentOptions, assignmentOptionsLoading, assignmentOptionsError, onRetryAssignmentOptions, onAssign, canBindPendingRelations, bindingRelationId, onBindPendingRelation, editingTaskId, onEditTask, onCancelEdit, onRevokeTask, materializationPreview, materializationPreviewLoading, materializationExecuting, materializationAcknowledged, setMaterializationAcknowledged, canMaterialize, onPreviewMaterialization, onMaterializeConfirmed, copyPreview, copyPreviewLoading, copyExecuting, copyAcknowledged, setCopyAcknowledged, canCopyPrevious, onPreviewPreviousTaskCopy, onCopyPreviousTasks, canSchedulePeriod, onOpenEmployeeHistory, busy }: AdminRosterProps) {
  const [evaluatorSearch, setEvaluatorSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [pendingStudentSelections, setPendingStudentSelections] = useState<Record<string, string>>({});
  const [pendingStudentSearch, setPendingStudentSearch] = useState<Record<string, string>>({});
  const [pendingRelationAcknowledgements, setPendingRelationAcknowledgements] = useState<Record<string, boolean>>({});
  const [rosterCategory, setRosterCategory] = useState<AdminRosterCategory>("self");
  const [rosterPage, setRosterPage] = useState(1);
  const [manualAssignmentOpen, setManualAssignmentOpen] = useState(false);
  const [relationshipOperationsOpen, setRelationshipOperationsOpen] = useState(false);
  useEffect(() => {
    setRosterCategory("self");
    setRosterPage(1);
  }, [input.periodKey]);
  const rosterLocked = !period || period.status !== "draft" || period.rosterLocked;
  const rosterLockMessage = period
    ? period.rosterLocked && period.status === "draft"
      ? `本周期名单已确认；自然开放时间为 ${formatDueAt(quarterlyNaturalOpeningAt(period.periodKey))}（北京时间），当前只读。`
      : `本周期${periodStatusLabel(period.status)}，任务名单只读。`
    : "尚未选定评价周期，当前仅可查看任务名单。";
  const assignmentFormOpen = !rosterLocked && (manualAssignmentOpen || Boolean(editingTaskId));
  const relationshipOperationsAvailable = canMaterialize || canCopyPrevious;
  const tasks = overview?.tasks.length ? overview.tasks : (overview?.records ?? []).map((record) => ({
    id: record.taskId,
    periodKey: record.periodKey,
    periodName: record.periodName,
    type: record.type,
    typeLabel: record.typeLabel,
    evaluatorAccountId: record.evaluatorAccountId ?? "",
    evaluatorNameSnapshot: record.evaluatorNameSnapshot,
    evaluatorEmployeeIdSnapshot: null,
    evaluatorStudentIdSnapshot: null,
    version: undefined,
    sourceLocked: undefined,
    evaluateeEmployeeId: record.evaluateeEmployeeId,
    evaluateeNameSnapshot: record.evaluateeNameSnapshot,
    evaluateeDepartmentSnapshot: record.evaluateeDepartmentSnapshot,
    status: "active" as const,
    dueAt: overview?.period?.dueAt ?? null,
    record: {
      id: record.id,
      status: record.status,
      total: record.total,
      version: record.version,
      updatedAt: record.updatedAt,
      submittedAt: record.submittedAt,
      returnedReason: record.returnedReason,
    },
  } satisfies QuarterlyTask));
  const pendingRelations = overview?.pendingRelations ?? [];
  const availableStudents = assignmentOptions?.students ?? [];
  const rosterRows: Array<{ kind: "task"; key: string; task: QuarterlyTask } | { kind: "pending"; key: string; relation: QuarterlyPendingRelation }> = [
    ...tasks.map((task) => ({ kind: "task" as const, key: `task:${task.id}`, task })),
    ...pendingRelations.map((relation) => ({ kind: "pending" as const, key: `pending:${relation.id}`, relation })),
  ];
  const rosterCategoryCounts: Record<AdminRosterCategory, number> = {
    first: tasks.filter((task) => task.type === "first").length,
    second: tasks.filter((task) => task.type === "second").length,
    self: tasks.filter((task) => task.type === "self").length,
    pending: pendingRelations.length,
    all: rosterRows.length,
  };
  const filteredRosterRows = rosterCategory === "all"
    ? rosterRows
    : rosterCategory === "pending"
      ? rosterRows.filter((row) => row.kind === "pending")
      : rosterRows.filter((row) => row.kind === "task" && row.task.type === rosterCategory);
  const rosterPagination = paginateEmployees(filteredRosterRows, rosterPage);
  const rosterPageCount = rosterPagination.totalPages;
  const currentRosterPage = rosterPagination.currentPage;
  const rosterRangeStart = filteredRosterRows.length ? rosterPagination.startIndex + 1 : 0;
  const rosterRangeEnd = rosterPagination.endIndex;
  const visibleRosterRows = rosterPagination.items;
  useEffect(() => {
    setRosterPage((page) => rosterPageCount === 0 ? 1 : Math.min(Math.max(page, 1), rosterPageCount));
  }, [rosterPageCount]);
  const employees = assignmentOptions?.employees ?? [];
  const students = assignmentOptions?.students ?? [];
  const employeeById = (employeeId: string | null | undefined) => employees.find((employee) => employee.employeeId === employeeId?.trim());
  const evaluatorForTask = (task: QuarterlyTask) => employeeById(
    task.evaluatorEmployeeIdSnapshot?.trim()
      || assignmentOptions?.accounts.find((account) => account.accountId === task.evaluatorAccountId)?.employeeId,
  );
  const activeEvaluatorEmployees = employees.filter((employee) => employee.status === "active");
  const selectedEmployee = employees.find((employee) => employee.employeeId === input.evaluateeEmployeeId);
  const evaluatorEmployeeId = input.type === "self" ? selectedEmployee?.employeeId ?? "" : input.evaluatorEmployeeId ?? "";
  const selectedEvaluator = activeEvaluatorEmployees.find((employee) => employee.employeeId === evaluatorEmployeeId);
  const filteredEvaluators = activeEvaluatorEmployees.filter((employee) => matchesSearch([employee.name, employee.department], evaluatorSearch));
  if (selectedEvaluator && !filteredEvaluators.some((employee) => employee.employeeId === selectedEvaluator.employeeId)) {
    filteredEvaluators.unshift(selectedEvaluator);
  }
  const filteredEmployees = employees.filter((employee) => matchesSearch([employee.name, employee.department], employeeSearch));
  if (selectedEmployee && !filteredEmployees.some((employee) => employee.employeeId === selectedEmployee.employeeId)) {
    filteredEmployees.unshift(selectedEmployee);
  }

  const taskIsEditable = (task: QuarterlyTask): boolean => task.status === "active"
    && !rosterLocked
    && task.sourceLocked === false
    && !task.record
    && Number.isInteger(task.version)
    && Boolean(task.evaluatorEmployeeIdSnapshot?.trim() || assignmentOptions?.accounts.find((account) => account.accountId === task.evaluatorAccountId)?.employeeId?.trim());

  function selectType(type: QuarterlyReviewType): void {
    setInput({
      ...input,
      type,
      evaluatorEmployeeId: type === "self" ? input.evaluateeEmployeeId : input.evaluatorEmployeeId ?? "",
      evaluatorAccountId: undefined,
    });
  }

  function selectRosterCategory(category: AdminRosterCategory): void {
    setRosterCategory(category);
    setRosterPage(1);
  }

  function selectEmployee(employeeId: string): void {
    setInput({
      ...input,
      evaluateeEmployeeId: employeeId,
      evaluatorEmployeeId: input.type === "self" ? employeeId : input.evaluatorEmployeeId ?? "",
      evaluatorAccountId: undefined,
    });
  }

  function selectEvaluator(employeeId: string): void {
    setInput({ ...input, evaluatorEmployeeId: employeeId, evaluatorAccountId: undefined });
  }

  return <div className="quarterly-admin-panel">
    <section className="detail-section">
      <div className="detail-section-heading"><div><span className="eyebrow">任务名单</span><h2>本周期任务名单</h2><p className="field-hint">关系共 {rosterRows.length} 条：已建任务 {tasks.length} 条，待处理来源关系 {pendingRelations.length} 条。</p></div><ClipboardList size={20} /></div>
      {rosterLocked ? <div className="form-message" role="status"><ShieldAlert size={15} />{rosterLockMessage}</div> : null}
      {canBindPendingRelations && period?.status === "open" && pendingRelations.length > 0 ? <div className="form-message" role="status"><ShieldAlert size={15} />本周期已开放；可逐条核对并绑定待处理来源关系，每次绑定只创建一条任务并更新名单版本。</div> : null}
      {!rosterLocked && assignmentOptionsLoading ? <div className="form-message" role="status"><LoaderCircle size={15} />正在读取完整人员名单。</div> : null}
      {!rosterLocked && assignmentOptionsError ? <div className="form-message form-message-error" role="alert"><ShieldAlert size={15} />{assignmentOptionsError}<button className="text-button" type="button" onClick={onRetryAssignmentOptions}>重试读取人员名单</button></div> : null}
      {!rosterLocked ? <div className="editor-actions quarterly-roster-operation-entry">
        <button className="secondary-button compact-button" type="button" aria-expanded={assignmentFormOpen} aria-controls="quarterly-manual-assignment-form" disabled={Boolean(editingTaskId)} onClick={() => setManualAssignmentOpen((open) => !open)}>{editingTaskId ? "正在编辑单项任务" : assignmentFormOpen ? "收起单项安排" : "手动安排单项任务"}</button>
        {relationshipOperationsAvailable ? <button className="secondary-button compact-button" type="button" aria-expanded={relationshipOperationsOpen} aria-controls="quarterly-relationship-operations" onClick={() => setRelationshipOperationsOpen((open) => !open)}>{relationshipOperationsOpen ? "收起批量任务操作" : "查看批量任务操作"}</button> : null}
      </div> : null}
      <div id="quarterly-manual-assignment-form" hidden={!assignmentFormOpen}><section className="detail-section">
        <div className="detail-section-heading"><div><span className="eyebrow">手动安排单项任务</span><h3>{editingTaskId ? "编辑评价任务" : "手动安排单项任务"}</h3></div><UsersRound size={20} /></div>
        <div className="form-grid form-grid-three">
          <label className="field"><span className="field-label">评价类型</span><select className="field-control" aria-label="评价类型" value={input.type} disabled={busy || rosterLocked} onChange={(event) => selectType(event.target.value as QuarterlyReviewType)}>{REVIEW_TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className="field"><span className="field-label">搜索评价人</span><input className="field-control" type="search" aria-label="搜索评价人姓名或部门" value={evaluatorSearch} disabled={busy || rosterLocked || assignmentOptionsLoading || input.type === "self"} onChange={(event) => setEvaluatorSearch(event.target.value)} placeholder="按员工姓名或部门搜索" /></label>
          <label className="field"><span className="field-label">评价人<em>*</em></span><select className="field-control" aria-label="选择评价人" value={evaluatorEmployeeId} disabled={busy || rosterLocked || assignmentOptionsLoading || input.type === "self"} onChange={(event) => selectEvaluator(event.target.value)}><option value="">{assignmentOptionsLoading ? "正在读取人员名单…" : input.type === "self" ? "由被评价员工本人完成" : "请选择评价人"}</option>{filteredEvaluators.map((employee) => <option value={employee.employeeId} key={employee.employeeId}>{assignmentEmployeeLabel(employee)}</option>)}</select>{input.type === "self" ? <span className="field-hint">自评由同一员工身份确定。</span> : null}</label>
          <label className="field"><span className="field-label">搜索被评价员工</span><input className="field-control" type="search" aria-label="搜索被评价员工姓名或部门" value={employeeSearch} disabled={busy || rosterLocked || assignmentOptionsLoading} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="按员工姓名或部门搜索" /></label>
          <label className="field"><span className="field-label">被评价员工<em>*</em></span><select className="field-control" aria-label="选择被评价员工" value={input.evaluateeEmployeeId} disabled={busy || rosterLocked || assignmentOptionsLoading} onChange={(event) => selectEmployee(event.target.value)}><option value="">{assignmentOptionsLoading ? "正在读取员工名单…" : "请选择被评价员工"}</option>{filteredEmployees.map((employee) => <option value={employee.employeeId} key={employee.employeeId}>{assignmentEmployeeLabel(employee)}</option>)}</select></label>
          <label className="field"><span className="field-label">任务截止时间</span><input className="field-control" type="datetime-local" value={toDateTimeLocalValue(input.dueAt)} disabled={busy || rosterLocked} onChange={(event) => setInput({ ...input, dueAt: toShanghaiIsoValue(event.target.value) })} /><span className="field-hint">按北京时间填写；留空时沿用周期截止时间。</span></label>
        </div>
        {editingTaskId ? <div className="form-message"><Pencil size={15} />同一评价关系可直接修改截止时间；更改评价类型或人员时，会先撤销原任务，再安排新任务。</div> : null}
        <div className="editor-actions">{editingTaskId ? <button className="secondary-button compact-button" type="button" disabled={busy} onClick={onCancelEdit}>取消编辑</button> : null}<button className="primary-button" type="button" disabled={busy || rosterLocked || assignmentOptionsLoading || !selectedEvaluator || !input.evaluateeEmployeeId.trim()} onClick={() => void onAssign()}><UsersRound size={15} />{busy ? "保存中…" : editingTaskId ? "保存修改" : "安排单项任务"}</button></div>
      </section></div>
      {period?.status === "draft" && !period.rosterLocked && canSchedulePeriod ? <div className="field-hint">本季度预计于 {formatDueAt(quarterlyNaturalOpeningAt(period.periodKey))} 按北京时间自然开放。</div> : null}
      <div id="quarterly-relationship-operations" hidden={!relationshipOperationsOpen || !relationshipOperationsAvailable || !period || rosterLocked}>
      {relationshipOperationsOpen && relationshipOperationsAvailable && period && !rosterLocked ? <>
      {canCopyPrevious ? <div className="quarterly-materialization-panel">
        <div className="detail-section-heading"><div><span className="eyebrow">上季度关系复制</span><h3>从上季度复制任务关系</h3></div><ClipboardList size={20} /></div>
        <div className="form-message"><ClipboardList size={15} /><span>只复制评价关系，不复制评分、评价记录或上季度截止时间；新任务使用本季度默认规则。</span></div>
        {copyPreview ? <>
          <div className="record-list" aria-live="polite">
            <div className="audit-action-button"><strong>复制范围</strong><span>{copyPreview.sourcePeriodName} → {copyPreview.targetPeriodName}</span></div>
            <div className="audit-action-button"><strong>来源任务</strong><span>有效 {copyPreview.sourceActiveTaskCount} 项 · 非活动已忽略 {copyPreview.ignoredInactiveCount} 项</span></div>
            <div className="audit-action-button"><strong>可复制</strong><span>{copyPreview.eligibleCount} 项</span></div>
            <div className="audit-action-button"><strong>复制前目标已有</strong><span>{copyPreview.alreadyPresentCount} 项</span></div>
            <div className="audit-action-button"><strong>身份异常</strong><span>{copyPreview.identityErrorCount} 项</span></div>
            <div className="audit-action-button"><strong>来源重复</strong><span>{copyPreview.duplicateSourceCount} 项</span></div>
            <div className="audit-action-button"><strong>目标重复</strong><span>{copyPreview.duplicateTargetCount} 项</span></div>
            <div className="audit-action-button"><strong>记录冲突</strong><span>{copyPreview.recordConflictCount} 项</span></div>
            <div className="audit-action-button"><strong>冲突汇总</strong><span>{copyPreview.conflictCount} 项</span></div>
          </div>
          {copyPreview.eligibleCount > 0 ? <label className="field quarterly-materialization-ack"><span className="field-label">确认复制</span><span><input type="checkbox" checked={copyAcknowledged} disabled={copyExecuting || rosterLocked} onChange={(event) => setCopyAcknowledged(event.target.checked)} /> 我已核对范围，确认仅复制 {copyPreview.eligibleCount} 项可复制关系；其余已有或有问题的关系保持不变。</span></label> : <div className="field-hint">当前没有可复制的关系；已有任务不会被覆盖。</div>}
        </> : null}
        <div className="editor-actions">
          <button className="secondary-button compact-button" type="button" disabled={rosterLocked || copyPreviewLoading || copyExecuting} onClick={() => void onPreviewPreviousTaskCopy()}>{copyPreviewLoading ? "正在核对…" : copyPreview ? "重新核对" : "预览上季度关系"}</button>
          {copyPreview ? <button className="primary-button compact-button" type="button" disabled={rosterLocked || copyPreviewLoading || copyExecuting || !copyAcknowledged || copyPreview.eligibleCount < 1} onClick={() => void onCopyPreviousTasks()}>{copyExecuting ? "正在复制…" : "确认复制关系"}</button> : null}
        </div>
       </div> : null}
      {canMaterialize ? <div className="quarterly-materialization-panel">
        <div className="detail-section-heading"><div><span className="eyebrow">已确认关系批量生成</span><h3>从已确认关系批量生成任务</h3></div><ClipboardList size={20} /></div>
        <div className="form-message"><ClipboardList size={15} /><span>只处理已确认员工编号映射的关系；未匹配或有冲突的项目不会生成任务。</span></div>
        {materializationPreview ? <>
          <div className="record-list" aria-live="polite">
            <div className="audit-action-button"><strong>{materializationPreview.periodName}：可生成</strong><span>{materializationPreview.eligibleCount} 项</span></div>
            <div className="audit-action-button"><strong>已存在</strong><span>{materializationPreview.alreadyMaterializedCount} 项</span></div>
            <div className="audit-action-button"><strong>未匹配</strong><span>{materializationPreview.unmatchedCount} 项</span></div>
            <div className="audit-action-button"><strong>需核对</strong><span>{materializationPreview.conflictCount} 项</span></div>
          </div>
          {materializationPreview.eligibleCount > 0 ? <label className="field quarterly-materialization-ack"><span className="field-label">确认生成</span><span><input type="checkbox" checked={materializationAcknowledged} disabled={materializationExecuting || rosterLocked} onChange={(event) => setMaterializationAcknowledged(event.target.checked)} /> 我已核对预检结果，确认生成 {materializationPreview.eligibleCount} 项评价任务。</span></label> : null}
        </> : null}
        <div className="editor-actions">
          <button className="secondary-button compact-button" type="button" disabled={rosterLocked || materializationPreviewLoading || materializationExecuting} onClick={() => void onPreviewMaterialization()}>{materializationPreviewLoading ? "正在核对…" : materializationPreview ? "重新核对已确认关系" : "预检可批量生成关系"}</button>
          {materializationPreview ? <button className="primary-button compact-button" type="button" disabled={rosterLocked || materializationPreviewLoading || materializationExecuting || !materializationAcknowledged || materializationPreview.eligibleCount < 1} onClick={() => void onMaterializeConfirmed()}>{materializationExecuting ? "正在生成…" : "确认批量生成任务"}</button> : null}
        </div>
       </div> : null}
       </> : null}
       </div>
      <div className="quarterly-roster-category-panel">
        <div className="segmented-control quarterly-roster-category-filter" role="group" aria-label="筛选任务类别">
          {ADMIN_ROSTER_CATEGORIES.map((category) => <button
            className={rosterCategory === category.value ? "is-active" : ""}
            type="button"
            aria-pressed={rosterCategory === category.value}
            key={category.value}
            onClick={() => selectRosterCategory(category.value)}
          >{category.label}（{rosterCategoryCounts[category.value]}）</button>)}
        </div>
      </div>
      {filteredRosterRows.length ? <div className="audit-table-wrap quarterly-roster-table-wrap"><table className="audit-table quarterly-roster-table"><thead><tr><th>评价人</th><th>评价关系</th><th>被评价人</th><th>任务状态</th><th>截止时间</th><th>操作</th></tr></thead><tbody>{visibleRosterRows.map((row) => {
        if (row.kind === "pending") {
          const relation = row.relation;
          const evaluator = employeeById(relation.evaluatorEmployeeIdSnapshot);
          const studentEvaluator = students.find((student) => student.studentId === relation.evaluatorStudentIdSnapshot);
          const evaluatee = employeeById(relation.evaluateeEmployeeId);
          const evaluatorName = evaluator?.name || studentEvaluator?.name || relation.evaluatorStudentNameSnapshot || relation.evaluatorNameSnapshot || "评价人姓名未提供";
          const evaluateeName = evaluatee?.name || relation.evaluateeNameSnapshot || "被评价人";
          const evaluatorDepartment = evaluator?.department.trim() || (evaluator ? "未填写部门" : studentEvaluator || relation.evaluatorStudentIdSnapshot ? "学员评价人" : "员工档案未匹配");
          const selectedStudentId = pendingStudentSelections[relation.id] ?? "";
          const studentSearch = pendingStudentSearch[relation.id] ?? "";
          const filteredPendingStudents = students.filter((student) => matchesSearch([student.name, student.studentId], studentSearch));
          const canBindThisRelation = canBindPendingRelations
            && Boolean(period && (period.status === "draft" || period.status === "open"))
            && relation.type !== "self"
            && !relation.evaluatorEmployeeIdSnapshot;
          const bindingInProgress = bindingRelationId !== null;
          const acknowledgementChecked = pendingRelationAcknowledgements[relation.id] === true;
          return <tr key={row.key}>
            <td data-label="评价人"><div className="quarterly-roster-cell"><strong>{evaluatorName}</strong><span>{evaluatorDepartment}</span></div></td>
            <td data-label="评价关系"><div className="quarterly-roster-cell"><strong>{relation.typeLabel}</strong><span>{evaluatorName} → {evaluateeName}</span></div></td>
            <td data-label="被评价人"><div className="quarterly-roster-cell"><strong>{evaluateeName}</strong><span>{evaluatee?.department || relation.evaluateeDepartmentSnapshot || "未填写部门"}</span></div></td>
            <td data-label="任务状态"><div className="quarterly-roster-cell"><span className="status-badge status-pending">{evaluator ? "待生成任务" : "评价人未匹配，待处理"}</span><span>当前不是可填写的评价任务</span></div></td>
            <td data-label="截止时间"><span className="date-cell">生成任务后确定</span></td>
            <td data-label="操作"><div className="quarterly-roster-cell">
              {relation.type === "self" ? <span className="field-hint">自评关系只能绑定员工身份，不能转为学员评价任务。</span>
                : relation.evaluatorEmployeeIdSnapshot ? <span className="field-hint">已有员工身份记录，不能覆盖为学员身份。</span>
                  : !canBindPendingRelations ? <span className="field-hint">当前运行模式不支持手动绑定。</span>
                    : period && !["draft", "open"].includes(period.status) ? <span className="field-hint">周期已关闭或归档，不能绑定。</span>
                      : <>
                        <label className="field"><span className="field-label">搜索学员档案</span><input className="field-control" type="search" aria-label={`搜索${relation.id}的评价人学员档案`} value={studentSearch} disabled={busy || bindingInProgress || assignmentOptionsLoading || availableStudents.length === 0} onChange={(event) => setPendingStudentSearch((current) => ({ ...current, [relation.id]: event.target.value }))} placeholder="按姓名或档案编号搜索" /></label>
                        <label className="field"><span className="field-label">明确选择评价人学员档案</span><select className="field-control" aria-label={`为${relation.id}选择评价人学员档案`} value={selectedStudentId} disabled={busy || bindingInProgress || assignmentOptionsLoading || filteredPendingStudents.length === 0} onChange={(event) => {
                          const nextStudentId = event.target.value;
                          setPendingStudentSelections((current) => ({ ...current, [relation.id]: nextStudentId }));
                          setPendingRelationAcknowledgements((current) => ({ ...current, [relation.id]: false }));
                        }}><option value="">请选择学员档案（{filteredPendingStudents.length}/{availableStudents.length}）</option>{filteredPendingStudents.map((student) => <option key={student.studentId} value={student.studentId}>{student.name} · 档案编号 {student.studentId}</option>)}</select></label>
                        <span className="field-hint">来源姓名仅供核对，不会按姓名自动匹配。请按档案编号确认身份。</span>
                        {assignmentOptionsLoading ? <span className="field-hint">正在读取有效学员账号名单。</span>
                          : availableStudents.length === 0 ? <span className="field-hint">目前没有关联到唯一有效登录账号的在读学员档案。</span> : null}
                        <label className="field"><span className="field-label">确认绑定</span><span><input type="checkbox" aria-label={`确认已核对${relation.id}的来源关系与学员身份`} checked={acknowledgementChecked} disabled={busy || bindingInProgress || !selectedStudentId} onChange={(event) => setPendingRelationAcknowledgements((current) => ({ ...current, [relation.id]: event.target.checked }))} /> 我已核对这条来源关系和所选学员档案。</span></label>
                        <button className="primary-button compact-button" type="button" disabled={busy || bindingInProgress || !canBindThisRelation || !selectedStudentId || !acknowledgementChecked || assignmentOptionsLoading} onClick={() => void onBindPendingRelation(relation.id, selectedStudentId)}>{bindingRelationId === relation.id ? "正在创建任务…" : "确认绑定并创建任务"}</button>
                      </>}
            </div></td>
          </tr>;
        }
        const { task } = row;
        const evaluator = evaluatorForTask(task);
        const studentEvaluator = students.find((student) => student.studentId === task.evaluatorStudentIdSnapshot);
        const evaluatee = employeeById(task.evaluateeEmployeeId);
        const evaluatorName = evaluator?.name || studentEvaluator?.name || task.evaluatorNameSnapshot || "评价人";
        const evaluateeName = evaluatee?.name || task.evaluateeNameSnapshot || "被评价人";
        const evaluatorDepartment = evaluator?.department.trim() || (evaluator ? "未填写部门" : studentEvaluator || task.evaluatorStudentIdSnapshot ? "学员评价人" : "员工档案未匹配");
        return <tr key={row.key}>
          <td data-label="评价人"><div className="quarterly-roster-cell"><strong>{evaluatorName}</strong><span>{evaluatorDepartment}</span></div></td>
          <td data-label="评价关系"><div className="quarterly-roster-cell"><strong>{task.typeLabel}</strong><span>{evaluatorName} → {evaluateeName}</span></div></td>
          <td data-label="被评价人"><div className="quarterly-roster-cell"><strong>{evaluateeName}</strong><span>{evaluatee?.department || task.evaluateeDepartmentSnapshot || "未填写部门"}</span></div></td>
          <td data-label="任务状态"><div className="quarterly-roster-cell"><span className={`status-badge status-${taskStatusClass(task)}`}>{taskStatusText(task)}</span><span>{task.record?.total === null || task.record?.total === undefined ? "尚未形成总分" : `总分 ${task.record.total}`}</span></div></td>
          <td data-label="截止时间"><span className="date-cell">{formatDueAt(task.dueAt)}</span></td>
          <td data-label="操作"><div className="editor-actions">{task.status === "active" && !rosterLocked ? <><button className="text-button" type="button" disabled={busy || !taskIsEditable(task)} onClick={() => onEditTask(task)}><Pencil size={14} />{editingTaskId === task.id ? "正在编辑" : "编辑"}</button><button className="text-button" type="button" disabled={busy || !taskIsEditable(task)} onClick={() => void onRevokeTask(task)}><Ban size={14} />撤销</button>{task.sourceLocked ? <span className="field-hint">来源名单任务须在迁移核对流程处理</span> : task.record ? <span className="field-hint">已有评价记录，不能编辑或撤销</span> : task.sourceLocked !== false || !Number.isInteger(task.version) ? <span className="field-hint">任务状态未核实，刷新后再操作</span> : null}</> : null}<button className="text-button" type="button" disabled={!onOpenEmployeeHistory} onClick={() => onOpenEmployeeHistory?.(task.evaluateeEmployeeId)}><History size={14} />员工历史</button></div></td>
        </tr>;
      })}</tbody></table></div> : <div className="empty-inline"><ClipboardList size={17} /><span>{rosterCategory === "pending" ? "当前季度没有待处理关系。" : rosterCategory === "all" ? "当前周期还没有评价关系。可先核对来源关系，再为员工安排新任务。" : `当前季度暂无${ADMIN_ROSTER_CATEGORIES.find((category) => category.value === rosterCategory)?.label ?? "此类"}任务。`}</span></div>}
      {filteredRosterRows.length ? <div className="list-footer quarterly-roster-list-footer">
        <span aria-live="polite">每页 {EMPLOYEE_LIST_PAGE_SIZE} 条 · 显示 {rosterRangeStart}–{rosterRangeEnd} 条，共 {filteredRosterRows.length} 条</span>
        <button className="secondary-button compact-button" type="button" aria-label="上一页" disabled={currentRosterPage === 1} onClick={() => setRosterPage((page) => Math.max(page - 1, 1))}>上一页</button>
        {Array.from({ length: rosterPageCount }, (_, index) => index + 1).map((page) => <button className={page === currentRosterPage ? "primary-button compact-button" : "secondary-button compact-button"} type="button" aria-label={`第${page}页`} aria-current={page === currentRosterPage ? "page" : undefined} onClick={() => setRosterPage(page)} key={page}>{page}</button>)}
        <button className="secondary-button compact-button" type="button" aria-label="下一页" disabled={currentRosterPage === rosterPageCount} onClick={() => setRosterPage((page) => Math.min(page + 1, rosterPageCount))}>下一页</button>
      </div> : null}
    </section>
  </div>;
}
