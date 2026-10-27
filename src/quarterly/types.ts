export const QUARTERLY_DIMENSIONS = ["任务完成", "规范执行", "问题处理", "沟通协作", "学习成长", "服务支持"] as const;

export type QuarterlyDimension = (typeof QUARTERLY_DIMENSIONS)[number];
export type QuarterlyReviewType = "self" | "first" | "second";
export type QuarterlyPeriodStatus = "draft" | "open" | "closed" | "archived";
export type QuarterlyRecordStatus = "draft" | "submitted" | "returned" | "void";
export type QuarterlyResultVisibility = "hidden" | "published";
export type QuarterlyGrade = "A" | "B" | "C" | "D";

export type QuarterlyScores = Record<QuarterlyDimension, number | null>;
export type QuarterlyReasons = Record<QuarterlyDimension, string>;

export interface QuarterlyStandardItem {
  label: string;
  text: string;
}

export interface QuarterlyGradeStandard {
  score: string;
  tag?: string;
  min: number;
  max: number;
  items: QuarterlyStandardItem[];
}

export interface QuarterlyDimensionStandard {
  name: QuarterlyDimension;
  weight: 25;
  grades: Record<QuarterlyGrade, QuarterlyGradeStandard>;
}

export interface QuarterlyScoringStandard {
  version: string;
  dimensions: QuarterlyDimensionStandard[];
}

export interface QuarterlyPeriod {
  id: string;
  periodKey: string;
  periodName: string;
  status: QuarterlyPeriodStatus;
  resultVisibility: QuarterlyResultVisibility;
  scoringStandardVersion: string;
  rosterVersion: number;
  version: number;
  rosterLocked: boolean;
  opensAt: string | null;
  dueAt: string | null;
  taskCount: number;
  submittedTaskCount: number;
  updatedAt: string | null;
}

export interface QuarterlyTask {
  id: string;
  /** Older responses omit this; edits are unavailable until a version is returned. */
  version?: number;
  /** Source-materialized tasks must be adjusted through the source roster workflow. */
  sourceLocked?: boolean;
  periodKey: string;
  periodName: string;
  type: QuarterlyReviewType;
  typeLabel: string;
  evaluatorAccountId: string | null;
  evaluatorNameSnapshot: string;
  evaluatorEmployeeIdSnapshot: string | null;
  evaluatorStudentIdSnapshot: string | null;
  evaluateeEmployeeId: string;
  evaluateeNameSnapshot: string;
  evaluateeDepartmentSnapshot: string;
  status: "active" | "revoked";
  dueAt: string | null;
  availability?: QuarterlyTaskAvailability;
  record: QuarterlyRecordSummary | null;
}

export interface QuarterlyPendingRelation {
  id: string;
  sourceRelationId: string;
  periodKey: string;
  periodName: string;
  type: QuarterlyReviewType;
  typeLabel: string;
  status: "pending_binding";
  evaluatorNameSnapshot: string;
  evaluatorEmployeeIdSnapshot: string | null;
  evaluatorStudentIdSnapshot: string | null;
  evaluatorStudentNameSnapshot?: string | null;
  evaluateeEmployeeId: string;
  evaluateeNameSnapshot: string;
  evaluateeDepartmentSnapshot: string;
}

export interface QuarterlyTaskAvailability {
  canWrite: boolean;
  reason: string | null;
  opensAt?: string | null;
  dueAt: string | null;
  serverNow: string;
}

export interface QuarterlyAssignmentAccount {
  accountId: string;
  displayName: string;
  username: string;
  employeeId: string | null;
  employeeName: string | null;
  department: string;
  status: "active" | "disabled";
}

export interface QuarterlyAssignmentEmployee {
  employeeId: string;
  name: string;
  department: string;
  status: "active" | "former" | "archived";
}

export interface QuarterlyAssignmentStudent {
  studentId: string;
  name: string;
}

export interface QuarterlyAssignmentOptions {
  accounts: QuarterlyAssignmentAccount[];
  employees: QuarterlyAssignmentEmployee[];
  students: QuarterlyAssignmentStudent[];
}

export interface QuarterlyPendingRelationBindingResult {
  task: QuarterlyTask;
  alreadyBound: boolean;
}

export interface QuarterlyRecordSummary {
  id: string;
  status: QuarterlyRecordStatus;
  total: number | null;
  version: number;
  updatedAt: string | null;
  submittedAt: string | null;
  returnedReason: string | null;
}

export interface QuarterlyRecord extends QuarterlyRecordSummary {
  taskId: string;
  periodKey: string;
  periodName: string;
  type: QuarterlyReviewType;
  typeLabel: string;
  evaluatorAccountId: string | null;
  evaluatorNameSnapshot: string;
  evaluateeEmployeeId: string;
  evaluateeNameSnapshot: string;
  evaluateeDepartmentSnapshot: string;
  scores: QuarterlyScores;
  reasons: QuarterlyReasons;
  isReceived: boolean;
  resultVisible: boolean;
  managementEdited: boolean;
  actualOperatorName: string | null;
}

export interface QuarterlyResultItem {
  id: string;
  periodKey: string;
  periodName: string;
  type: QuarterlyReviewType;
  typeLabel: string;
  direction: "submitted" | "received";
  status: QuarterlyRecordStatus | "unpublished";
  evaluatorName: string | null;
  evaluateeName: string | null;
  total: number | null;
  scores: QuarterlyScores | null;
  reasons: QuarterlyReasons | null;
  published: boolean;
}

export interface QuarterlyOverview {
  period: QuarterlyPeriod | null;
  periods: QuarterlyPeriod[];
  taskCount: number;
  submittedTaskCount: number;
  draftTaskCount: number;
  returnedTaskCount: number;
  revokedTaskCount: number;
  completionRate: number | null;
  byType: Record<QuarterlyReviewType, { total: number; submitted: number; pending: number }>;
  tasks: QuarterlyTask[];
  pendingRelations: QuarterlyPendingRelation[];
  records: QuarterlyRecord[];
}

export interface QuarterlyTaskFilters {
  periodKey: string;
  type: "all" | QuarterlyReviewType;
  status: "all" | QuarterlyRecordStatus | "pending";
}

export interface QuarterlyRecordFilters {
  periodKey: string;
  type: "all" | QuarterlyReviewType;
  status: "all" | QuarterlyRecordStatus;
  keyword: string;
}

export interface QuarterlyTaskDraftInput {
  taskId: string;
  scores: QuarterlyScores;
  reasons: QuarterlyReasons;
  expectedVersion: number;
}

export interface QuarterlyManagerActionInput {
  recordId: string;
  reason: string;
  expectedVersion: number;
}

export interface QuarterlyRevisionInput {
  recordId: string;
  scores: QuarterlyScores;
  reasons: QuarterlyReasons;
  reason: string;
  expectedVersion: number;
}

export interface QuarterlyPeriodInput {
  periodKey: string;
  periodName: string;
  status: QuarterlyPeriodStatus;
  /** Protects explicit administrative status changes from overwriting a newer period edit. */
  expectedVersion?: number;
  /** Legacy compatibility only. The period settings UI does not let administrators set this value. */
  opensAt?: string | null;
  dueAt: string | null;
  scoringStandardVersion: string;
}

export interface QuarterlyPeriodScheduleInput {
  periodKey: string;
  expectedVersion: number;
}

interface QuarterlyTaskAssignmentBaseInput {
  periodKey: string;
  type: QuarterlyReviewType;
  evaluateeEmployeeId: string;
  dueAt: string | null;
}

export type QuarterlyTaskAssignmentInput = QuarterlyTaskAssignmentBaseInput & (
  | { evaluatorEmployeeId: string; /** Legacy compatibility for older callers. */ evaluatorAccountId?: string }
  | { evaluatorEmployeeId?: string; evaluatorAccountId: string }
);

export interface QuarterlyTaskSaveInput {
  periodKey: string;
  type: QuarterlyReviewType;
  evaluatorEmployeeId: string;
  evaluatorAccountId?: string;
  evaluateeEmployeeId: string;
  dueAt: string | null;
  status?: "active" | "revoked";
  expectedVersion?: number;
}

export interface QuarterlyTaskMaterializationPreview {
  periodKey: string;
  periodName: string;
  previewToken: string;
  eligibleCount: number;
  alreadyMaterializedCount: number;
  unmatchedCount: number;
  conflictCount: number;
}

export interface QuarterlyTaskMaterializationResult {
  periodKey: string;
  createdCount: number;
  reusedCount: number;
  skippedCount: number;
  processedCount: number;
  remainingCount: number;
  conflictCount: number;
  failedCount: number;
  errorSummary: string[];
  complete: boolean;
}

export interface QuarterlyTaskCopySummary {
  targetPeriodKey: string;
  sourcePeriodKey: string;
  targetPeriodName: string;
  sourcePeriodName: string;
  targetVersion: number;
  sourceActiveTaskCount: number;
  ignoredInactiveCount: number;
  eligibleCount: number;
  alreadyPresentCount: number;
  identityErrorCount: number;
  duplicateSourceCount: number;
  duplicateTargetCount: number;
  recordConflictCount: number;
  conflictCount: number;
}

export interface QuarterlyTaskCopyPreview extends QuarterlyTaskCopySummary {
  previewToken: string;
}

export interface QuarterlyTaskCopyResult extends QuarterlyTaskCopySummary {
  copiedCount: number;
  processedCount: number;
  remainingCount: number;
  failedCount: number;
  errorSummary: string[];
  complete: boolean;
}

export interface QuarterlyHistoryQuery {
  employeeId: string;
  periodKey?: string;
}

export interface QuarterlyReviewService {
  mode: "local-preview" | "cloudbase" | "cloudbase-unconfigured";
  listPeriods(): QuarterlyPeriod[] | Promise<QuarterlyPeriod[]>;
  getMyTasks(filters: QuarterlyTaskFilters): QuarterlyTask[] | Promise<QuarterlyTask[]>;
  getMyResults(periodKey?: string): QuarterlyResultItem[] | Promise<QuarterlyResultItem[]>;
  getTask(taskId: string): QuarterlyTask | undefined | Promise<QuarterlyTask>;
  saveDraft(input: QuarterlyTaskDraftInput): ServiceResult<QuarterlyRecord> | Promise<ServiceResult<QuarterlyRecord>>;
  submit(input: QuarterlyTaskDraftInput): ServiceResult<QuarterlyRecord> | Promise<ServiceResult<QuarterlyRecord>>;
  getOverview(periodKey: string): ServiceResult<QuarterlyOverview> | Promise<ServiceResult<QuarterlyOverview>>;
  listRecords(filters: QuarterlyRecordFilters): QuarterlyRecord[] | Promise<QuarterlyRecord[]>;
  listRecordsAll(filters: QuarterlyRecordFilters): QuarterlyRecord[] | Promise<QuarterlyRecord[]>;
  returnRecord(input: QuarterlyManagerActionInput): ServiceResult<QuarterlyRecord> | Promise<ServiceResult<QuarterlyRecord>>;
  voidRecord(input: QuarterlyManagerActionInput): ServiceResult<QuarterlyRecord> | Promise<ServiceResult<QuarterlyRecord>>;
  reviseRecord(input: QuarterlyRevisionInput): ServiceResult<QuarterlyRecord> | Promise<ServiceResult<QuarterlyRecord>>;
  savePeriod(input: QuarterlyPeriodInput): ServiceResult<QuarterlyPeriod> | Promise<ServiceResult<QuarterlyPeriod>>;
  schedulePeriod(input: QuarterlyPeriodScheduleInput): ServiceResult<QuarterlyPeriod> | Promise<ServiceResult<QuarterlyPeriod>>;
  getAssignmentOptions(): QuarterlyAssignmentOptions | Promise<QuarterlyAssignmentOptions>;
  bindPendingRelationToStudent(input: {
    relationId: string;
    studentId: string;
    expectedRosterVersion: number;
    acknowledged: true;
  }): ServiceResult<QuarterlyPendingRelationBindingResult> | Promise<ServiceResult<QuarterlyPendingRelationBindingResult>>;
  assignTask(input: QuarterlyTaskAssignmentInput): ServiceResult<QuarterlyTask> | Promise<ServiceResult<QuarterlyTask>>;
  saveTask(input: QuarterlyTaskSaveInput): ServiceResult<QuarterlyTask> | Promise<ServiceResult<QuarterlyTask>>;
  previewConfirmedTaskMaterialization(periodKey: string): ServiceResult<QuarterlyTaskMaterializationPreview> | Promise<ServiceResult<QuarterlyTaskMaterializationPreview>>;
  materializeConfirmedTasks(input: { periodKey: string; acknowledged: true; expectedEligibleCount: number; expectedPreviewToken: string }): ServiceResult<QuarterlyTaskMaterializationResult> | Promise<ServiceResult<QuarterlyTaskMaterializationResult>>;
  previewPreviousTaskCopy(periodKey: string): ServiceResult<QuarterlyTaskCopyPreview> | Promise<ServiceResult<QuarterlyTaskCopyPreview>>;
  copyPreviousTasks(input: { periodKey: string; acknowledged: true; expectedPreviewToken: string; expectedEligibleCount: number }): ServiceResult<QuarterlyTaskCopyResult> | Promise<ServiceResult<QuarterlyTaskCopyResult>>;
  listEmployeeHistory(query: QuarterlyHistoryQuery): QuarterlyRecord[] | Promise<QuarterlyRecord[]>;
}

export interface ServiceSuccess<T> {
  ok: true;
  data: T;
}

export interface ServiceFailure {
  ok: false;
  message: string;
}

export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

export const QUARTERLY_TYPE_LABELS: Record<QuarterlyReviewType, string> = {
  self: "自评",
  first: "一次评价",
  second: "二次评价",
};

export const QUARTERLY_STATUS_LABELS: Record<QuarterlyRecordStatus, string> = {
  draft: "草稿",
  submitted: "已提交",
  returned: "已退回",
  void: "已作废",
};

export function emptyQuarterlyScores(): QuarterlyScores {
  return QUARTERLY_DIMENSIONS.reduce((scores, dimension) => {
    scores[dimension] = null;
    return scores;
  }, {} as QuarterlyScores);
}

export function emptyQuarterlyReasons(): QuarterlyReasons {
  return QUARTERLY_DIMENSIONS.reduce((reasons, dimension) => {
    reasons[dimension] = "";
    return reasons;
  }, {} as QuarterlyReasons);
}
