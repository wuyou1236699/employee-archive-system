import { app } from "./cloudbaseAdapter";
import { toUserFacingServiceError } from "./dataService";
import { parseQuarterlyTimestamp, TASK_AVAILABILITY_MESSAGES } from "../quarterly/taskAvailability";
import {
  calculateQuarterlyTotal,
  getQuarterlyValidationReport,
} from "../quarterly/quarterlyValidation";
import { QUARTERLY_SCORING_STANDARD } from "../quarterly/scoringStandards";
import {
  QUARTERLY_DIMENSIONS,
  QUARTERLY_TYPE_LABELS,
  type QuarterlyAssignmentAccount,
  type QuarterlyAssignmentEmployee,
  type QuarterlyAssignmentStudent,
  type QuarterlyAssignmentOptions,
  type QuarterlyHistoryQuery,
  type QuarterlyManagerActionInput,
  type QuarterlyOverview,
  type QuarterlyPendingRelation,
  type QuarterlyPendingRelationBindingResult,
  type QuarterlyPeriod,
  type QuarterlyPeriodInput,
  type QuarterlyPeriodScheduleInput,
  type QuarterlyPeriodStatus,
  type QuarterlyRecord,
  type QuarterlyRecordFilters,
  type QuarterlyRecordStatus,
  type QuarterlyRecordSummary,
  type QuarterlyReasons,
  type QuarterlyRevisionInput,
  type QuarterlyResultItem,
  type QuarterlyReviewService,
  type QuarterlyReviewType,
  type QuarterlyScores,
  type QuarterlyTask,
  type QuarterlyTaskAssignmentInput,
  type QuarterlyTaskCopyPreview,
  type QuarterlyTaskCopyResult,
  type QuarterlyTaskMaterializationPreview,
  type QuarterlyTaskMaterializationResult,
  type QuarterlyTaskAvailability,
  type QuarterlyTaskDraftInput,
  type QuarterlyTaskFilters,
  type QuarterlyTaskSaveInput,
  type ServiceResult,
} from "../quarterly/types";

const REVIEW_TYPES: readonly QuarterlyReviewType[] = ["self", "first", "second"];
const RECORD_STATUSES: readonly QuarterlyRecordStatus[] = ["draft", "submitted", "returned", "void"];
const PERIOD_STATUSES: readonly QuarterlyPeriodStatus[] = ["draft", "open", "closed", "archived"];
const PREVIEW_ACCOUNT_ID = "preview-admin";
const PREVIEW_ACCOUNT_NAME = "体验模式管理员";
const PREVIEW_ACCOUNT_EMPLOYEE_ID = "preview-employee-1";
const PREVIEW_DEPARTMENT = "预览组";
const PREVIEW_DUE_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;
const PERIOD_NOT_OPEN_MESSAGE = "季度周期当前未开放填写。";
const TASK_REVOKED_MESSAGE = "该季度评价任务已撤销。";
const SELF_NOT_BOUND_MESSAGE = "自评必须先绑定本人员工身份。";
const SELF_MISMATCH_MESSAGE = "自评只能评价当前账号绑定的本人员工。";

export interface QuarterlyPreviewClock {
  now: () => Date;
  monotonicNow: () => number;
}

export interface LocalPreviewQuarterlyReviewServiceOptions {
  clock?: Partial<QuarterlyPreviewClock>;
  now?: () => Date;
  monotonicNow?: () => number;
  currentAccountId?: string;
  /** Local-only fixture injection; never sent to the cloud service. */
  seed?: {
    periods?: QuarterlyPeriod[];
    tasks?: QuarterlyTask[];
    records?: QuarterlyRecord[];
    assignmentOptions?: QuarterlyAssignmentOptions;
  };
}

export interface QuarterlyTaskDetail {
  task: QuarterlyTask;
  record: QuarterlyRecord | null;
}

export interface QuarterlyTaskDetailReader {
  getTaskDetail(taskId: string): QuarterlyTaskDetail | null | Promise<QuarterlyTaskDetail | null>;
}

export interface QuarterlyFunctionClient {
  callFunction(input: { name: string; data: Record<string, unknown> }): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function failure<T>(message: string): ServiceResult<T> {
  return { ok: false, message };
}

function success<T>(data: T): ServiceResult<T> {
  return { ok: true, data: clone(data) };
}

function errorMessage(error: unknown, fallback: string): string {
  return toUserFacingServiceError(error, fallback);
}

export function quarterlyNaturalOpeningAt(periodKey: string): string | null {
  const match = /^(\d{4})-Q([1-4])$/i.exec(periodKey.trim());
  if (!match) return null;
  const month = (Number(match[2]) - 1) * 3 + 1;
  return `${match[1]}-${String(month).padStart(2, "0")}-01T00:00:00+08:00`;
}

export function beijingCurrentQuarterKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year}-Q${quarter}`;
}

function isPermissionError(error: unknown): boolean {
  const message = errorMessage(error, "").toLowerCase();
  return message.includes("权限") || message.includes("无权") || message.includes("permission") || message.includes("forbidden");
}

interface ParsedDueAt {
  value: string;
  timestamp: number;
}

interface DueAtSelection {
  dueAt: string | null;
  invalid: boolean;
}

function parseDueAt(value: unknown): ParsedDueAt | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (!trimmed) return null;
  const timestamp = parseQuarterlyTimestamp(trimmed);
  return timestamp !== null ? { value: trimmed, timestamp } : "invalid";
}

function effectivePeriodStatus(period: QuarterlyPeriod | undefined, serverNow: string): QuarterlyPeriodStatus | null {
  if (!period) return null;
  if (period.status === "closed" || period.status === "archived") return period.status;
  const opensAt = parseDueAt(period.opensAt);
  const now = parseDueAt(serverNow);
  if (opensAt === "invalid" || now === "invalid") return "draft";
  if (opensAt && now && now.timestamp < opensAt.timestamp) return "draft";
  if (period.status === "draft" && opensAt && now && now.timestamp >= opensAt.timestamp) return "open";
  return period.status;
}

function selectEarliestDueAt(...values: unknown[]): DueAtSelection {
  let earliest: ParsedDueAt | null = null;
  for (const value of values) {
    const parsed = parseDueAt(value);
    if (parsed === "invalid") {
      return { dueAt: null, invalid: true };
    }
    if (parsed && (!earliest || parsed.timestamp < earliest.timestamp)) earliest = parsed;
  }
  return { dueAt: earliest?.value ?? null, invalid: false };
}

function makeScores(score: number): QuarterlyScores {
  return {
    任务完成: score,
    规范执行: score,
    问题处理: score,
    沟通协作: score,
    学习成长: score,
    服务支持: score,
  };
}

function makeReasons(text: string): QuarterlyReasons {
  return {
    任务完成: text,
    规范执行: text,
    问题处理: text,
    沟通协作: text,
    学习成长: text,
    服务支持: text,
  };
}

function makeSummary(record: QuarterlyRecord): QuarterlyRecordSummary {
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

function makePeriod(previewNow: string, dueAt: string | null, overrides: Partial<QuarterlyPeriod> = {}): QuarterlyPeriod {
  return {
    id: "quarterly-period-2026-q3",
    periodKey: "2026-Q3",
    periodName: "2026 年第三季度",
    status: "open",
    resultVisibility: "hidden",
    scoringStandardVersion: "showcase-standard-v1",
    rosterVersion: 1,
    version: 1,
    rosterLocked: false,
    opensAt: null,
    dueAt,
    taskCount: 3,
    submittedTaskCount: 1,
    updatedAt: previewNow,
    ...overrides,
  };
}

function makeTask(
  id: string,
  type: QuarterlyReviewType,
  employeeId: string,
  employeeName: string,
  department: string,
  dueAt: string | null,
  record: QuarterlyRecordSummary | null,
): QuarterlyTask {
  return {
    id,
    version: 1,
    sourceLocked: false,
    periodKey: "2026-Q3",
    periodName: "2026 年第三季度",
    type,
    typeLabel: QUARTERLY_TYPE_LABELS[type],
    evaluatorAccountId: PREVIEW_ACCOUNT_ID,
    evaluatorNameSnapshot: PREVIEW_ACCOUNT_NAME,
    evaluatorEmployeeIdSnapshot: PREVIEW_ACCOUNT_EMPLOYEE_ID,
    evaluatorStudentIdSnapshot: null,
    evaluateeEmployeeId: employeeId,
    evaluateeNameSnapshot: employeeName,
    evaluateeDepartmentSnapshot: department,
    status: "active",
    dueAt,
    record,
  };
}

function makeRecord(
  id: string,
  task: QuarterlyTask,
  status: QuarterlyRecordStatus,
  scores: QuarterlyScores,
  reasons: QuarterlyReasons,
  version: number,
  updatedAt: string,
  returnedReason: string | null = null,
): QuarterlyRecord {
  return {
    id,
    taskId: task.id,
    periodKey: task.periodKey,
    periodName: task.periodName,
    type: task.type,
    typeLabel: task.typeLabel,
    evaluatorAccountId: task.evaluatorAccountId,
    evaluatorNameSnapshot: task.evaluatorNameSnapshot,
    evaluateeEmployeeId: task.evaluateeEmployeeId,
    evaluateeNameSnapshot: task.evaluateeNameSnapshot,
    evaluateeDepartmentSnapshot: task.evaluateeDepartmentSnapshot,
    scores,
    reasons,
    isReceived: false,
    resultVisible: false,
    managementEdited: false,
    actualOperatorName: null,
    status,
    total: calculateQuarterlyTotal(scores),
    version,
    updatedAt,
    submittedAt: status === "submitted" ? updatedAt : null,
    returnedReason,
  };
}

function updateTaskSummary(task: QuarterlyTask, record: QuarterlyRecord | null): void {
  task.record = record ? makeSummary(record) : null;
}

function taskIsPending(task: QuarterlyTask): boolean {
  return task.record === null || task.record.status === "draft" || task.record.status === "returned";
}

function matchesTaskFilters(task: QuarterlyTask, filters: QuarterlyTaskFilters): boolean {
  if (filters.periodKey && task.periodKey !== filters.periodKey) return false;
  if (filters.type !== "all" && task.type !== filters.type) return false;
  if (filters.status === "pending" && !taskIsPending(task)) return false;
  if (filters.status !== "all" && filters.status !== "pending" && task.record?.status !== filters.status) return false;
  return task.status === "active";
}

function standardResultFromRecord(record: QuarterlyRecord): QuarterlyResultItem {
  return {
    id: record.id,
    periodKey: record.periodKey,
    periodName: record.periodName,
    type: record.type,
    typeLabel: record.typeLabel,
    direction: "submitted",
    status: record.status,
    evaluatorName: record.evaluatorNameSnapshot,
    evaluateeName: record.evaluateeNameSnapshot,
    total: record.total,
    scores: clone(record.scores),
    reasons: clone(record.reasons),
    published: true,
  };
}

function periodId(periodKey: string): string {
  return `quarterly-period-${periodKey.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function isReviewType(value: unknown): value is QuarterlyReviewType {
  return typeof value === "string" && REVIEW_TYPES.includes(value as QuarterlyReviewType);
}

function isRecordStatus(value: unknown): value is QuarterlyRecordStatus {
  return typeof value === "string" && RECORD_STATUSES.includes(value as QuarterlyRecordStatus);
}

function isPeriodStatus(value: unknown): value is QuarterlyPeriodStatus {
  return typeof value === "string" && PERIOD_STATUSES.includes(value as QuarterlyPeriodStatus);
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`季度评价响应缺少有效的${label}。`);
  return value;
}

function asText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`季度评价响应中的${label}格式无效。`);
  return value;
}

function asNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`季度评价响应中的${label}格式无效。`);
  return value;
}

function asExplicitNullableString(source: Record<string, unknown>, key: string, label: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    throw new Error(`季度评价响应缺少有效的${label}。`);
  }
  const value = source[key];
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`季度评价响应中的${label}格式无效。`);
  }
  return value;
}

function asOptionalString(value: unknown, label: string): string {
  if (value === null || value === undefined || value === "") return "";
  return asString(value, label);
}

function asInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`季度评价响应中的${label}格式无效。`);
  }
  return value;
}

function asNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`季度评价响应中的${label}格式无效。`);
  return value;
}

function asBoolean(value: unknown, label: string, defaultValue = false): boolean {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "boolean") throw new Error(`季度评价响应中的${label}格式无效。`);
  return value;
}

function asScores(value: unknown, label = "六维分数"): QuarterlyScores {
  if (!isRecord(value)) throw new Error(`季度评价响应中的${label}格式无效。`);
  const scores = {} as QuarterlyScores;
  for (const dimension of QUARTERLY_DIMENSIONS) {
    const score = value[dimension];
    if (score !== null && (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 25)) {
      throw new Error(`季度评价响应中的${label}无效：${dimension}。`);
    }
    scores[dimension] = score === undefined ? null : score;
  }
  return scores;
}

function asReasons(value: unknown, label = "评价理由"): QuarterlyReasons {
  if (!isRecord(value)) throw new Error(`季度评价响应中的${label}格式无效。`);
  const reasons = {} as QuarterlyReasons;
  for (const dimension of QUARTERLY_DIMENSIONS) {
    const reason = value[dimension];
    if (typeof reason !== "string") throw new Error(`季度评价响应中的${label}无效：${dimension}。`);
    reasons[dimension] = reason;
  }
  return reasons;
}

function asRecordSummary(value: unknown): QuarterlyRecordSummary {
  if (!isRecord(value)) throw new Error("季度评价响应中的记录摘要格式无效。");
  const status = value.status;
  if (!isRecordStatus(status)) throw new Error("季度评价响应中的记录状态无效。");
  return {
    id: asString(value.id, "记录编号"),
    status,
    total: asNullableNumber(value.total, "总分"),
    version: asInteger(value.version, "记录版本"),
    updatedAt: asNullableString(value.updatedAt, "更新时间"),
    submittedAt: asNullableString(value.submittedAt, "提交时间"),
    returnedReason: asNullableString(value.returnedReason, "退回理由"),
  };
}

function asPeriod(value: unknown): QuarterlyPeriod {
  if (!isRecord(value)) throw new Error("未返回有效季度评价周期。");
  const status = value.status;
  if (!isPeriodStatus(status)) throw new Error("季度评价响应中的周期状态无效。");
  const resultVisibility = value.resultVisibility;
  if (resultVisibility !== "hidden" && resultVisibility !== "published") {
    throw new Error("季度评价响应中的结果公布状态无效。");
  }
  return {
    id: asString(value.id, "周期编号"),
    periodKey: asString(value.periodKey, "周期标识"),
    periodName: asString(value.periodName, "周期名称"),
    status,
    resultVisibility,
    scoringStandardVersion: asString(value.scoringStandardVersion, "评分标准版本"),
    rosterVersion: asInteger(value.rosterVersion, "名单版本"),
    version: asInteger(value.version ?? 1, "周期版本"),
    rosterLocked: value.rosterLocked === undefined ? false : asBoolean(value.rosterLocked, "名单锁定状态"),
    opensAt: asNullableString(value.opensAt ?? null, "开放时间"),
    dueAt: asNullableString(value.dueAt, "截止时间"),
    taskCount: asInteger(value.taskCount, "任务数量"),
    submittedTaskCount: asInteger(value.submittedTaskCount, "已提交任务数量"),
    updatedAt: asNullableString(value.updatedAt, "更新时间"),
  };
}

function asTaskAvailability(value: unknown): QuarterlyTaskAvailability {
  if (!isRecord(value)) throw new Error("未返回有效季度评价可填写状态。");
  const canWrite = value.canWrite;
  if (typeof canWrite !== "boolean") throw new Error("季度评价响应中的可填写状态格式无效。");
  const reason = asExplicitNullableString(value, "reason", "可填写原因");
  const opensAt = asNullableString(value.opensAt, "开始填写时间");
  const dueAt = asExplicitNullableString(value, "dueAt", "截止时间");
  const serverNow = asString(value.serverNow, "服务器时间").trim();
  if (parseQuarterlyTimestamp(serverNow) === null
    || (opensAt !== null && parseQuarterlyTimestamp(opensAt) === null)
    || (dueAt !== null && parseQuarterlyTimestamp(dueAt) === null)) {
    throw new Error("季度评价响应中的时间格式无效。");
  }
  return { canWrite, reason, opensAt, dueAt, serverNow };
}

function asAssignmentAccount(value: unknown): QuarterlyAssignmentAccount {
  if (!isRecord(value)) throw new Error("季度评价响应中的账号选项格式无效。");
  const status = value.status;
  if (status !== "active" && status !== "disabled") throw new Error("季度评价响应中的账号状态无效。");
  return {
    accountId: asString(value.accountId, "账号编号"),
    displayName: asText(value.displayName, "账号显示名"),
    username: asText(value.username, "登录账号"),
    employeeId: asExplicitNullableString(value, "employeeId", "绑定员工编号"),
    employeeName: asExplicitNullableString(value, "employeeName", "绑定员工姓名"),
    department: asText(value.department, "账号部门"),
    status,
  };
}

function asAssignmentEmployee(value: unknown): QuarterlyAssignmentEmployee {
  if (!isRecord(value)) throw new Error("季度评价响应中的员工选项格式无效。");
  const status = value.status;
  if (status !== "active" && status !== "former" && status !== "archived") {
    throw new Error("季度评价响应中的员工状态无效。");
  }
  return {
    employeeId: asString(value.employeeId, "员工编号"),
    name: asText(value.name, "员工姓名"),
    department: asText(value.department, "员工部门"),
    status,
  };
}

function asAssignmentStudent(value: unknown): QuarterlyAssignmentStudent {
  if (!isRecord(value)) throw new Error("季度评价响应中的学员选项格式无效。");
  return {
    studentId: asString(value.studentId, "学员编号"),
    name: asText(value.name, "学员姓名"),
  };
}

function asAssignmentOptions(value: unknown): QuarterlyAssignmentOptions {
  if (!isRecord(value) || !Array.isArray(value.accounts) || !Array.isArray(value.employees)) {
    throw new Error("未返回有效季度评价人员选项。");
  }
  return {
    accounts: value.accounts.map(asAssignmentAccount),
    employees: value.employees.map(asAssignmentEmployee),
    students: Array.isArray(value.students) ? value.students.map(asAssignmentStudent) : [],
  };
}

function asTask(value: unknown): QuarterlyTask {
  if (!isRecord(value)) throw new Error("未返回有效季度评价任务。");
  const type = value.type;
  if (!isReviewType(type)) throw new Error("季度评价响应中的任务类型无效。");
  const status = value.status;
  if (status !== "active" && status !== "revoked") throw new Error("季度评价响应中的任务状态无效。");
  const record = value.record === null || value.record === undefined ? null : asRecordSummary(value.record);
  const availability = Object.prototype.hasOwnProperty.call(value, "availability")
    ? asTaskAvailability(value.availability)
    : undefined;
  return {
    id: asString(value.id, "任务编号"),
    version: value.version === undefined ? undefined : asInteger(value.version, "任务版本"),
    sourceLocked: value.sourceLocked === undefined ? undefined : asBoolean(value.sourceLocked, "来源名单锁定状态"),
    periodKey: asString(value.periodKey, "周期标识"),
    periodName: asString(value.periodName, "周期名称"),
    type,
    typeLabel: asString(value.typeLabel, "任务类型名称"),
    evaluatorAccountId: asNullableString(value.evaluatorAccountId, "评价人账号"),
    evaluatorNameSnapshot: asText(value.evaluatorNameSnapshot, "评价人姓名"),
    evaluatorEmployeeIdSnapshot: asExplicitNullableString(value, "evaluatorEmployeeIdSnapshot", "评价人档案编号"),
    evaluatorStudentIdSnapshot: Object.prototype.hasOwnProperty.call(value, "evaluatorStudentIdSnapshot")
      ? asExplicitNullableString(value, "evaluatorStudentIdSnapshot", "评价人学员编号")
      : null,
    evaluateeEmployeeId: asString(value.evaluateeEmployeeId, "被评价人档案编号"),
    evaluateeNameSnapshot: asText(value.evaluateeNameSnapshot, "被评价人姓名"),
    evaluateeDepartmentSnapshot: asText(value.evaluateeDepartmentSnapshot, "被评价人部门"),
    status,
    dueAt: asNullableString(value.dueAt, "截止时间"),
    availability,
    record,
  };
}

function asQuarterlyPendingRelation(value: unknown): QuarterlyPendingRelation {
  if (!isRecord(value)) throw new Error("未返回有效的待处理来源关系。");
  const type = value.type;
  if (!isReviewType(type)) throw new Error("待处理来源关系中的任务类型无效。");
  if (value.status !== "pending_binding") throw new Error("待处理来源关系状态无效。");
  return {
    id: asString(value.id, "待处理关系编号"),
    sourceRelationId: asString(value.sourceRelationId, "来源关系编号"),
    periodKey: asString(value.periodKey, "周期标识"),
    periodName: asString(value.periodName, "周期名称"),
    type,
    typeLabel: asString(value.typeLabel, "任务类型名称"),
    status: "pending_binding",
    evaluatorNameSnapshot: asString(value.evaluatorNameSnapshot, "评价人来源姓名"),
    evaluatorEmployeeIdSnapshot: asOptionalString(value.evaluatorEmployeeIdSnapshot, "评价人档案编号") || null,
    evaluatorStudentIdSnapshot: asOptionalString(value.evaluatorStudentIdSnapshot, "评价人学员编号") || null,
    evaluatorStudentNameSnapshot: asOptionalString(value.evaluatorStudentNameSnapshot, "评价人学员姓名") || null,
    evaluateeEmployeeId: asString(value.evaluateeEmployeeId, "被评价人档案编号"),
    evaluateeNameSnapshot: asString(value.evaluateeNameSnapshot, "被评价人姓名"),
    evaluateeDepartmentSnapshot: asText(value.evaluateeDepartmentSnapshot, "被评价人部门"),
  };
}

function asRecord(value: unknown): QuarterlyRecord {
  if (!isRecord(value)) throw new Error("未返回有效季度评价记录。");
  const type = value.type;
  if (!isReviewType(type)) throw new Error("季度评价响应中的记录类型无效。");
  const status = value.status;
  if (!isRecordStatus(status)) throw new Error("季度评价响应中的记录状态无效。");
  return {
    ...asRecordSummary(value),
    taskId: asString(value.taskId, "任务编号"),
    periodKey: asString(value.periodKey, "周期标识"),
    periodName: asString(value.periodName, "周期名称"),
    type,
    typeLabel: asString(value.typeLabel, "任务类型名称"),
    evaluatorAccountId: asOptionalString(value.evaluatorAccountId, "评价人账号"),
    evaluatorNameSnapshot: asText(value.evaluatorNameSnapshot, "评价人姓名"),
    evaluateeEmployeeId: asString(value.evaluateeEmployeeId, "被评价人档案编号"),
    evaluateeNameSnapshot: asText(value.evaluateeNameSnapshot, "被评价人姓名"),
    evaluateeDepartmentSnapshot: asText(value.evaluateeDepartmentSnapshot, "被评价人部门"),
    scores: asScores(value.scores),
    reasons: asReasons(value.reasons),
    isReceived: asBoolean(value.isReceived, "接收标记"),
    resultVisible: asBoolean(value.resultVisible, "结果可见标记"),
    managementEdited: asBoolean(value.managementEdited, "管理员修订标记"),
    actualOperatorName: asNullableString(value.actualOperatorName, "实际操作人"),
    status,
  };
}

function asResultItem(value: unknown): QuarterlyResultItem {
  if (!isRecord(value)) throw new Error("未返回有效季度评价结果。");
  const type = value.type;
  if (!isReviewType(type)) throw new Error("季度评价响应中的结果类型无效。");
  const direction = value.direction;
  if (direction !== "submitted" && direction !== "received") throw new Error("季度评价响应中的结果方向无效。");
  const status = value.status;
  if (status !== "unpublished" && !isRecordStatus(status)) throw new Error("季度评价响应中的结果状态无效。");
  const published = asBoolean(value.published, "公布标记");
  const visible = published && status !== "unpublished";
  return {
    id: asString(value.id, "结果编号"),
    periodKey: asString(value.periodKey, "周期标识"),
    periodName: asString(value.periodName, "周期名称"),
    type,
    typeLabel: asString(value.typeLabel, "结果类型名称"),
    direction,
    status: visible ? status : "unpublished",
    evaluatorName: visible ? asNullableString(value.evaluatorName, "评价人姓名") : null,
    evaluateeName: visible ? asNullableString(value.evaluateeName, "被评价人姓名") : null,
    total: visible ? asNullableNumber(value.total, "结果总分") : null,
    scores: visible && value.scores !== null && value.scores !== undefined ? asScores(value.scores, "结果六维分数") : null,
    reasons: visible && value.reasons !== null && value.reasons !== undefined ? asReasons(value.reasons, "结果评价理由") : null,
    published: visible,
  };
}

function asTaskDetail(value: unknown): QuarterlyTaskDetail {
  const source = readObject(value, "季度评价任务详情", ["detail"]);
  const task = asTask(source.task ?? source);
  const recordValue = source.record;
  return {
    task,
    record: recordValue === null || recordValue === undefined ? null : asRecord(recordValue),
  };
}

function readArray(value: unknown, label: string, keys: readonly string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    for (const key of keys) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  throw new Error(`未返回有效${label}列表。`);
}

function readObject(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`未返回有效${label}。`);
  for (const key of keys) {
    const nested = value[key];
    if (isRecord(nested)) return nested;
  }
  return value;
}

function asTypeCounts(value: unknown): { total: number; submitted: number; pending: number } {
  if (!isRecord(value)) throw new Error("季度评价响应中的类型统计格式无效。");
  return {
    total: asInteger(value.total, "类型任务数"),
    submitted: asInteger(value.submitted, "类型已提交数"),
    pending: asInteger(value.pending, "类型待处理数"),
  };
}

function asOverview(value: unknown): QuarterlyOverview {
  const source = readObject(value, "季度评价总览", ["overview"]);
  const period = source.period === null || source.period === undefined ? null : asPeriod(source.period);
  const periods = readArray(source.periods, "季度评价周期", ["items", "periods"]).map(asPeriod);
  if (!isRecord(source.byType)) throw new Error("季度评价响应中的类型统计缺失。");
  const byType = {
    self: asTypeCounts(source.byType.self),
    first: asTypeCounts(source.byType.first),
    second: asTypeCounts(source.byType.second),
  };
  return {
    period,
    periods,
    taskCount: asInteger(source.taskCount, "任务数量"),
    submittedTaskCount: asInteger(source.submittedTaskCount, "已提交任务数量"),
    draftTaskCount: asInteger(source.draftTaskCount, "草稿任务数量"),
    returnedTaskCount: asInteger(source.returnedTaskCount, "退回任务数量"),
    revokedTaskCount: asInteger(source.revokedTaskCount, "作废任务数量"),
    completionRate: asNullableNumber(source.completionRate, "完成率"),
    byType,
    tasks: source.tasks === undefined ? [] : readArray(source.tasks, "季度评价任务", ["items", "tasks"]).map(asTask),
    pendingRelations: source.pendingRelations === undefined
      ? []
      : readArray(source.pendingRelations, "待处理来源关系", ["items", "pendingRelations"]).map(asQuarterlyPendingRelation),
    records: readArray(source.records, "季度评价记录", ["items", "records"]).map(asRecord),
  };
}

function asTaskMaterializationPreview(value: unknown): QuarterlyTaskMaterializationPreview {
  const source = readObject(value, "任务预检结果", ["preview"]);
  return {
    periodKey: asString(source.periodKey, "预检周期标识"),
    periodName: asString(source.periodName, "预检周期名称"),
    previewToken: asString(source.previewToken, "预检确认标记"),
    eligibleCount: asInteger(source.eligibleCount, "可生成任务数"),
    alreadyMaterializedCount: asInteger(source.alreadyMaterializedCount, "已生成任务数"),
    unmatchedCount: asInteger(source.unmatchedCount, "未匹配数量"),
    conflictCount: asInteger(source.conflictCount, "冲突数量"),
  };
}

function asTaskMaterializationResult(value: unknown): QuarterlyTaskMaterializationResult {
  const source = readObject(value, "任务生成结果", ["result"]);
  return {
    periodKey: asString(source.periodKey, "执行周期标识"),
    createdCount: asInteger(source.createdCount, "新建任务数"),
    reusedCount: asInteger(source.reusedCount, "复用任务数"),
    skippedCount: asInteger(source.skippedCount, "跳过数量"),
    processedCount: asInteger(source.processedCount, "已处理任务数"),
    remainingCount: asInteger(source.remainingCount, "剩余任务数"),
    conflictCount: asInteger(source.conflictCount, "冲突数量"),
    failedCount: asInteger(source.failedCount, "失败数量"),
    errorSummary: source.errorSummary === undefined
      ? []
      : readArray(source.errorSummary, "任务处理提示", ["items"]).map((item) => asText(item, "任务处理提示")),
    complete: asBoolean(source.complete, "执行完成状态"),
  };
}

function asTaskCopySummary(source: Record<string, unknown>): Omit<QuarterlyTaskCopyPreview, "previewToken"> {
  return {
    targetPeriodKey: asString(source.targetPeriodKey, "目标周期标识"),
    sourcePeriodKey: asString(source.sourcePeriodKey, "来源周期标识"),
    targetPeriodName: asString(source.targetPeriodName, "目标周期名称"),
    sourcePeriodName: asString(source.sourcePeriodName, "来源周期名称"),
    targetVersion: asInteger(source.targetVersion, "目标周期版本"),
    sourceActiveTaskCount: asInteger(source.sourceActiveTaskCount, "来源活动任务数"),
    ignoredInactiveCount: asInteger(source.ignoredInactiveCount, "忽略的非活动任务数"),
    eligibleCount: asInteger(source.eligibleCount, "可复制任务数"),
    alreadyPresentCount: asInteger(source.alreadyPresentCount, "已存在任务数"),
    identityErrorCount: asInteger(source.identityErrorCount, "身份异常数量"),
    duplicateSourceCount: asInteger(source.duplicateSourceCount, "来源重复数量"),
    duplicateTargetCount: asInteger(source.duplicateTargetCount, "目标重复数量"),
    recordConflictCount: asInteger(source.recordConflictCount, "记录冲突数量"),
    conflictCount: asInteger(source.conflictCount, "其他冲突数量"),
  };
}

function asTaskCopyPreview(value: unknown): QuarterlyTaskCopyPreview {
  const source = readObject(value, "上季度任务预检结果", ["preview"]);
  return {
    ...asTaskCopySummary(source),
    previewToken: asString(source.previewToken, "复制预检标记"),
  };
}

function asTaskCopyResult(value: unknown): QuarterlyTaskCopyResult {
  const source = readObject(value, "上季度任务复制结果", ["result"]);
  return {
    ...asTaskCopySummary(source),
    copiedCount: asInteger(source.copiedCount, "复制任务数"),
    processedCount: asInteger(source.processedCount, "已处理任务数"),
    remainingCount: asInteger(source.remainingCount, "剩余任务数"),
    failedCount: asInteger(source.failedCount, "复制失败数"),
    errorSummary: source.errorSummary === undefined
      ? []
      : readArray(source.errorSummary, "复制处理提示", ["items"]).map((item) => asText(item, "复制处理提示")),
    complete: asBoolean(source.complete, "复制完成状态"),
  };
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
  return toUserFacingServiceError(error, "系统暂时无法完成季度评价操作，请稍后重试。");
}

function unwrapCloudFunctionResponse(response: unknown): unknown {
  const outer = isRecord(response) ? response : {};
  const result = isRecord(outer.result) ? outer.result : undefined;
  const ok = result?.ok ?? outer.ok;
  if (ok === false || outer.error !== undefined || result?.error !== undefined) {
    throw new Error(getCloudFunctionError(response));
  }
  return getCloudFunctionPayload(response);
}

function resultPayload(value: unknown, keys: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  for (const key of keys) {
    if (key in value) return value[key];
  }
  return value;
}

function deriveUserPeriods(tasks: QuarterlyTask[], results: QuarterlyResultItem[]): QuarterlyPeriod[] {
  const seeds = new Map<string, { periodName: string; dueAt: string | null; taskCount: number; submittedTaskCount: number }>();
  for (const task of tasks) {
    const current = seeds.get(task.periodKey) ?? {
      periodName: task.periodName,
      dueAt: task.dueAt,
      taskCount: 0,
      submittedTaskCount: 0,
    };
    current.taskCount += 1;
    if (task.record?.status === "submitted") current.submittedTaskCount += 1;
    if (!current.dueAt && task.dueAt) current.dueAt = task.dueAt;
    seeds.set(task.periodKey, current);
  }
  for (const result of results) {
    if (!seeds.has(result.periodKey)) {
      seeds.set(result.periodKey, {
        periodName: result.periodName,
        dueAt: null,
        taskCount: 0,
        submittedTaskCount: 0,
      });
    }
  }
  return [...seeds.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, seed]) => ({
      id: periodId(key),
      periodKey: key,
      periodName: seed.periodName || key,
      status: "open",
      resultVisibility: "hidden",
      scoringStandardVersion: QUARTERLY_SCORING_STANDARD.version,
      rosterVersion: 1,
      version: 1,
      rosterLocked: true,
      opensAt: null,
      dueAt: seed.dueAt,
      taskCount: seed.taskCount,
      submittedTaskCount: seed.submittedTaskCount,
      updatedAt: null,
    }));
}

export class LocalPreviewQuarterlyReviewService implements QuarterlyReviewService, QuarterlyTaskDetailReader {
  readonly mode = "local-preview" as const;
  private readonly periods: QuarterlyPeriod[];
  private readonly tasks: QuarterlyTask[];
  private readonly records: QuarterlyRecord[];
  private readonly now: () => Date;
  private readonly currentAccountId: string;
  private readonly currentEmployeeId: string | null;
  private readonly assignmentOptions: QuarterlyAssignmentOptions;

  constructor(options: LocalPreviewQuarterlyReviewServiceOptions = {}) {
    this.now = options.clock?.now ?? options.now ?? (() => new Date());
    this.currentAccountId = options.currentAccountId ?? PREVIEW_ACCOUNT_ID;
    const previewNow = this.nowIso();
    // Keep the demonstration quarter stable; only its example filling window moves.
    const dueAt = new Date(Date.parse(previewNow) + PREVIEW_DUE_OFFSET_MS).toISOString();
    this.periods = clone(options.seed?.periods ?? [makePeriod(previewNow, dueAt)]);
    const employees: QuarterlyAssignmentEmployee[] = [1, 2, 3].map((number) => ({
      employeeId: `preview-employee-${number}`, name: `测试${number}`, department: PREVIEW_DEPARTMENT, status: "active",
    }));
    this.assignmentOptions = clone(options.seed?.assignmentOptions ?? {
      employees,
      students: [],
      accounts: [
        { accountId: PREVIEW_ACCOUNT_ID, displayName: PREVIEW_ACCOUNT_NAME, username: "development-preview", employeeId: PREVIEW_ACCOUNT_EMPLOYEE_ID, employeeName: "测试1", department: PREVIEW_DEPARTMENT, status: "active" },
        { accountId: "preview-user-2", displayName: "测试2", username: "test2", employeeId: "preview-employee-2", employeeName: "测试2", department: PREVIEW_DEPARTMENT, status: "active" },
        { accountId: "preview-user-3", displayName: "测试3", username: "test3", employeeId: "preview-employee-3", employeeName: "测试3", department: PREVIEW_DEPARTMENT, status: "active" },
        { accountId: "preview-unbound", displayName: "未绑定体验账号", username: "test-unbound", employeeId: null, employeeName: null, department: "", status: "active" },
        { accountId: "preview-disabled", displayName: "已停用体验账号", username: "test-disabled", employeeId: null, employeeName: null, department: "", status: "disabled" },
      ],
    });
    this.currentEmployeeId = this.assignmentOptions.accounts.find((account) => account.accountId === this.currentAccountId)?.employeeId ?? null;
    const draftTask = makeTask("quarterly-task-2", "first", "preview-employee-2", "测试2", PREVIEW_DEPARTMENT, dueAt, null);
    const submittedTask = makeTask("quarterly-task-3", "second", "preview-employee-3", "测试3", PREVIEW_DEPARTMENT, dueAt, null);
    const draftRecord = makeRecord("quarterly-record-2", draftTask, "draft", { ...makeScores(18), 问题处理: null }, makeReasons(""), 1, previewNow);
    const submittedRecord = makeRecord("quarterly-record-3", submittedTask, "submitted", makeScores(22), makeReasons("以具体行动完成本季度目标。"), 2, previewNow);
    updateTaskSummary(draftTask, draftRecord);
    updateTaskSummary(submittedTask, submittedRecord);
    this.tasks = clone(options.seed?.tasks ?? [
      makeTask("quarterly-task-1", "self", "preview-employee-1", "测试1", PREVIEW_DEPARTMENT, dueAt, null),
      draftTask,
      submittedTask,
    ]);
    this.records = clone(options.seed?.records ?? [draftRecord, submittedRecord]);
    this.refreshPeriodCounts("2026-Q3");
  }

  listPeriods(): QuarterlyPeriod[] {
    const serverNow = this.nowIso();
    return clone(this.periods.map((period) => ({
      ...period,
      status: effectivePeriodStatus(period, serverNow) ?? period.status,
    })));
  }

  getMyTasks(filters: QuarterlyTaskFilters): QuarterlyTask[] {
    return this.tasks.filter((task) => this.isCurrentEvaluator(task) && matchesTaskFilters(task, filters)).map((task) => this.taskWithAvailability(task));
  }

  getMyResults(periodKey?: string): QuarterlyResultItem[] {
    const submitted = this.records
      .filter((record) => record.evaluatorAccountId === this.currentAccountId && record.status === "submitted" && (!periodKey || record.periodKey === periodKey))
      .map(standardResultFromRecord);
    return clone(submitted);
  }

  getTask(taskId: string): QuarterlyTask | undefined {
    const task = this.tasks.find((item) => item.id === taskId && this.isCurrentEvaluator(item));
    return task ? this.taskWithAvailability(task) : undefined;
  }

  getTaskDetail(taskId: string): QuarterlyTaskDetail | null {
    const task = this.tasks.find((item) => item.id === taskId && this.isCurrentEvaluator(item));
    if (!task) return null;
    const record = this.records.find((item) => item.taskId === taskId) ?? null;
    return { task: this.taskWithAvailability(task), record: record ? clone(record) : null };
  }

  saveDraft(input: QuarterlyTaskDraftInput): ServiceResult<QuarterlyRecord> {
    return this.saveRecord(input, "draft");
  }

  submit(input: QuarterlyTaskDraftInput): ServiceResult<QuarterlyRecord> {
    return this.saveRecord(input, "submitted");
  }

  getOverview(periodKey: string): ServiceResult<QuarterlyOverview> {
    const period = this.periods.find((item) => item.periodKey === periodKey) ?? null;
    const allTasks = this.tasks.filter((task) => task.periodKey === periodKey);
    const tasks = allTasks.filter((task) => task.status === "active");
    const records = this.records.filter((record) => record.periodKey === periodKey);
    const byType = {
      self: this.typeCounts(tasks, "self"),
      first: this.typeCounts(tasks, "first"),
      second: this.typeCounts(tasks, "second"),
    };
    const submittedTaskCount = tasks.filter((task) => task.record?.status === "submitted").length;
    const overview: QuarterlyOverview = {
      period,
      periods: clone(this.periods),
      taskCount: tasks.length,
      submittedTaskCount,
      draftTaskCount: tasks.filter((task) => task.record?.status === "draft").length,
      returnedTaskCount: tasks.filter((task) => task.record?.status === "returned").length,
      revokedTaskCount: allTasks.filter((task) => task.status === "revoked" || task.record?.status === "void").length,
      completionRate: tasks.length ? submittedTaskCount / tasks.length : null,
      byType,
      tasks: allTasks.map((task) => this.taskWithAvailability(task)),
      pendingRelations: [],
      records: clone(records),
    };
    return success(overview);
  }

  listRecords(filters: QuarterlyRecordFilters): QuarterlyRecord[] {
    const keyword = filters.keyword.trim().toLowerCase();
    return clone(this.records.filter((record) => {
      if (filters.periodKey && record.periodKey !== filters.periodKey) return false;
      if (filters.type !== "all" && record.type !== filters.type) return false;
      if (filters.status !== "all" && record.status !== filters.status) return false;
      if (keyword && !`${record.evaluateeNameSnapshot} ${record.evaluatorNameSnapshot} ${record.evaluateeDepartmentSnapshot}`.toLowerCase().includes(keyword)) return false;
      return true;
    }));
  }

  listRecordsAll(filters: QuarterlyRecordFilters): QuarterlyRecord[] {
    return this.listRecords(filters);
  }

  returnRecord(input: QuarterlyManagerActionInput): ServiceResult<QuarterlyRecord> {
    return this.changeRecordStatus(input, "returned");
  }

  voidRecord(input: QuarterlyManagerActionInput): ServiceResult<QuarterlyRecord> {
    return this.changeRecordStatus(input, "void");
  }

  reviseRecord(input: QuarterlyRevisionInput): ServiceResult<QuarterlyRecord> {
    const reason = input.reason.trim();
    if (!reason) return failure("请填写管理员修订或代录原因。");
    const report = getQuarterlyValidationReport(input.scores, input.reasons, "submit");
    if (!report.ok) return failure(report.message);
    const record = this.records.find((item) => item.id === input.recordId);
    if (!record) return failure("未找到要修订的季度评价记录。");
    if (record.status === "void") return failure("已作废的季度评价记录不能修订。");
    if (record.version !== input.expectedVersion) return failure("这条评价已被其他操作更新，请刷新后再试。");
    record.scores = clone(input.scores);
    record.reasons = clone(input.reasons);
    record.total = report.total;
    record.status = "submitted";
    record.version += 1;
    record.updatedAt = this.nowIso();
    record.submittedAt = record.submittedAt ?? record.updatedAt;
    record.returnedReason = null;
    record.managementEdited = true;
    record.actualOperatorName = "体验模式管理员";
    const task = this.tasks.find((item) => item.id === record.taskId);
    if (task) updateTaskSummary(task, record);
    this.refreshPeriodCounts(record.periodKey);
    return success(record);
  }

  savePeriod(input: QuarterlyPeriodInput): ServiceResult<QuarterlyPeriod> {
    const periodKey = input.periodKey.trim();
    const periodName = input.periodName.trim();
    if (!periodKey || !periodName) return failure("请填写周期标识和周期名称。");
    const parsedOpensAt = parseDueAt(input.opensAt);
    if (parsedOpensAt === "invalid") return failure(TASK_AVAILABILITY_MESSAGES.invalidOpensAt);
    const parsedDueAt = parseDueAt(input.dueAt);
    if (parsedDueAt === "invalid") return failure(TASK_AVAILABILITY_MESSAGES.invalidTime);
    if (parsedOpensAt && parsedDueAt && parsedOpensAt.timestamp >= parsedDueAt.timestamp) {
      return failure("开放时间必须早于截止时间。");
    }
    const current = this.periods.find((item) => item.periodKey === periodKey);
    if (current) {
      if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
        return failure("周期设置已变化，请刷新后重试。");
      }
      const currentStatus = effectivePeriodStatus(current, this.nowIso());
      const currentOpensAt = parseDueAt(current.opensAt);
      const nextOpensAt = input.opensAt === undefined ? current.opensAt : parsedOpensAt?.value ?? null;
      const nextOpensAtParsed = parseDueAt(nextOpensAt);
      if (currentStatus === "open" && currentOpensAt !== "invalid"
        && (nextOpensAtParsed === "invalid" || currentOpensAt?.timestamp !== nextOpensAtParsed?.timestamp)) {
        return failure("周期开放后不能调整开始填写时间。");
      }
      const currentDueAt = parseDueAt(current.dueAt);
      if (currentStatus === "open" && currentDueAt !== "invalid"
        && currentDueAt?.timestamp !== parsedDueAt?.timestamp) {
        return failure("周期开放后不能调整截止时间。");
      }
      if (currentStatus === "open" && currentDueAt !== "invalid"
        && currentDueAt?.timestamp !== parsedDueAt?.timestamp) {
        return failure("周期开放后不能调整截止时间。");
      }
      if (currentStatus === "open" && input.status === "draft") {
        return failure("周期开始填写后不能恢复为草稿。");
      }
      if (currentStatus === "closed" && input.status !== "closed" && input.status !== "archived") {
        return failure("已关闭的周期不能重新开放。");
      }
      if (currentStatus === "archived" && input.status !== "archived") {
        return failure("已归档的周期不能恢复。");
      }
      current.periodName = periodName;
      current.status = input.status;
      current.opensAt = nextOpensAt;
      current.dueAt = parsedDueAt?.value ?? null;
      current.scoringStandardVersion = input.scoringStandardVersion.trim() || current.scoringStandardVersion;
      current.version += 1;
      current.updatedAt = this.nowIso();
      return success({ ...current, status: effectivePeriodStatus(current, this.nowIso()) ?? current.status });
    }
    const next: QuarterlyPeriod = {
      id: `quarterly-period-${periodKey.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      periodKey,
      periodName,
      status: input.status,
      resultVisibility: "hidden",
      scoringStandardVersion: input.scoringStandardVersion.trim() || "showcase-standard-v1",
      rosterVersion: 1,
      version: 1,
      rosterLocked: false,
      opensAt: parsedOpensAt?.value ?? null,
      dueAt: parsedDueAt?.value ?? null,
      taskCount: 0,
      submittedTaskCount: 0,
      updatedAt: this.nowIso(),
    };
    this.periods.push(next);
    return success({ ...next, status: effectivePeriodStatus(next, this.nowIso()) ?? next.status });
  }

  schedulePeriod(input: QuarterlyPeriodScheduleInput): ServiceResult<QuarterlyPeriod> {
    const period = this.periods.find((item) => item.periodKey === input.periodKey);
    if (!period) return failure("未找到要开放的季度周期。");
    const opensAt = quarterlyNaturalOpeningAt(period.periodKey);
    if (!opensAt) return failure("季度编号无效，无法计算自然开放时间。");
    if (period.status === "closed" || period.status === "archived") return failure("已关闭或归档的周期不能开放。");
    if (period.rosterLocked && period.opensAt === opensAt) {
      return success({ ...period, status: effectivePeriodStatus(period, this.nowIso()) ?? period.status });
    }
    if (period.version !== input.expectedVersion) return failure("周期设置已变化，请刷新后重试。");
    if (period.taskCount < 1) return failure("请先完成评价任务名单，再确认按季度开放。");
    const dueAt = parseDueAt(period.dueAt);
    const opening = parseDueAt(opensAt);
    if (dueAt === "invalid" || opening === "invalid" || (dueAt && opening && dueAt.timestamp <= opening.timestamp)) {
      return failure("截止时间必须晚于季度开放时间。");
    }
    period.opensAt = opensAt;
    period.rosterLocked = true;
    period.version += 1;
    period.updatedAt = this.nowIso();
    return success({ ...period, status: effectivePeriodStatus(period, this.nowIso()) ?? period.status });
  }

  getAssignmentOptions(): QuarterlyAssignmentOptions {
    return clone(this.assignmentOptions);
  }

  bindPendingRelationToStudent(): ServiceResult<QuarterlyPendingRelationBindingResult> {
    return failure("体验模式不支持绑定待处理来源关系。");
  }

  assignTask(input: QuarterlyTaskAssignmentInput): ServiceResult<QuarterlyTask> {
    const legacyAccountId = input.evaluatorAccountId?.trim() ?? "";
    const legacyAccount = this.assignmentOptions.accounts.find((item) => item.accountId === legacyAccountId);
    const evaluatorEmployeeId = input.evaluatorEmployeeId?.trim() || legacyAccount?.employeeId?.trim() || "";
    if (!evaluatorEmployeeId) {
      if (input.type === "self" && legacyAccount?.status === "active" && !legacyAccount.employeeId) {
        return failure(SELF_NOT_BOUND_MESSAGE);
      }
      return failure("请选择评价人档案。");
    }
    return this.saveTask({ ...input, evaluatorEmployeeId });
  }

  saveTask(input: QuarterlyTaskSaveInput): ServiceResult<QuarterlyTask> {
    if (!isReviewType(input.type)) return failure("评价类型不合法。");
    const period = this.periods.find((item) => item.periodKey === input.periodKey);
    if (!period) return failure("未找到要分配任务的季度周期。");
    if (effectivePeriodStatus(period, this.nowIso()) !== "draft") return failure("周期开放后不能再新增或修改评价任务。");
    const legacyAccountId = input.evaluatorAccountId?.trim() ?? "";
    const evaluatorEmployeeId = input.evaluatorEmployeeId.trim();
    const evaluateeEmployeeId = input.evaluateeEmployeeId.trim();
    if (!evaluatorEmployeeId || !evaluateeEmployeeId) return failure("请选择评价人和被评价员工。");
    const evaluator = this.assignmentOptions.employees.find((item) => item.employeeId === evaluatorEmployeeId);
    const evaluatee = this.assignmentOptions.employees.find((item) => item.employeeId === evaluateeEmployeeId);
    if (!evaluator) return failure("未找到评价人档案。");
    if (evaluator.status !== "active") return failure("评价人必须是在职员工。");
    if (!evaluatee) return failure("未找到被评价员工档案。");
    const legacyAccount = legacyAccountId
      ? this.assignmentOptions.accounts.find((item) => item.accountId === legacyAccountId)
      : undefined;
    if (legacyAccountId && (!legacyAccount || legacyAccount.status !== "active" || legacyAccount.employeeId !== evaluatorEmployeeId)) {
      return failure("旧账号信息与所选评价人不一致，请按员工身份重新选择。");
    }
    if (input.type === "self" && evaluatorEmployeeId !== evaluateeEmployeeId) return failure(SELF_MISMATCH_MESSAGE);
    const parsedDueAt = parseDueAt(input.dueAt);
    if (parsedDueAt === "invalid") return failure(TASK_AVAILABILITY_MESSAGES.invalidTime);
    const existing = this.tasks.find((task) => {
      const legacyEvaluatorEmployeeId = task.evaluatorAccountId
        ? this.assignmentOptions.accounts.find((account) => account.accountId === task.evaluatorAccountId)?.employeeId
        : null;
      return task.periodKey === input.periodKey
        && task.type === input.type
        && (task.evaluatorEmployeeIdSnapshot ?? legacyEvaluatorEmployeeId) === evaluatorEmployeeId
        && task.evaluateeEmployeeId === evaluateeEmployeeId;
    });
    if (input.status === "revoked" && input.expectedVersion === undefined) {
      return failure("撤销任务时缺少版本信息，请刷新后重试。");
    }
    if (existing?.record) return failure("已有评价记录的任务不能编辑或撤销。");
    if (input.expectedVersion !== undefined && (!existing || (existing.version ?? 1) !== input.expectedVersion)) {
      return failure("评价任务已被其他操作更新，请刷新后重试。");
    }
    if (existing?.status === "active" && input.status !== "revoked" && input.expectedVersion === undefined) {
      return failure("相同周期、类型和评价关系的任务已存在。");
    }
    if (existing) {
      existing.status = input.status ?? "active";
      existing.dueAt = parsedDueAt?.value ?? null;
      existing.version = (existing.version ?? 1) + 1;
      this.refreshPeriodCounts(period.periodKey);
      return success(this.taskWithAvailability(existing));
    }
    const task: QuarterlyTask = {
      id: `quarterly-task:v2:${period.periodKey}:${input.type}:${evaluatorEmployeeId}:${evaluateeEmployeeId}`,
      version: 1,
      sourceLocked: false,
      periodKey: period.periodKey,
      periodName: period.periodName,
      type: input.type,
      typeLabel: QUARTERLY_TYPE_LABELS[input.type],
      evaluatorAccountId: null,
      evaluatorNameSnapshot: evaluator.name,
      evaluatorEmployeeIdSnapshot: evaluatorEmployeeId,
      evaluatorStudentIdSnapshot: null,
      evaluateeEmployeeId,
      evaluateeNameSnapshot: evaluatee.name,
      evaluateeDepartmentSnapshot: evaluatee.department,
      status: "active",
      dueAt: parsedDueAt?.value ?? null,
      record: null,
    };
    this.tasks.push(task);
    this.refreshPeriodCounts(period.periodKey);
    return success(this.taskWithAvailability(task));
  }

  previewConfirmedTaskMaterialization(periodKey: string): ServiceResult<QuarterlyTaskMaterializationPreview> {
    const period = this.periods.find((item) => item.periodKey === periodKey);
    if (!period) return failure("未找到要核对的季度周期。");
    return success({
      periodKey: period.periodKey,
      periodName: period.periodName,
      previewToken: `local-preview:${period.periodKey}`,
      eligibleCount: 0,
      alreadyMaterializedCount: 0,
      unmatchedCount: 0,
      conflictCount: 0,
    });
  }

  materializeConfirmedTasks(input: { periodKey: string; acknowledged: true; expectedEligibleCount: number; expectedPreviewToken: string }): ServiceResult<QuarterlyTaskMaterializationResult> {
    const period = this.periods.find((item) => item.periodKey === input.periodKey);
    if (!period) return failure("未找到要处理的季度周期。");
    if (input.expectedEligibleCount !== 0) return failure("预览数量已变化，请重新核对后再操作。");
    return success({
      periodKey: period.periodKey,
      createdCount: 0,
      reusedCount: 0,
      skippedCount: 0,
      processedCount: 0,
      remainingCount: 0,
      conflictCount: 0,
      failedCount: 0,
      errorSummary: [],
      complete: true,
    });
  }

  previewPreviousTaskCopy(): ServiceResult<QuarterlyTaskCopyPreview> {
    return failure("请在正式管理页面核对上季度任务。体验模式不会读取或复制云端任务。");
  }

  copyPreviousTasks(): ServiceResult<QuarterlyTaskCopyResult> {
    return failure("请在正式管理页面复制上季度任务。体验模式不会写入云端任务。");
  }

  listEmployeeHistory(query: QuarterlyHistoryQuery): QuarterlyRecord[] {
    return clone(this.records.filter((record) => record.evaluateeEmployeeId === query.employeeId && (!query.periodKey || record.periodKey === query.periodKey)));
  }

  private saveRecord(input: QuarterlyTaskDraftInput, status: "draft" | "submitted"): ServiceResult<QuarterlyRecord> {
    const task = this.tasks.find((item) => item.id === input.taskId);
    if (!task) return failure("未找到要保存的季度评价任务。");
    if (!this.isCurrentEvaluator(task)) return failure("当前账号不能提交未分配的季度评价任务。");
    const availability = this.getAvailability(task);
    if (!availability.canWrite) return failure(availability.reason ?? TASK_AVAILABILITY_MESSAGES.refresh);
    const identityError = this.writeIdentityError(task);
    if (identityError) return failure(identityError);
    const report = getQuarterlyValidationReport(input.scores, input.reasons, status === "submitted" ? "submit" : "draft");
    if (!report.ok) return failure(report.message);
    if (task.record && task.record.version !== input.expectedVersion) return failure("这条评价已被其他操作更新，请刷新后再试。");
    if (task.record?.status === "void") return failure("已作废的评价不能再次修改。");

    const existing = this.records.find((record) => record.taskId === task.id);
    const record = makeRecord(
      existing?.id ?? `quarterly-record-${task.id}`,
      task,
      status,
      clone(input.scores),
      clone(input.reasons),
      (existing?.version ?? 0) + 1,
      availability.serverNow,
      null,
    );
    // Synchronous preview writes have no await gap; re-read before committing as well.
    const latestAvailability = this.getAvailability(task);
    if (!latestAvailability.canWrite) return failure(latestAvailability.reason ?? TASK_AVAILABILITY_MESSAGES.refresh);
    const latestIdentityError = this.writeIdentityError(task);
    if (latestIdentityError) return failure(latestIdentityError);
    if (existing) {
      const index = this.records.indexOf(existing);
      this.records[index] = record;
    } else {
      this.records.push(record);
    }
    updateTaskSummary(task, record);
    this.refreshPeriodCounts(task.periodKey);
    return success(record);
  }

  private changeRecordStatus(input: QuarterlyManagerActionInput, status: "returned" | "void"): ServiceResult<QuarterlyRecord> {
    const reason = input.reason.trim();
    if (!reason) return failure((status === "returned" ? "请填写退回理由。" : "请填写作废理由。"));
    const record = this.records.find((item) => item.id === input.recordId);
    if (!record) return failure("未找到要处理的季度评价记录。");
    if (status === "returned" && record.status === "void") return failure("已作废的季度评价记录不能退回。");
    if (record.version !== input.expectedVersion) return failure("这条评价已被其他操作更新，请刷新后再试。");
    record.status = status;
    record.returnedReason = status === "returned" ? reason : null;
    record.version += 1;
    record.updatedAt = this.nowIso();
    const task = this.tasks.find((item) => item.id === record.taskId);
    if (task) updateTaskSummary(task, record);
    this.refreshPeriodCounts(record.periodKey);
    return success(record);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private getAvailability(task: QuarterlyTask): QuarterlyTaskAvailability {
    const serverNow = this.nowIso();
    const period = this.periods.find((item) => item.periodKey === task.periodKey);
    const deadline = selectEarliestDueAt(period?.dueAt, task.dueAt);
    let reason: string | null = null;
    if (deadline.invalid) reason = TASK_AVAILABILITY_MESSAGES.invalidTime;
    else if (parseDueAt(period?.opensAt) === "invalid") reason = TASK_AVAILABILITY_MESSAGES.invalidOpensAt;
    else if (effectivePeriodStatus(period, serverNow) !== "open") reason = PERIOD_NOT_OPEN_MESSAGE;
    else if (task.status !== "active") reason = TASK_REVOKED_MESSAGE;
    else if (deadline.dueAt !== null && parseQuarterlyTimestamp(serverNow)! >= parseQuarterlyTimestamp(deadline.dueAt)!) reason = TASK_AVAILABILITY_MESSAGES.expired;
    const opensAt = reason === PERIOD_NOT_OPEN_MESSAGE && effectivePeriodStatus(period, serverNow) === "draft"
      ? period?.opensAt ?? null
      : null;
    return { canWrite: reason === null, reason, opensAt, dueAt: deadline.dueAt, serverNow };
  }

  private writeIdentityError(task: QuarterlyTask): string | null {
    if (!this.isCurrentEvaluator(task)) return "当前账号不能提交未分配的季度评价任务。";
    const account = this.assignmentOptions.accounts.find((item) => item.accountId === this.currentAccountId);
    if (!account || account.status !== "active") return "当前账号身份已变化，请刷新后重试。";
    if (task.type === "self" && !account.employeeId) return SELF_NOT_BOUND_MESSAGE;
    if (task.type === "self" && account.employeeId !== task.evaluateeEmployeeId) return SELF_MISMATCH_MESSAGE;
    return null;
  }

  private isCurrentEvaluator(task: QuarterlyTask): boolean {
    if (task.evaluatorAccountId) {
      return task.evaluatorAccountId === this.currentAccountId
        && (!task.evaluatorEmployeeIdSnapshot || task.evaluatorEmployeeIdSnapshot === this.currentEmployeeId);
    }
    return Boolean(this.currentEmployeeId && task.evaluatorEmployeeIdSnapshot === this.currentEmployeeId);
  }

  private taskWithAvailability(task: QuarterlyTask): QuarterlyTask {
    return { ...clone(task), availability: this.getAvailability(task) };
  }

  private typeCounts(tasks: QuarterlyTask[], type: QuarterlyReviewType): { total: number; submitted: number; pending: number } {
    const typed = tasks.filter((task) => task.type === type);
    return {
      total: typed.length,
      submitted: typed.filter((task) => task.record?.status === "submitted").length,
      pending: typed.filter(taskIsPending).length,
    };
  }

  private refreshPeriodCounts(periodKey: string): void {
    const period = this.periods.find((item) => item.periodKey === periodKey);
    if (!period) return;
    const tasks = this.tasks.filter((task) => task.periodKey === periodKey && task.status === "active");
    period.taskCount = tasks.length;
    period.submittedTaskCount = tasks.filter((task) => task.record?.status === "submitted").length;
  }
}

export class CloudFunctionQuarterlyReviewService implements QuarterlyReviewService, QuarterlyTaskDetailReader {
  readonly mode = "cloudbase" as const;
  private readonly client: QuarterlyFunctionClient | null;

  constructor(client?: QuarterlyFunctionClient | null) {
    this.client = client === undefined ? app : client;
  }

  async listPeriods(): Promise<QuarterlyPeriod[]> {
    try {
      const payload = await this.call("quarterly/periods/list");
      return readArray(payload, "季度评价周期", ["periods", "items"]).map(asPeriod);
    } catch (error) {
      if (!isPermissionError(error)) throw error;
      const [tasks, results] = await Promise.all([
        this.getMyTasks({ periodKey: "", type: "all", status: "all" }),
        this.getMyResults(),
      ]);
      return deriveUserPeriods(tasks, results);
    }
  }

  async getMyTasks(filters: QuarterlyTaskFilters): Promise<QuarterlyTask[]> {
    const query = { ...filters };
    const tasks: QuarterlyTask[] = [];
    const taskIds = new Set<string>();
    const maxPages = 1_000;
    const maxTasks = 50_000;
    let pageSize = 50;
    let expectedTotal: number | null = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await this.call("quarterly/my-tasks", { ...query, page, pageSize });
      const pageTasks = readArray(payload, "我的季度评价任务", ["tasks", "items"]).map(asTask);
      // Preserve compatibility with older responses that contain only the full list.
      const hasPagination = isRecord(payload)
        && ["total", "page", "pageSize"].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
      if (!hasPagination) {
        if (page === 1) return pageTasks;
        throw new Error("读取我的季度评价任务未完成，请刷新后重试。");
      }
      if (!isRecord(payload)
        || !Number.isSafeInteger(payload.total) || (payload.total as number) < 0
        || !Number.isSafeInteger(payload.page) || payload.page !== page
        || !Number.isSafeInteger(payload.pageSize) || (payload.pageSize as number) < 1) {
        throw new Error("我的季度评价任务分页信息无效，请刷新后重试。");
      }
      const total = payload.total as number;
      const returnedPageSize = payload.pageSize as number;
      if ((expectedTotal !== null && total !== expectedTotal)
        || (page > 1 && returnedPageSize !== pageSize)) {
        throw new Error("我的季度评价任务列表已变化，请刷新后重试。");
      }
      expectedTotal = total;
      pageSize = returnedPageSize;
      if (total > maxTasks || Math.ceil(total / pageSize) > maxPages) {
        throw new Error("季度评价任务数量过多，请选择具体周期后重试。");
      }
      if (pageTasks.length > pageSize || tasks.length + pageTasks.length > total) {
        throw new Error("我的季度评价任务分页信息无效，请刷新后重试。");
      }
      for (const task of pageTasks) {
        if (taskIds.has(task.id)) {
          throw new Error("我的季度评价任务列表已变化，请刷新后重试。");
        }
        taskIds.add(task.id);
        tasks.push(task);
      }
      if (tasks.length === total) return tasks;
      if (pageTasks.length < pageSize) {
        throw new Error("读取我的季度评价任务未完成，请刷新后重试。");
      }
    }
    throw new Error("季度评价任务数量过多，请选择具体周期后重试。");
  }

  async getMyResults(periodKey?: string): Promise<QuarterlyResultItem[]> {
    const payload = await this.call("quarterly/my-results", periodKey ? { periodKey } : {});
    return readArray(payload, "我的季度评价结果", ["results", "items"])
      .map(asResultItem)
      .filter((result) => result.direction === "submitted" && result.status === "submitted");
  }

  async getTask(taskId: string): Promise<QuarterlyTask> {
    const payload = await this.call("quarterly/task", { taskId });
    return asTask(resultPayload(payload, ["task"]));
  }

  async getTaskDetail(taskId: string): Promise<QuarterlyTaskDetail> {
    const payload = await this.call("quarterly/draft", { taskId });
    const detail = asTaskDetail(payload);
    if (!detail) throw new Error("未返回有效季度评价任务详情。");
    return detail;
  }

  async saveDraft(input: QuarterlyTaskDraftInput): Promise<ServiceResult<QuarterlyRecord>> {
    return this.mutateRecord("quarterly/draft", { ...input });
  }

  async submit(input: QuarterlyTaskDraftInput): Promise<ServiceResult<QuarterlyRecord>> {
    return this.mutateRecord("quarterly/submit", { ...input });
  }

  async getOverview(periodKey: string): Promise<ServiceResult<QuarterlyOverview>> {
    try {
      return success(asOverview(await this.call("quarterly/overview", { periodKey })));
    } catch (error) {
      return failure(errorMessage(error, "读取季度评价总览失败。"));
    }
  }

  async listRecords(filters: QuarterlyRecordFilters): Promise<QuarterlyRecord[]> {
    const payload = await this.call("quarterly/records", { ...filters });
    return readArray(payload, "季度评价记录", ["records", "items"]).map(asRecord);
  }

  async listRecordsAll(filters: QuarterlyRecordFilters): Promise<QuarterlyRecord[]> {
    const pageSize = 200;
    const allRecords: QuarterlyRecord[] = [];
    let page = 1;

    while (page <= 100_000) {
      const payload = await this.call("quarterly/records", { ...filters, page, pageSize });
      const pageRecords = readArray(payload, "季度评价记录", ["records", "items"]).map(asRecord);
      allRecords.push(...pageRecords);

      const total = isRecord(payload) && Number.isInteger(payload.total) && (payload.total as number) >= 0
        ? payload.total as number
        : null;
      if (total !== null) {
        if (allRecords.length >= total) return allRecords;
        if (pageRecords.length === 0 || pageRecords.length < pageSize) {
          throw new Error("读取季度评价记录未完成，请刷新后重试。");
        }
      } else if (pageRecords.length < pageSize) {
        return allRecords;
      }

      page += 1;
    }

    throw new Error("季度评价记录数量过多，暂时无法完成导出。请缩小周期范围后重试。");
  }

  async returnRecord(input: QuarterlyManagerActionInput): Promise<ServiceResult<QuarterlyRecord>> {
    return this.mutateRecord("quarterly/return", { ...input });
  }

  async voidRecord(input: QuarterlyManagerActionInput): Promise<ServiceResult<QuarterlyRecord>> {
    return this.mutateRecord("quarterly/void", { ...input });
  }

  async reviseRecord(input: QuarterlyRevisionInput): Promise<ServiceResult<QuarterlyRecord>> {
    return this.mutateRecord("quarterly/revise", { ...input });
  }

  async savePeriod(input: QuarterlyPeriodInput): Promise<ServiceResult<QuarterlyPeriod>> {
    try {
      const payload = {
        periodKey: input.periodKey,
        periodName: input.periodName,
        status: input.status,
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
        dueAt: input.dueAt,
        scoringStandardVersion: input.scoringStandardVersion,
      };
      return success(asPeriod(resultPayload(await this.call("quarterly/periods/save", payload), ["period"])))
    } catch (error) {
      return failure(errorMessage(error, "保存季度周期失败。"));
    }
  }

  async schedulePeriod(input: QuarterlyPeriodScheduleInput): Promise<ServiceResult<QuarterlyPeriod>> {
    try {
      return success(asPeriod(resultPayload(await this.call("quarterly/periods/schedule", { ...input }), ["period"])))
    } catch (error) {
      return failure(errorMessage(error, "按季度开放失败，请刷新后重试。"));
    }
  }

  async assignTask(input: QuarterlyTaskAssignmentInput): Promise<ServiceResult<QuarterlyTask>> {
    try {
      return success(asTask(resultPayload(await this.call("quarterly/tasks/save", { ...input }), ["task"])))
    } catch (error) {
      return failure(errorMessage(error, "保存季度评价任务失败。"));
    }
  }

  async saveTask(input: QuarterlyTaskSaveInput): Promise<ServiceResult<QuarterlyTask>> {
    try {
      return success(asTask(resultPayload(await this.call("quarterly/tasks/save", { input }), ["task"])))
    } catch (error) {
      return failure(errorMessage(error, "保存季度评价任务失败。"));
    }
  }

  async previewConfirmedTaskMaterialization(periodKey: string): Promise<ServiceResult<QuarterlyTaskMaterializationPreview>> {
    try {
      return success(asTaskMaterializationPreview(await this.call("quarterly/tasks/materialize-confirmed/preview", { input: { periodKey } })));
    } catch (error) {
      return failure(errorMessage(error, "读取任务生成预检结果失败。"));
    }
  }

  async materializeConfirmedTasks(input: { periodKey: string; acknowledged: true; expectedEligibleCount: number; expectedPreviewToken: string }): Promise<ServiceResult<QuarterlyTaskMaterializationResult>> {
    try {
      return success(asTaskMaterializationResult(await this.call("quarterly/tasks/materialize-confirmed", { input })));
    } catch (error) {
      return failure(errorMessage(error, "生成季度任务失败。请重新核对后再试。"));
    }
  }

  async previewPreviousTaskCopy(periodKey: string): Promise<ServiceResult<QuarterlyTaskCopyPreview>> {
    try {
      return success(asTaskCopyPreview(await this.call("quarterly/tasks/copy-previous/preview", { input: { periodKey } })));
    } catch (error) {
      return failure(errorMessage(error, "读取上季度任务预检结果失败。"));
    }
  }

  async copyPreviousTasks(input: { periodKey: string; acknowledged: true; expectedPreviewToken: string; expectedEligibleCount: number }): Promise<ServiceResult<QuarterlyTaskCopyResult>> {
    try {
      return success(asTaskCopyResult(await this.call("quarterly/tasks/copy-previous", { input })));
    } catch (error) {
      return failure(errorMessage(error, "复制上季度任务失败。请重新核对后再试。"));
    }
  }

  async getAssignmentOptions(): Promise<QuarterlyAssignmentOptions> {
    return asAssignmentOptions(await this.call("quarterly/assignment-options"));
  }

  async bindPendingRelationToStudent(input: {
    relationId: string;
    studentId: string;
    expectedRosterVersion: number;
    acknowledged: true;
  }): Promise<ServiceResult<QuarterlyPendingRelationBindingResult>> {
    try {
      const value = readObject(await this.call("quarterly/pending-relations/bind-student", { ...input }), "绑定评价关系结果", ["result"]);
      return success({
        task: asTask(value.task),
        alreadyBound: asBoolean(value.alreadyBound, "关系是否已绑定"),
      });
    } catch (error) {
      return failure(errorMessage(error, "绑定学员评价关系失败，请刷新后重试。"));
    }
  }

  async listEmployeeHistory(query: QuarterlyHistoryQuery): Promise<QuarterlyRecord[]> {
    const payload = await this.call("quarterly/history", { ...query });
    return readArray(payload, "员工季度评价历史", ["records", "items"]).map(asRecord);
  }

  private async call(route: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client) throw new Error("当前评价功能暂时不可用，请联系管理员。");
    const response = await this.client.callFunction({ name: "employeeArchiveApi", data: { route, ...payload } });
    return unwrapCloudFunctionResponse(response);
  }

  private async mutateRecord(route: string, input: Record<string, unknown>): Promise<ServiceResult<QuarterlyRecord>> {
    try {
      return success(asRecord(resultPayload(await this.call(route, input), ["record"])))
    } catch (error) {
      return failure(errorMessage(error, "保存季度评价失败。"));
    }
  }
}

export class UnconfiguredQuarterlyReviewService implements QuarterlyReviewService {
  readonly mode = "cloudbase-unconfigured" as const;

  getAssignmentOptions(): QuarterlyAssignmentOptions {
    return { accounts: [], employees: [], students: [] };
  }

  listPeriods(): QuarterlyPeriod[] {
    return [];
  }

  getMyTasks(): QuarterlyTask[] {
    return [];
  }

  getMyResults(): QuarterlyResultItem[] {
    return [];
  }

  getTask(): undefined {
    return undefined;
  }

  saveDraft(): ServiceResult<QuarterlyRecord> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  submit(): ServiceResult<QuarterlyRecord> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  getOverview(): ServiceResult<QuarterlyOverview> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  listRecords(): QuarterlyRecord[] {
    return [];
  }

  listRecordsAll(): QuarterlyRecord[] {
    return [];
  }

  returnRecord(): ServiceResult<QuarterlyRecord> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  voidRecord(): ServiceResult<QuarterlyRecord> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  reviseRecord(): ServiceResult<QuarterlyRecord> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  savePeriod(): ServiceResult<QuarterlyPeriod> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  schedulePeriod(): ServiceResult<QuarterlyPeriod> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  assignTask(): ServiceResult<QuarterlyTask> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  bindPendingRelationToStudent(): ServiceResult<QuarterlyPendingRelationBindingResult> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  saveTask(): ServiceResult<QuarterlyTask> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  previewConfirmedTaskMaterialization(): ServiceResult<QuarterlyTaskMaterializationPreview> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  materializeConfirmedTasks(): ServiceResult<QuarterlyTaskMaterializationResult> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  previewPreviousTaskCopy(): ServiceResult<QuarterlyTaskCopyPreview> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  copyPreviousTasks(): ServiceResult<QuarterlyTaskCopyResult> {
    return failure("当前评价功能暂时不可用，请联系管理员。");
  }

  listEmployeeHistory(): QuarterlyRecord[] {
    return [];
  }
}
