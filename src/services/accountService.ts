import { app } from "./cloudbaseAdapter";
import type {
  AccountPermission,
  AccountPermissionUpdateInput,
  AccountEmployeeBindingInput,
  AccountPasswordResetInput,
  AccountPasswordResetResult,
  AccountProfile,
  AccountListResult,
  AccountRoleUpdateInput,
  AccountSummary,
  AccountSummaryStatus,
  AccountStatusUpdateInput,
  GovernanceMutationMetadata,
  RegistrationInput,
  RegistrationRecoveryAction,
  RegistrationRecoveryInput,
  RegistrationRecoveryItem,
  RegistrationRecoveryResult,
  ServiceResult,
  SelfPasswordResetInput,
  SelfPasswordResetResult,
  SuperAdminGovernanceInitializeInput,
  SuperAdminGovernanceSummary,
  SuperAdminGovernanceState,
  SuperAdminTransferInput,
  SuperAdminTransferResult,
} from "../types";
import { asAccountProfile, toUserFacingServiceError } from "./dataService";
import { REGISTRATION_PASSWORD_RULE_MESSAGE, REGISTRATION_PROVIDER_PARAMETER_MESSAGE } from "../utils/registrationMessages";

const ACCOUNT_PERMISSIONS = new Set<AccountPermission>([
  "employee.write",
  "history.write",
  "attachment.read",
  "attachment.write",
  "audit.read",
  "monthly_assessment_edit",
  "quarterly.manage",
]);

export interface AccountService {
  register(input: RegistrationInput): Promise<ServiceResult<AccountProfile>>;
  selfResetPassword(input: SelfPasswordResetInput): Promise<ServiceResult<SelfPasswordResetResult>>;
  listAccounts(): Promise<AccountListResult>;
  listRegistrationRecoveries?(): Promise<RegistrationRecoveryItem[]>;
  recoverRegistration?(input: RegistrationRecoveryInput): Promise<ServiceResult<RegistrationRecoveryResult>>;
  resetPassword(input: AccountPasswordResetInput): Promise<ServiceResult<AccountPasswordResetResult>>;
  initializeSuperAdminGovernance?(input: SuperAdminGovernanceInitializeInput): Promise<ServiceResult<SuperAdminGovernanceSummary>>;
  upgradeSuperAdminGovernanceLimit?(input: GovernanceMutationMetadata): Promise<ServiceResult<SuperAdminGovernanceSummary>>;
  updateRole(input: AccountRoleUpdateInput): Promise<ServiceResult<AccountSummary>>;
  grantPermissions(input: AccountPermissionUpdateInput): Promise<ServiceResult<AccountSummary>>;
  revokePermissions(input: AccountPermissionUpdateInput): Promise<ServiceResult<AccountSummary>>;
  disableAccount(input: AccountStatusUpdateInput): Promise<ServiceResult<AccountSummary>>;
  restoreAccount(input: AccountStatusUpdateInput): Promise<ServiceResult<AccountSummary>>;
  bindEmployee(input: AccountEmployeeBindingInput): Promise<ServiceResult<AccountSummary>>;
  transferSuperAdmin(input: SuperAdminTransferInput): Promise<ServiceResult<SuperAdminTransferResult>>;
}

type AccountCallOutcome = "definite" | "uncertain";

class AccountServiceCallError extends Error {
  readonly code: string;
  readonly outcome: AccountCallOutcome;
  readonly requestId: string;

  constructor(message: string, code: string, outcome: AccountCallOutcome, requestId = "") {
    super(message);
    this.name = "AccountServiceCallError";
    this.code = code;
    this.outcome = outcome;
    this.requestId = /^[A-Za-z0-9_-]{8,128}$/.test(requestId) ? requestId : "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPayload(response: unknown): unknown {
  const outer = isRecord(response) ? response : {};
  const nested = outer.result;
  if (isRecord(nested) && "data" in nested) return nested.data;
  if (nested !== undefined && nested !== null) return nested;
  if ("data" in outer) return outer.data;
  return response;
}

function readErrorText(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (isRecord(error) && typeof error.message === "string") return error.message.trim();
  return "";
}

function readErrorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code.trim().toUpperCase() : "";
}

function toUserFacingAccountError(error: unknown, fallback: string): string {
  const raw = readErrorText(error);
  const code = readErrorCode(error);
  if (raw === REGISTRATION_PASSWORD_RULE_MESSAGE || raw === REGISTRATION_PROVIDER_PARAMETER_MESSAGE) return raw;
  if (code === "VALIDATION_ERROR") {
    const details = isRecord(error) && isRecord(error.details) ? error.details : {};
    if (details.field === "password") return REGISTRATION_PASSWORD_RULE_MESSAGE;
    if (details.field === "username") return "账号名须以字母或数字开头，长度 1—64 位，只能包含字母、数字、点、下划线和短横线。";
    if (details.field === "phoneNumber") return "请输入有效的手机号，并确保与员工或学员档案中登记的手机号一致。";
    if (details.field === "registration" || /注册参数未通过(?:云端)?校验/.test(raw)) {
      return REGISTRATION_PROVIDER_PARAMETER_MESSAGE;
    }
  }
  if (code === "REGISTRATION_RECOVERY_REQUIRED"
    || /(注册结果|注册状态|账号创建结果|账号可能已创建|账号员工绑定状态|绑定状态).*管理员核对|请勿重复注册/i.test(raw)) {
    return "注册结果尚未确认，请勿再次提交手机号；请联系管理员核对账号状态后再继续。";
  }
  if (["REGISTRATION_EMPLOYEE_MATCH_FAILED", "REGISTRATION_IDENTITY_MATCH_AMBIGUOUS"].includes(code)
    || /未能完成(员工|档案)身份匹配/.test(raw)) {
    return "手机号无法唯一匹配到可注册档案。员工请填写员工档案中登记的个人手机号，学员请填写学员档案中登记的手机号；确认号码无误后仍失败，请联系管理员核对档案。";
  }
  if (["REGISTRATION_EMPLOYEE_INVALID", "REGISTRATION_IDENTITY_INVALID"].includes(code)) {
    return "匹配到的档案资料不完整或当前状态不可注册，请联系管理员核对档案。";
  }
  if (code === "REGISTRATION_IDENTITY_CLAIMED") {
    return "当前身份已绑定账号或正在注册中，暂不能重复注册；请联系管理员核对账号状态。";
  }
  if (code === "REGISTRATION_UNAVAILABLE") {
    return "注册服务暂时不可用，请稍后重试；如持续失败，请联系管理员。";
  }
  if (code === "REGISTRATION_RECOVERY_UNAVAILABLE") {
    return "目前无法核对注册账号状态，请稍后刷新。";
  }
  if (code === "REGISTRATION_RECOVERY_NOT_FOUND" || code === "REGISTRATION_RECOVERY_CHANGED") {
    return "账号或档案状态已变化，请刷新列表后重新核对。";
  }
  if (code === "REGISTRATION_PROVIDER_ERROR") {
    return "注册服务未能确认账号创建结果，请勿再次提交手机号，并联系管理员核对账号状态。";
  }
  if (code === "ACCOUNT_USERNAME_TAKEN") {
    return "该账号名已被注册，请换一个账号名。";
  }
  if (code === "ACCOUNT_DISPLAY_NAME_TAKEN") {
    return "该账号名已被使用，请换一个账号名。";
  }
  if (/请输入有效的(本人|员工)?手机号/.test(raw)) return "请输入有效的手机号，并确保与员工或学员档案中登记的手机号一致。";
  if (/(显示名称.*(使用|注册|重名|存在)|display.?name.*(taken|duplicate|exist))/i.test(raw)) {
    return "该显示名称已被使用，请换一个显示名称。";
  }
  if (/(taken|duplicate|already|exist|已注册|已存在|重名|占用)/i.test(raw)) {
    return "该账号名已被注册，请换一个账号名。";
  }
  if (/(停用|冻结|inactive|disabled)/i.test(raw)) {
    return "该账号已停用，请联系管理员。";
  }
  if (/(未授权|无权限|没有权限|禁止访问|forbidden|unauthori[sz]ed)/i.test(raw)) {
    return "当前账号没有执行此操作的权限，请联系管理员。";
  }
  return toUserFacingServiceError(error, fallback);
}

function getErrorMessage(response: unknown): string {
  const outer = isRecord(response) ? response : {};
  const result = isRecord(outer.result) ? outer.result : undefined;
  const error = result?.error ?? outer.error;
  return toUserFacingAccountError(error, "系统暂时无法完成此操作，请稍后重试。");
}

function getResponseError(response: unknown): unknown {
  const outer = isRecord(response) ? response : {};
  const result = isRecord(outer.result) ? outer.result : undefined;
  return result?.error ?? outer.error;
}

function unwrap(response: unknown): unknown {
  const outer = isRecord(response) ? response : {};
  const result = isRecord(outer.result) ? outer.result : undefined;
  const ok = result?.ok ?? outer.ok;
  if (ok === false || outer.error !== undefined || result?.error !== undefined) {
    const error = getResponseError(response);
    throw new AccountServiceCallError(getErrorMessage(response), readErrorCode(error), "definite",
      typeof (result?.requestId ?? outer.requestId) === "string" ? String(result?.requestId ?? outer.requestId) : "");
  }
  return getPayload(response);
}

function asAccountSummary(value: unknown): AccountSummary {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.username !== "string") {
    throw new Error("未返回有效账号列表。");
  }
  const role = value.role === "super_admin" || value.role === "admin" || value.role === "user" ? value.role : "user";
  const permissions = Array.isArray(value.permissions)
    ? value.permissions.filter((permission): permission is AccountPermission => typeof permission === "string" && ACCOUNT_PERMISSIONS.has(permission as AccountPermission))
    : [];
  const statusValue = typeof value.status === "string" ? value.status.trim().toLowerCase() : "";
  const status: AccountSummaryStatus = statusValue === "disabled"
    ? "disabled"
    : statusValue === "pending_activation"
      ? "pending_activation"
      : statusValue === "recovery_required"
        ? "recovery_required"
        : statusValue === "active"
          ? "active"
          : "recovery_required";
  return {
    id: value.id,
    username: value.username,
    displayName: typeof value.displayName === "string" ? value.displayName : value.username,
    role,
    permissions,
    status,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    permissionVersion: typeof value.permissionVersion === "number" && value.permissionVersion > 0 ? value.permissionVersion : 1,
    identityType: value.identityType === "student" || (typeof value.studentId === "string" && value.studentId.trim())
      ? "student"
      : value.identityType === "employee" || (typeof value.employeeId === "string" && value.employeeId.trim())
        ? "employee"
        : undefined,
    employeeId: typeof value.employeeId === "string" && value.employeeId.trim() ? value.employeeId : null,
    employeeNameSnapshot: typeof value.employeeNameSnapshot === "string" && value.employeeNameSnapshot.trim() ? value.employeeNameSnapshot : null,
    studentId: typeof value.studentId === "string" && value.studentId.trim() ? value.studentId : null,
    studentNameSnapshot: typeof value.studentNameSnapshot === "string" && value.studentNameSnapshot.trim() ? value.studentNameSnapshot : null,
  };
}

function asGovernanceSummary(value: unknown): SuperAdminGovernanceSummary {
  const record = isRecord(value) ? value : {};
  const stateValue = typeof record.state === "string" ? record.state.trim() : "";
  const state: SuperAdminGovernanceState = stateValue === "ready"
    || stateValue === "over_limit"
    || stateValue === "not_initialized"
    || stateValue === "no_active_super_admin"
    || stateValue === "drift"
    ? stateValue
    : "not_ready";
  const activeCount = Number.isInteger(record.activeCount) && (record.activeCount as number) >= 0
    ? record.activeCount as number
    : null;
  const limit = Number.isInteger(record.limit) && (record.limit as number) > 0 ? record.limit as number : 0;
  const revision = Number.isInteger(record.revision) && (record.revision as number) > 0
    ? record.revision as number
    : null;
  return { state, activeCount, limit, revision };
}

function asAccountListResult(value: unknown): AccountListResult {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("未返回有效账号列表。");
  return {
    items: value.items.map(asAccountSummary),
    total: Number.isInteger(value.total) && (value.total as number) >= 0 ? value.total as number : value.items.length,
    governance: asGovernanceSummary(value.governance),
  };
}

function asRegistrationRecoveryItem(value: unknown): RegistrationRecoveryItem {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.displayName !== "string") {
    throw new Error("未返回有效的注册恢复记录。");
  }
  const action: RegistrationRecoveryAction | null = value.action === "restore_existing" || value.action === "release_for_retry"
    ? value.action
    : null;
  if (!action) throw new Error("未返回有效的注册恢复方式。");
  return {
    id: value.id,
    displayName: value.displayName,
    identityType: value.identityType === "student" ? "student" : "employee",
    action,
    message: typeof value.message === "string" ? value.message : "",
    detectedAt: typeof value.detectedAt === "string" ? value.detectedAt : null,
  };
}

function asRegistrationRecoveryResult(value: unknown): RegistrationRecoveryResult {
  if (!isRecord(value)
    || (value.action !== "restore_existing" && value.action !== "release_for_retry")
    || typeof value.displayName !== "string"
    || value.recovered !== true) {
    throw new Error("注册恢复结果暂不可核实，请刷新账号列表确认。");
  }
  return { action: value.action, displayName: value.displayName, recovered: true };
}

function asTransferResult(value: unknown): SuperAdminTransferResult {
  if (!isRecord(value)) throw new Error("未返回有效身份转让结果。");
  return {
    sourceAccount: asAccountSummary(value.sourceAccount),
    targetAccount: asAccountSummary(value.targetAccount),
    governance: asGovernanceSummary(value.governance),
  };
}

function asGovernanceInitializationResult(value: unknown): SuperAdminGovernanceSummary {
  if (!isRecord(value) || !isRecord(value.governance)) throw new Error("未返回有效总管理员名额登记结果。");
  const governance = asGovernanceSummary(value.governance);
  if ((governance.state !== "ready" && governance.state !== "over_limit")
    || governance.activeCount === null
    || governance.revision === null) {
    throw new Error("总管理员名额登记结果暂不可核实，请刷新账号列表确认。");
  }
  return governance;
}

function serviceFailure<T>(error: unknown, defaultOutcome: AccountCallOutcome = "definite"): ServiceResult<T> {
  const outcome = error instanceof AccountServiceCallError ? error.outcome : defaultOutcome;
  const code = error instanceof AccountServiceCallError ? error.code : readErrorCode(error);
  return {
    ok: false,
    message: toUserFacingAccountError(error, "系统暂时无法完成此操作，请稍后重试。"),
    ...(code ? { code } : {}),
    outcome,
  };
}

export class CloudFunctionAccountService implements AccountService {
  private async call(route: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!app) throw new AccountServiceCallError("系统尚未准备好，请稍后重试。", "SERVICE_UNAVAILABLE", "definite");
    let response: unknown;
    try {
      response = await app.callFunction({ name: "employeeArchiveApi", data: { route, ...payload } });
    } catch (error) {
      throw new AccountServiceCallError(
        toUserFacingAccountError(error, "连接结果暂时无法确认，请检查网络后重试。"),
        readErrorCode(error),
        "uncertain",
      );
    }
    return unwrap(response);
  }

  async register(input: RegistrationInput): Promise<ServiceResult<AccountProfile>> {
    try {
      const payload = {
        username: input.username,
        password: input.password,
        phoneNumber: input.phoneNumber,
      };
      return { ok: true, data: asAccountProfile(await this.call("accounts/register", payload)) };
    } catch (error) {
      const failure = serviceFailure<AccountProfile>(error);
      if (!failure.ok && error instanceof AccountServiceCallError) {
        if (error.outcome === "uncertain") {
          failure.message = "网络连接异常，请检查网络后重试；如仍无法完成，请联系管理员核对账号状态。";
        } else if (error.requestId) {
          failure.message += `（排查编号：${error.requestId.slice(0, 8)}，可提供给开发者）`;
        }
      }
      return failure;
    }
  }

  async selfResetPassword(input: SelfPasswordResetInput): Promise<ServiceResult<SelfPasswordResetResult>> {
    try {
      const value = await this.call("accounts/self-reset-password", input as unknown as Record<string, unknown>);
      if (isRecord(value) && value.accepted === true) return { ok: true, data: { accepted: true } };
      return { ok: false, message: "暂时无法确认重置请求，请稍后重试。" };
    } catch (error) {
      const code = readErrorCode(error);
      if (code === "PASSWORD_RESET_RATE_LIMITED") {
        return { ok: false, code, message: "尝试次数过多，请过一会儿再试。" };
      }
      if (code === "VALIDATION_ERROR") {
        return { ok: false, code, message: "新密码或填写信息不符合要求，请检查后重试。" };
      }
      return { ok: false, message: "暂时无法确认重置请求，请稍后重试；如仍无法登录，请联系管理员。", outcome: "uncertain" };
    }
  }

  async listAccounts(): Promise<AccountListResult> {
    try {
      return asAccountListResult(await this.call("accounts/list"));
    } catch (error) {
      throw new Error(toUserFacingAccountError(error, "读取账号列表失败，请稍后重试。"));
    }
  }

  async listRegistrationRecoveries(): Promise<RegistrationRecoveryItem[]> {
    const value = await this.call("accounts/registration-recoveries");
    if (!Array.isArray(value)) throw new Error("未返回有效的待恢复注册记录。");
    return value.map(asRegistrationRecoveryItem);
  }

  async recoverRegistration(input: RegistrationRecoveryInput): Promise<ServiceResult<RegistrationRecoveryResult>> {
    try {
      return { ok: true, data: asRegistrationRecoveryResult(await this.call("accounts/recover-registration", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error, "uncertain");
    }
  }

  async resetPassword(input: AccountPasswordResetInput): Promise<ServiceResult<AccountPasswordResetResult>> {
    const failure = (code: string, outcome: AccountCallOutcome = "definite"): ServiceResult<AccountPasswordResetResult> => {
      const messages: Record<string, string> = {
        SERVICE_UNAVAILABLE: "系统尚未准备好，请稍后重试。",
        VALIDATION_ERROR: "密码不符合设置要求，请检查后重试。",
        PERMISSION_DENIED: "当前账号没有执行此操作的权限，请联系总管理员。",
        ACCOUNT_NOT_FOUND: "目标账号不存在或当前状态不可重置。",
        SUPER_ADMIN_REVISION_CONFLICT: "账号状态已变化，请刷新列表后重新确认。",
        SUPER_ADMIN_GOVERNANCE_NOT_READY: "账号管理状态暂不可核实，请稍后刷新。",
        PASSWORD_RESET_FAILED: "密码重置未成功，请稍后重试。",
        AUDIT_WRITE_FAILED: "操作日志暂不可写入，密码重置尚未执行。",
      };
      if (code === "PASSWORD_RESET_RESULT_UNKNOWN") {
        return { ok: false, code, message: "密码重置结果暂不可确认，请查看操作日志后再处理。", outcome: "uncertain" };
      }
      const safeCode = Object.prototype.hasOwnProperty.call(messages, code) ? code : undefined;
      return {
        ok: false,
        ...(safeCode ? { code: safeCode } : {}),
        message: safeCode ? messages[safeCode] : "密码重置结果暂不可确认，请查看操作日志后再处理。",
        outcome: safeCode ? outcome : "uncertain",
      };
    };

    if (!app) return failure("SERVICE_UNAVAILABLE");
    let response: unknown;
    try {
      response = await app.callFunction({
        name: "employeeArchiveApi",
        data: {
          route: "accounts/reset-password",
          accountId: input.accountId,
          newPassword: input.newPassword,
          expectedGovernanceRevision: input.expectedGovernanceRevision,
        },
      });
    } catch {
      return failure("", "uncertain");
    }

    const outer = isRecord(response) ? response : {};
    const nested = isRecord(outer.result) ? outer.result : undefined;
    const value = getPayload(response);
    const payload = isRecord(value) ? value : {};
    const responseError = nested?.error ?? outer.error ?? payload.error;
    const responseOk = nested?.ok ?? outer.ok ?? payload.ok;
    if (responseOk === false || outer.error !== undefined || nested?.error !== undefined || payload.error !== undefined) {
      return failure(readErrorCode(responseError));
    }
    const resetResult = isRecord(value) && value.ok === true ? value.data : value;
    if (isRecord(resetResult) && resetResult.reset === true) return { ok: true, data: { reset: true } };
    return failure("", "uncertain");
  }

  async initializeSuperAdminGovernance(input: SuperAdminGovernanceInitializeInput): Promise<ServiceResult<SuperAdminGovernanceSummary>> {
    try {
      return { ok: true, data: asGovernanceInitializationResult(await this.call("accounts/super-admin-governance/initialize", { operationId: input.operationId })) };
    } catch (error) {
      return serviceFailure(error, "uncertain");
    }
  }

  async upgradeSuperAdminGovernanceLimit(input: GovernanceMutationMetadata): Promise<ServiceResult<SuperAdminGovernanceSummary>> {
    try {
      const value = await this.call("accounts/super-admin-governance/upgrade-limit", input as unknown as Record<string, unknown>);
      if (!isRecord(value) || !isRecord(value.governance)) throw new Error("总管理员名额升级结果暂不可核实。");
      const governance = asGovernanceSummary(value.governance);
      if ((governance.state !== "ready" && governance.state !== "over_limit")
        || governance.limit !== 5
        || governance.activeCount === null
        || governance.revision === null) {
        throw new Error("总管理员名额升级结果暂不可核实。");
      }
      return { ok: true, data: governance };
    } catch (error) {
      return serviceFailure(error, "uncertain");
    }
  }

  async updateRole(input: AccountRoleUpdateInput): Promise<ServiceResult<AccountSummary>> {
    try {
      return { ok: true, data: asAccountSummary(await this.call("accounts/update-role", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async grantPermissions(input: AccountPermissionUpdateInput): Promise<ServiceResult<AccountSummary>> {
    try {
      return { ok: true, data: asAccountSummary(await this.call("accounts/grant-permissions", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async revokePermissions(input: AccountPermissionUpdateInput): Promise<ServiceResult<AccountSummary>> {
    try {
      return { ok: true, data: asAccountSummary(await this.call("accounts/revoke-permissions", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async disableAccount(input: AccountStatusUpdateInput): Promise<ServiceResult<AccountSummary>> {
    try {
      return { ok: true, data: asAccountSummary(await this.call("accounts/disable", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async restoreAccount(input: AccountStatusUpdateInput): Promise<ServiceResult<AccountSummary>> {
    try {
      return { ok: true, data: asAccountSummary(await this.call("accounts/restore", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async bindEmployee(input: AccountEmployeeBindingInput): Promise<ServiceResult<AccountSummary>> {
    try {
      return { ok: true, data: asAccountSummary(await this.call("accounts/bind-employee", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      return serviceFailure(error);
    }
  }

  async transferSuperAdmin(input: SuperAdminTransferInput): Promise<ServiceResult<SuperAdminTransferResult>> {
    try {
      return { ok: true, data: asTransferResult(await this.call("accounts/transfer-super-admin", input as unknown as Record<string, unknown>)) };
    } catch (error) {
      // A response that cannot be decoded after a successful transport may follow a committed transfer.
      return serviceFailure(error, "uncertain");
    }
  }
}

export class LocalPreviewAccountService implements AccountService {
  private readonly previewAccount: AccountSummary = {
    id: "preview-admin",
    username: "development-preview",
    displayName: "体验模式管理员",
    role: "super_admin",
    permissions: ["employee.write", "history.write", "attachment.read", "attachment.write", "audit.read", "monthly_assessment_edit"],
    status: "active",
    createdAt: null,
    updatedAt: null,
    permissionVersion: 1,
  };

  async register(): Promise<ServiceResult<AccountProfile>> {
    return { ok: false, message: "当前为体验模式，不能创建真实账号；请在正式系统中注册。" };
  }

  async selfResetPassword(): Promise<ServiceResult<SelfPasswordResetResult>> {
    return { ok: false, message: "当前为体验模式，不能重置真实账号密码。" };
  }

  async listAccounts(): Promise<AccountListResult> {
    return {
      items: [this.previewAccount],
      total: 1,
      governance: { state: "ready", activeCount: 1, limit: 5, revision: 1 },
    };
  }

  async listRegistrationRecoveries(): Promise<RegistrationRecoveryItem[]> {
    return [];
  }

  async recoverRegistration(): Promise<ServiceResult<RegistrationRecoveryResult>> {
    return { ok: false, message: "当前为体验模式，不能处理真实注册记录。", outcome: "definite" };
  }

  async resetPassword(): Promise<ServiceResult<AccountPasswordResetResult>> {
    return { ok: false, message: "当前为体验模式，不能重置真实账号密码。", outcome: "definite" };
  }

  async initializeSuperAdminGovernance(): Promise<ServiceResult<SuperAdminGovernanceSummary>> {
    return { ok: false, message: "当前为体验模式，不能初始化总管理员名额。" };
  }

  async upgradeSuperAdminGovernanceLimit(): Promise<ServiceResult<SuperAdminGovernanceSummary>> {
    return { ok: false, message: "当前为体验模式，不能调整总管理员名额。" };
  }

  async updateRole(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前为体验模式，不能修改账号权限。" };
  }

  async grantPermissions(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前为体验模式，不能修改账号权限。" };
  }

  async revokePermissions(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前为体验模式，不能修改账号权限。" };
  }

  async disableAccount(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前为体验模式，不能修改账号状态。" };
  }

  async restoreAccount(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前为体验模式，不能修改账号状态。" };
  }

  async bindEmployee(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前为体验模式，不能修改账号与员工的关联。" };
  }

  async transferSuperAdmin(): Promise<ServiceResult<SuperAdminTransferResult>> {
    return { ok: false, message: "当前为体验模式，不能转让总管理员身份。", outcome: "definite" };
  }
}

export class UnconfiguredAccountService implements AccountService {
  async register(): Promise<ServiceResult<AccountProfile>> {
    return { ok: false, message: "当前暂时无法注册账号，请联系管理员。" };
  }

  async selfResetPassword(): Promise<ServiceResult<SelfPasswordResetResult>> {
    return { ok: false, message: "当前暂时无法处理密码重置，请稍后重试或联系管理员。" };
  }

  async listAccounts(): Promise<AccountListResult> {
    throw new Error("当前暂时无法读取账号列表，请稍后重试。");
  }

  async listRegistrationRecoveries(): Promise<RegistrationRecoveryItem[]> {
    throw new Error("当前暂时无法读取待恢复注册记录，请稍后重试。");
  }

  async recoverRegistration(): Promise<ServiceResult<RegistrationRecoveryResult>> {
    return { ok: false, message: "当前暂时无法处理注册恢复，请联系总管理员。", outcome: "definite" };
  }

  async resetPassword(): Promise<ServiceResult<AccountPasswordResetResult>> {
    return { ok: false, message: "当前暂时无法重置账号密码，请联系总管理员。", outcome: "definite" };
  }

  async initializeSuperAdminGovernance(): Promise<ServiceResult<SuperAdminGovernanceSummary>> {
    return { ok: false, message: "当前暂时无法初始化总管理员名额，请联系管理员。" };
  }

  async upgradeSuperAdminGovernanceLimit(): Promise<ServiceResult<SuperAdminGovernanceSummary>> {
    return { ok: false, message: "当前暂时无法调整总管理员名额，请联系管理员。" };
  }

  async updateRole(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前暂时无法修改账号权限，请联系管理员。" };
  }

  async grantPermissions(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前暂时无法修改账号权限，请联系管理员。" };
  }

  async revokePermissions(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前暂时无法修改账号权限，请联系管理员。" };
  }

  async disableAccount(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前暂时无法修改账号状态，请联系管理员。" };
  }

  async restoreAccount(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前暂时无法修改账号状态，请联系管理员。" };
  }

  async bindEmployee(): Promise<ServiceResult<AccountSummary>> {
    return { ok: false, message: "当前暂时无法修改账号与员工的关联，请联系管理员。" };
  }

  async transferSuperAdmin(): Promise<ServiceResult<SuperAdminTransferResult>> {
    return { ok: false, message: "当前暂时无法转让总管理员身份，请联系管理员。", outcome: "definite" };
  }
}
