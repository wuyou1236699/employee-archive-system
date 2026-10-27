export type EmployeeStatus = "active" | "former" | "archived";
export type StudentStatus = "active" | "inactive";
export type CourseStatus = "completed" | "incomplete" | "partial" | "unknown" | "not_applicable";
export type ExpiryStatus = "normal" | "soon" | "expired" | "missing";
export type AuditResult = "success" | "failure" | "unknown";
export type AuditWriteResult = Exclude<AuditResult, "unknown">;
export type DataMode = "local-preview" | "cloudbase" | "cloudbase-unconfigured";
export type AccountRole = "super_admin" | "admin" | "user";
export type AccountStatus = "active" | "disabled";
export type AccountSummaryStatus = AccountStatus | "pending_activation" | "recovery_required";
export type AccountIdentityType = "employee" | "student";
export type AccountPermission =
  | "employee.write"
  | "history.write"
  | "attachment.read"
  | "attachment.write"
  | "audit.read"
  | "monthly_assessment_edit"
  | "quarterly.manage";

export type AuditAction =
  | "preview_login"
  | "preview_logout"
  | "update_display_name"
  | "update_account_display_name"
  | "create_employee"
  | "create_student"
  | "update_student"
  | "archive_student"
  | "restore_student"
  | "view_student_detail"
  | "update_employee"
  | "archive_employee"
  | "initial_import"
  | "initial_migration"
  | "add_course"
  | "add_event"
  | "add_attachment"
  | "view_attachment"
  | "view_audit"
  | "register_account"
  | "update_account_role"
  | "grant_account_permissions"
  | "revoke_account_permissions"
  | "disable_account"
  | "restore_account"
  | "reset_account_password"
  | "save_monthly_assessment"
  | "materialize_monthly_assessment_targets"
  | "save_quarterly_draft"
  | "submit_quarterly_review"
  | "return_quarterly_review"
  | "void_quarterly_review"
  | "save_quarterly_period"
  | "save_quarterly_task"
  | "bind_account_employee";

export interface ContractRecord {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  notes: string;
}

export interface VehicleRecord {
  id: string;
  model: string;
  plateNumber: string;
  startDate: string;
  endDate: string;
  notes: string;
}

export interface CourseRecord {
  id: string;
  courseName: string;
  status: CourseStatus;
  attendedDate: string;
  note: string;
}

export interface EventRecord {
  id: string;
  eventDate: string;
  eventType: string;
  summary: string;
  detail: string;
  attachments?: AttachmentRecord[];
}

export interface AttachmentRecord {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  visibility: "sensitive" | "normal";
  storageKey?: string | null;
  uploadedAt: string;
}

export interface Employee {
  id: string;
  recordType?: "employee";
  version: number;
  sourceSheet: string | null;
  sourceRow: number | null;
  sourceSequence: string | null;
  name: string;
  status: EmployeeStatus;
  department: string;
  onlyChildStatus: string;
  personalPhone: string;
  workPhone: string;
  phonePlan: string;
  phoneOwnership: string;
  computerOwnership: string;
  hireDate: string;
  regularizationDate: string;
  notes: string;
  contract: ContractRecord | null;
  vehicle: VehicleRecord | null;
  courseRecords: CourseRecord[];
  events: EventRecord[];
  attachments: AttachmentRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDraft {
  name: string;
  status: EmployeeStatus;
  department: string;
  personalPhone: string;
  workPhone: string;
  phonePlan: string;
  phoneOwnership: string;
  computerOwnership: string;
  hireDate: string;
  regularizationDate: string;
  notes: string;
  contractType: string;
  contractStartDate: string;
  contractEndDate: string;
  contractNotes: string;
  vehicleModel: string;
  vehiclePlateNumber: string;
  vehicleStartDate: string;
  vehicleEndDate: string;
  vehicleNotes: string;
}

export interface StudentProfile {
  id: string;
  recordType?: "student";
  name: string;
  status: StudentStatus;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StudentDetail extends StudentProfile {
  phoneNumber: string;
}

export interface StudentDraft {
  name: string;
  phoneNumber: string;
}

export interface CourseInput {
  courseName: string;
  status: CourseStatus;
  attendedDate: string;
  note: string;
}

export interface EventInput {
  eventDate: string;
  eventType: string;
  summary: string;
  detail: string;
}

export interface AttachmentView {
  url: string;
  fileName: string;
  mimeType: string;
}

export type EventAttachmentView = AttachmentView;

export interface EmployeeFilters {
  search: string;
  status: "all" | EmployeeStatus;
  department: "all" | string;
  attention: "all" | "contract" | "vehicle" | "missing";
}

export type MonthlyAssessmentStatus = "achieved" | "not_achieved" | "unassessed";
export type MonthlyAssessmentMetric = "meeting" | "renewalRate" | "influence" | "visits" | "nineGrid";

export interface MonthlyAssessmentResults {
  meeting: MonthlyAssessmentStatus;
  renewalRate: MonthlyAssessmentStatus;
  influence: MonthlyAssessmentStatus;
  visits: MonthlyAssessmentStatus;
  nineGrid: MonthlyAssessmentStatus;
}

export interface MonthlyAssessmentFilters {
  monthKey: string;
  keyword: string;
  department: "all" | string;
  metric: "all" | MonthlyAssessmentMetric;
  metricStatus: "all" | MonthlyAssessmentStatus;
  page?: number;
  pageSize?: number;
}

export interface MonthlyAssessmentItem {
  inScope: true;
  employeeId: string;
  monthKey: string;
  employeeName: string;
  department: string;
  employmentStatus: EmployeeStatus;
  hasRecord: boolean;
  results: MonthlyAssessmentResults;
  note: string;
  version: number;
  filledCount: number;
}

export interface MonthlyAssessmentMetricStats {
  achieved: number;
  not_achieved: number;
  unassessed: number;
  achievementRate: number | null;
}

export interface MonthlyAssessmentStats {
  eligibleActiveCount: number;
  fullyEvaluatedCount: number;
  partiallyEvaluatedCount: number;
  unassessedCount: number;
  metrics: Record<MonthlyAssessmentMetric, MonthlyAssessmentMetricStats>;
}

export interface MonthlyAssessmentOverview {
  items: MonthlyAssessmentItem[];
  page: number;
  pageSize: number;
  total: number;
  stats: MonthlyAssessmentStats;
}

export interface MonthlyAssessmentRecord {
  inScope: boolean;
  employeeId: string;
  monthKey: string;
  employeeName: string;
  department: string;
  employmentStatus: EmployeeStatus | null;
  hasRecord: boolean;
  results: MonthlyAssessmentResults;
  note: string;
  version: number;
  filledCount: number;
}

export interface MonthlyAssessmentSaveInput {
  employeeId: string;
  monthKey: string;
  results: MonthlyAssessmentResults;
  note: string;
  expectedVersion: number;
}

export interface AuditLog {
  id: string;
  actorAccountId?: string;
  actorUsername?: string;
  actorNameSnapshot: string;
  action: AuditAction;
  targetType: "employee" | "student" | "account" | "session";
  targetId: string | null;
  targetNameSnapshot: string | null;
  changedFields: string[];
  before: Record<string, string | null> | null;
  after: Record<string, string | null> | null;
  result: AuditResult;
  detail: string;
  createdAt: string;
}

export interface AuditLogInput {
  action: AuditAction;
  targetId?: string | null;
  targetName?: string | null;
  changedFields?: string[];
  before?: Record<string, string | null> | null;
  after?: Record<string, string | null> | null;
  result?: AuditWriteResult;
  detail: string;
}

export interface AuditFilters {
  action: "all" | AuditAction;
  result: "all" | AuditResult;
  employeeName: string;
  targetId?: string;
}

export interface ServiceSuccess<T> {
  ok: true;
  data: T;
}

export interface ServiceFailure {
  ok: false;
  message: string;
  code?: string;
  outcome?: "definite" | "uncertain";
  field?: keyof EmployeeDraft | keyof StudentDraft | keyof CourseInput | keyof EventInput;
}

export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

export interface Session {
  accountId: string;
  username: string;
  displayName: string;
  mode: "local-preview" | "cloudbase";
  role: AccountRole;
  permissions: AccountPermission[];
  status: AccountStatus;
  identityType?: AccountIdentityType;
  employeeId?: string | null;
  employeeNameSnapshot?: string | null;
  studentId?: string | null;
  studentNameSnapshot?: string | null;
}

export interface AccountProfile {
  accountId?: string;
  username: string;
  displayName: string;
  scope: "all" | "self";
  role: AccountRole;
  permissions: AccountPermission[];
  status: AccountStatus;
  identityType?: AccountIdentityType;
  employeeId?: string | null;
  employeeNameSnapshot?: string | null;
  studentId?: string | null;
  studentNameSnapshot?: string | null;
}

export interface AccountSummary {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  permissions: AccountPermission[];
  status: AccountSummaryStatus;
  identityType?: AccountIdentityType;
  createdAt: string | null;
  updatedAt: string | null;
  permissionVersion: number;
  employeeId?: string | null;
  employeeNameSnapshot?: string | null;
  studentId?: string | null;
  studentNameSnapshot?: string | null;
}

export type SuperAdminGovernanceState = "ready" | "over_limit" | "not_initialized" | "no_active_super_admin" | "drift" | "not_ready";

export interface SuperAdminGovernanceSummary {
  state: SuperAdminGovernanceState;
  activeCount: number | null;
  limit: number;
  revision: number | null;
}

export interface SuperAdminGovernanceInitializeInput {
  operationId: string;
}

export interface AccountListResult {
  items: AccountSummary[];
  total: number;
  governance: SuperAdminGovernanceSummary;
}

export type RegistrationRecoveryAction = "restore_existing" | "release_for_retry";

export interface RegistrationRecoveryItem {
  id: string;
  displayName: string;
  identityType: AccountIdentityType;
  action: RegistrationRecoveryAction;
  message: string;
  detectedAt: string | null;
}

export interface RegistrationRecoveryInput {
  claimId: string;
  action: RegistrationRecoveryAction;
}

export interface RegistrationRecoveryResult {
  action: RegistrationRecoveryAction;
  displayName: string;
  recovered: true;
}

export interface GovernanceMutationMetadata {
  operationId: string;
  expectedGovernanceRevision: number;
}

export interface RegistrationInput {
  username: string;
  password: string;
  phoneNumber: string;
}

export interface AccountRoleUpdateInput extends GovernanceMutationMetadata {
  accountId: string;
  role: AccountRole;
}

export interface AccountPermissionUpdateInput extends GovernanceMutationMetadata {
  accountId: string;
  permissions: AccountPermission[];
}

export interface AccountEmployeeBindingInput extends GovernanceMutationMetadata {
  accountId: string;
  employeeId: string | null;
}

export interface AccountStatusUpdateInput extends GovernanceMutationMetadata {
  accountId: string;
}

export interface AccountPasswordResetInput {
  accountId: string;
  newPassword: string;
  expectedGovernanceRevision: number;
}

export interface AccountPasswordResetResult {
  reset: true;
}

export interface SelfPasswordResetInput {
  username: string;
  phoneNumber: string;
  newPassword: string;
}

export interface SelfPasswordResetResult {
  accepted: true;
}

export interface SuperAdminTransferInput extends GovernanceMutationMetadata {
  targetAccountId: string;
}

export interface SuperAdminTransferResult {
  sourceAccount: AccountSummary;
  targetAccount: AccountSummary;
  governance: SuperAdminGovernanceSummary;
}

export interface AuthConfigStatus {
  mode: "local-preview" | "cloudbase-missing" | "cloudbase-unwired";
  environmentConfigured: boolean;
  publishableKeyConfigured: boolean;
  region: string;
  message: string;
}
