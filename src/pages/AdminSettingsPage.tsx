import { CheckCircle2, CircleAlert, LoaderCircle, LockKeyhole, Power, RefreshCw, UserCog, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AccountPasswordResetInput, AccountRole, AccountSummary, AccountSummaryStatus, Employee, GovernanceMutationMetadata, RegistrationRecoveryItem, SuperAdminGovernanceSummary, SuperAdminTransferInput } from "../types";
import type { AccountService } from "../services/accountService";
import type { AsyncEmployeeDataService, EmployeeDataService } from "../services/dataService";
import { ACCOUNT_GOVERNANCE_REFRESH_REQUESTED, clearPendingSuperAdminTransfer, createGovernanceOperationId, PENDING_SUPER_ADMIN_TRANSFER_CHANGED, readPendingSuperAdminTransfer, savePendingSuperAdminTransfer } from "../services/superAdminTransferRecovery";
import { PendingSuperAdminTransferNotice } from "../components/PendingSuperAdminTransferNotice";
import { getPermissionGroupState, getPermissionGroupStateLabel, PERMISSION_GROUPS, type PermissionGroupDefinition } from "../utils/permissionGroups";
import { REGISTRATION_PASSWORD_RULE_MESSAGE } from "../utils/registrationMessages";

const CURRENT_SUPER_ADMIN_LIMIT = 5;
const PREVIOUS_SUPER_ADMIN_LIMIT = 3;

function isStudentAccount(row: AccountSummary): boolean {
  return row.identityType === "student" || Boolean(row.studentId?.trim());
}

function roleLabel(role: AccountRole): string {
  if (role === "super_admin") return "总管理员";
  if (role === "admin") return "其他管理员";
  return "普通注册用户";
}

function roleDescription(role: AccountRole): string {
  if (role === "super_admin") return "全部权限，可管理账号与权限";
  if (role === "admin") return "仅使用总管理员授予的业务权限";
  return "登录后只读查看，不能自行提权";
}

function accountStatusLabel(status: AccountSummaryStatus): string {
  if (status === "active") return "正常";
  if (status === "disabled") return "已停用";
  if (status === "pending_activation") return "待激活";
  return "需管理员核对";
}

function accountStatusClass(status: AccountSummaryStatus): string {
  if (status === "active") return "account-status-pill account-status-active";
  if (status === "disabled" || status === "recovery_required") return "account-status-pill account-status-disabled";
  return "account-status-pill account-role-pill";
}

function governanceIsWritable(governance: SuperAdminGovernanceSummary | null): boolean {
  return Boolean(governance
    && governance.limit === CURRENT_SUPER_ADMIN_LIMIT
    && (governance.state === "ready" || governance.state === "over_limit")
    && Number.isInteger(governance.revision)
    && (governance.revision ?? 0) > 0);
}

function findActorAccount(rows: AccountSummary[], accountId: string, username: string): AccountSummary | undefined {
  const normalizedUsername = username.trim().toLowerCase();
  if (normalizedUsername) {
    return rows.find((row) => row.username.trim().toLowerCase() === normalizedUsername);
  }
  return rows.find((row) => row.id === accountId);
}

function satisfiesPasswordPolicy(value: string): boolean {
  const specialCharacters = new Set("()!@#$%^&*|?><_-");
  const hasInvalidCharacter = [...value].some((character) => !/[A-Za-z0-9]/.test(character) && !specialCharacters.has(character));
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /[0-9]/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  return value.length >= 8
    && value.length <= 32
    && /^[A-Za-z0-9]/.test(value)
    && !hasInvalidCharacter
    && classes >= 3;
}

interface AdminSettingsPageProps {
  accounts: AccountService;
  actorAccountId?: string;
  actorAccountUsername?: string;
  onTransferComplete?: () => Promise<void>;
  showRecoveryNotice?: boolean;
  data?: EmployeeDataService | AsyncEmployeeDataService;
}

export function AdminSettingsPage({ accounts, actorAccountId = "", actorAccountUsername = "", onTransferComplete, showRecoveryNotice = true, data }: AdminSettingsPageProps) {
  const [rows, setRows] = useState<AccountSummary[]>([]);
  const [registrationRecoveries, setRegistrationRecoveries] = useState<RegistrationRecoveryItem[]>([]);
  const [registrationRecoveryError, setRegistrationRecoveryError] = useState<string | null>(null);
  const [governance, setGovernance] = useState<SuperAdminGovernanceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<SuperAdminTransferInput | null>(() => readPendingSuperAdminTransfer(actorAccountId));
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [showFinalTransferConfirmation, setShowFinalTransferConfirmation] = useState(false);
  const [passwordResetTarget, setPasswordResetTarget] = useState<AccountSummary | null>(null);
  const [passwordResetValue, setPasswordResetValue] = useState("");
  const [passwordResetConfirmation, setPasswordResetConfirmation] = useState("");
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null);
  const autoInitializationRef = useRef<Promise<void> | null>(null);
  const autoQuotaUpgradeRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const recoveryRequest: Promise<{ items: RegistrationRecoveryItem[]; error: string | null }> = accounts.listRegistrationRecoveries
      ? Promise.resolve()
        .then(() => accounts.listRegistrationRecoveries!())
        .then((items) => ({ items, error: null }))
        .catch(() => ({ items: [], error: "注册恢复记录暂时无法读取，请刷新列表重试。" }))
      : Promise.resolve({ items: [], error: null });
    void recoveryRequest.then(({ items, error: recoveryError }) => {
      if (!cancelled) {
        setRegistrationRecoveries(items);
        setRegistrationRecoveryError(recoveryError);
      }
    });

    void (async () => {
      try {
        let snapshot = await accounts.listAccounts();
        const currentActor = findActorAccount(snapshot.items, actorAccountId, actorAccountUsername);
        if (!pendingTransfer
          && snapshot.governance.limit === PREVIOUS_SUPER_ADMIN_LIMIT
          && snapshot.governance.revision !== null
          && currentActor?.role === "super_admin"
          && currentActor.status === "active"
          && accounts.upgradeSuperAdminGovernanceLimit) {
          if (!autoQuotaUpgradeRef.current) {
            autoQuotaUpgradeRef.current = (async () => {
              const result = await accounts.upgradeSuperAdminGovernanceLimit?.({
                operationId: createGovernanceOperationId(),
                expectedGovernanceRevision: snapshot.governance.revision as number,
              });
              if (!result?.ok) throw new Error("名额调整未能确认。");
            })();
          }
          try {
            await autoQuotaUpgradeRef.current;
          } catch {
            autoQuotaUpgradeRef.current = null;
          }
          snapshot = await accounts.listAccounts();
        }

        if (!pendingTransfer
          && snapshot.governance.state === "not_initialized"
          && currentActor?.role === "super_admin"
          && currentActor.status === "active"
          && accounts.initializeSuperAdminGovernance) {
          if (!autoInitializationRef.current) {
            autoInitializationRef.current = (async () => {
              const operationId = createGovernanceOperationId();
              const result = await accounts.initializeSuperAdminGovernance?.({ operationId });
              if (!result?.ok) throw new Error("初始化未能确认。");
            })();
          }
          try {
            await autoInitializationRef.current;
          } catch {
            // Another open page may have completed the one-time initialization,
            // or the response may have been lost after its transaction committed.
            // Re-read the server state before deciding that initialization failed.
            autoInitializationRef.current = null;
          }
          try {
            snapshot = await accounts.listAccounts();
            if (!governanceIsWritable(snapshot.governance)) throw new Error("初始化状态未能确认。");
            autoInitializationRef.current = null;
            if (!cancelled) setError(null);
          } catch {
            autoInitializationRef.current = null;
            if (!cancelled) {
              setRows(snapshot.items);
              setGovernance(snapshot.governance);
              setError("账号权限状态暂时无法确认，请刷新列表后重试。");
            }
            return;
          }
        }

        if (!cancelled) {
          setRows(snapshot.items);
          setGovernance(snapshot.governance);
        }
      } catch (loadError: unknown) {
        if (!cancelled) {
          setRows([]);
          setGovernance(null);
          setError(loadError instanceof Error ? loadError.message : "读取账号列表失败，请稍后重试。");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, actorAccountId, actorAccountUsername, pendingTransfer, reloadToken]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    void Promise.resolve(data.listEmployees({ search: "", status: "active", department: "all", attention: "all" }))
      .then((nextEmployees) => {
        if (!cancelled) setEmployees(nextEmployees.filter((employee) => employee.status === "active"));
      })
      .catch(() => {
        if (!cancelled) setEmployees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [data, reloadToken]);

  useEffect(() => {
    const syncPendingTransfer = () => setPendingTransfer(readPendingSuperAdminTransfer(actorAccountId));
    const requestRefresh = () => {
      setIsLoading(true);
      setReloadToken((value) => value + 1);
    };
    window.addEventListener(PENDING_SUPER_ADMIN_TRANSFER_CHANGED, syncPendingTransfer);
    window.addEventListener(ACCOUNT_GOVERNANCE_REFRESH_REQUESTED, requestRefresh);
    syncPendingTransfer();
    return () => {
      window.removeEventListener(PENDING_SUPER_ADMIN_TRANSFER_CHANGED, syncPendingTransfer);
      window.removeEventListener(ACCOUNT_GOVERNANCE_REFRESH_REQUESTED, requestRefresh);
    };
  }, [actorAccountId]);

  const governanceWritesEnabled = import.meta.env.VITE_ACCOUNT_GOVERNANCE_WRITES_ENABLED?.trim().toLowerCase() === "true";
  const currentActor = findActorAccount(rows, actorAccountId, actorAccountUsername);
  const writeBlockReasons: { code: string; message: string }[] = [];
  if (isLoading) {
    writeBlockReasons.push({ code: "ACCOUNT_LIST_LOADING", message: "账号和权限信息仍在读取，请稍候；如果长时间不消失，可以刷新列表。" });
  } else {
    if (!governanceWritesEnabled) {
      writeBlockReasons.push({ code: "FRONTEND_GOVERNANCE_WRITES_DISABLED", message: "当前发布版本暂未开放账号权限修改，请联系系统维护人员检查发布配置。" });
    }
    if (pendingTransfer) {
      writeBlockReasons.push({ code: "SUPER_ADMIN_TRANSFER_PENDING", message: "有一笔总管理员转让结果待核对；核对完成前，其他账号变更会暂停。" });
    }
    if (!governance) {
      writeBlockReasons.push({ code: "GOVERNANCE_STATE_UNAVAILABLE", message: "总管理员名单状态暂时无法读取，请刷新列表后重试。" });
    } else {
      if (governance.limit !== CURRENT_SUPER_ADMIN_LIMIT) {
        writeBlockReasons.push({ code: "GOVERNANCE_LIMIT_MISMATCH", message: `总管理员名额配置尚未核准为 ${CURRENT_SUPER_ADMIN_LIMIT} 人（当前读取到 ${governance.limit}），权限修改已暂停。` });
      }
      if (governance.state !== "ready" && governance.state !== "over_limit") {
        const stateMessage = governance.state === "not_initialized"
          ? "总管理员名单尚未初始化。"
          : governance.state === "no_active_super_admin"
            ? "名单中没有启用的总管理员。"
            : governance.state === "drift"
              ? "总管理员名单与账号状态不一致，需要核对。"
              : "总管理员名单状态暂时无法确认。";
        writeBlockReasons.push({ code: `GOVERNANCE_STATE_${governance.state.toUpperCase()}`, message: `${stateMessage}权限修改已暂停，请刷新列表或核对名单。` });
      }
      if (!Number.isInteger(governance.revision) || (governance.revision ?? 0) <= 0) {
        writeBlockReasons.push({ code: "GOVERNANCE_REVISION_INVALID", message: "总管理员名单版本无法核对，请刷新列表后重试。" });
      }
    }
    if (actorAccountUsername.trim()) {
      if (!currentActor) {
        writeBlockReasons.push({ code: "CURRENT_ADMIN_ACCOUNT_NOT_MATCHED", message: "当前登录账号未能与启用总管理员记录匹配，请重新登录；若仍出现，请核对账号绑定。" });
      } else if (currentActor.role !== "super_admin") {
        writeBlockReasons.push({ code: "CURRENT_ACCOUNT_NOT_SUPER_ADMIN", message: "当前登录账号未被核验为总管理员，请使用总管理员账号重新登录。" });
      } else if (currentActor.status !== "active") {
        writeBlockReasons.push({ code: "CURRENT_SUPER_ADMIN_NOT_ACTIVE", message: "当前总管理员账号已停用，无法调整其他账号。" });
      }
    }
  }
  const canWrite = writeBlockReasons.length === 0;
  const visibleWriteBlockReasons = showRecoveryNotice && pendingTransfer
    ? writeBlockReasons.filter((reason) => reason.code !== "SUPER_ADMIN_TRANSFER_PENDING")
    : writeBlockReasons;
  const canIncreaseCount = canWrite
    && governance?.state === "ready"
    && governance.activeCount !== null
    && governance.activeCount < governance.limit;
  const currentActorRowId = currentActor?.id ?? (actorAccountUsername.trim() ? "" : actorAccountId);
  const canResetPassword = canWrite && currentActor?.role === "super_admin" && currentActor.status === "active";
  const transferCandidates = rows.filter((row) => !isStudentAccount(row)
    && row.id !== currentActorRowId
    && row.status === "active"
    && (row.role === "user" || row.role === "admin"));

  function requestRefresh(): void {
    setIsLoading(true);
    setReloadToken((value) => value + 1);
  }

  function mutationMetadata(): GovernanceMutationMetadata | null {
    if (!canWrite || governance?.revision === null || governance?.revision === undefined) {
      setError("当前无法调整账号，请刷新列表后重试。");
      requestRefresh();
      return null;
    }
    try {
      return {
        operationId: createGovernanceOperationId(),
        expectedGovernanceRevision: governance.revision,
      };
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "无法生成安全操作编号，请稍后重试。");
      return null;
    }
  }

  function replaceRow(next: AccountSummary): void {
    setRows((current) => current.map((row) => row.id === next.id ? next : row));
  }

  async function changeRole(row: AccountSummary, role: AccountRole): Promise<void> {
    const explicitOtherAdminDemotion = row.role === "super_admin" && role === "admin" && row.id !== currentActorRowId;
    if (isStudentAccount(row) || row.status !== "active" || row.role === role || !canWrite || (row.role === "super_admin" && !explicitOtherAdminDemotion)) return;
    if (role === "super_admin") {
      if (!canIncreaseCount) {
        setError("当前无法调整为总管理员，请刷新列表后重试。");
        requestRefresh();
        return;
      }
      const confirmed = window.confirm("确认将账号“" + row.username + "”从" + roleLabel(row.role) + "提升为总管理员？");
      if (!confirmed) return;
    } else if (explicitOtherAdminDemotion
      && !window.confirm("确认将其他总管理员“" + row.username + "”降为其他管理员？其现有日常业务权限保留。")) {
      return;
    }
    const metadata = mutationMetadata();
    if (!metadata) return;
    setBusyKey(`${row.id}:role`);
    setError(null);
    setMessage(null);
    try {
      const result = await accounts.updateRole({ accountId: row.id, role, ...metadata });
      if (!result.ok) {
        setError(result.outcome === "uncertain" ? "账号角色调整结果暂不可确认，已刷新账号状态，请稍后查看。" : "账号角色暂未调整，请刷新后重试。");
        requestRefresh();
        return;
      }
      replaceRow(result.data);
      setMessage("账号“" + row.username + "”已调整为" + roleLabel(role) + "。");
      requestRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function changePermissionGroup(row: AccountSummary, group: PermissionGroupDefinition, enabled: boolean): Promise<void> {
    if (isStudentAccount(row) || row.status !== "active" || row.role !== "admin" || !canWrite) return;
    const metadata = mutationMetadata();
    if (!metadata) return;
    const key = `${row.id}:${group.id}`;
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      const result = enabled
        ? await accounts.grantPermissions({ accountId: row.id, permissions: [...group.permissions], ...metadata })
        : await accounts.revokePermissions({ accountId: row.id, permissions: [...group.permissions], ...metadata });
      if (!result.ok) {
        setError(result.outcome === "uncertain" ? result.message + " 操作结果暂不可确认，已刷新服务端账号状态。" : result.message);
        requestRefresh();
        return;
      }
      replaceRow(result.data);
      setMessage(`${enabled ? "已启用" : "已关闭"}“${row.username}”的${group.label}权限组。`);
      requestRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function changeStatus(row: AccountSummary): Promise<void> {
    if ((row.status !== "active" && row.status !== "disabled") || !canWrite) return;
    const nextStatus = row.status === "active" ? "disabled" : "active";
    if (nextStatus === "active" && row.role === "super_admin" && !canIncreaseCount) {
      setError("当前无法恢复该账号，请刷新列表后重试。");
      requestRefresh();
      return;
    }
    const metadata = mutationMetadata();
    if (!metadata) return;
    setBusyKey(`${row.id}:status`);
    setError(null);
    setMessage(null);
    try {
      const input = { accountId: row.id, ...metadata };
      const result = nextStatus === "disabled" ? await accounts.disableAccount(input) : await accounts.restoreAccount(input);
      if (!result.ok) {
        setError(result.outcome === "uncertain" ? "账号状态调整结果暂不可确认，已刷新账号状态，请稍后查看。" : "账号状态暂未调整，请刷新后重试。");
        requestRefresh();
        return;
      }
      replaceRow(result.data);
      setMessage(`账号“${row.username}”已${nextStatus === "disabled" ? "停用" : "恢复"}。`);
      requestRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  function openPasswordResetDialog(row: AccountSummary): void {
    if (isStudentAccount(row) || !canResetPassword || row.status !== "active" || row.id === currentActorRowId) return;
    setPasswordResetTarget(row);
    setPasswordResetValue("");
    setPasswordResetConfirmation("");
    setPasswordResetError(null);
    setError(null);
  }

  function closePasswordResetDialog(): void {
    if (busyKey?.endsWith(":password-reset")) return;
    setPasswordResetTarget(null);
    setPasswordResetValue("");
    setPasswordResetConfirmation("");
    setPasswordResetError(null);
  }

  async function submitPasswordReset(): Promise<void> {
    const target = passwordResetTarget && rows.find((row) => row.id === passwordResetTarget.id);
    if (!canResetPassword || !target || isStudentAccount(target) || target.status !== "active" || target.id === currentActorRowId) {
      setPasswordResetError("目标账号状态已变化，请关闭窗口并刷新后重试。");
      return;
    }
    if (!governance || governance.revision === null) {
      setPasswordResetError("账号管理状态暂不可核实，请刷新列表后重试。");
      return;
    }
    if (!satisfiesPasswordPolicy(passwordResetValue)) {
      setPasswordResetError(REGISTRATION_PASSWORD_RULE_MESSAGE);
      return;
    }
    if (passwordResetValue !== passwordResetConfirmation) {
      setPasswordResetError("两次输入的密码不一致。");
      return;
    }
    if (!window.confirm(`确认重置账号“${target.username}”的登录密码？原密码无法查询；提交后请通过安全渠道将新密码告知本人。`)) return;

    const input: AccountPasswordResetInput = {
      accountId: target.id,
      newPassword: passwordResetValue,
      expectedGovernanceRevision: governance.revision,
    };
    setBusyKey(`${target.id}:password-reset`);
    setError(null);
    setMessage(null);
    setPasswordResetError(null);
    setPasswordResetValue("");
    setPasswordResetConfirmation("");
    try {
      const result = await accounts.resetPassword(input);
      if (!result.ok) {
        setError(result.outcome === "uncertain"
          ? "密码重置结果暂不可确认，请查看操作日志后再处理。"
          : result.message);
        requestRefresh();
        return;
      }
      setMessage(`账号“${target.username}”的密码已重置。`);
      requestRefresh();
    } catch {
      setError("密码重置结果暂不可确认，请查看操作日志后再处理。");
      requestRefresh();
    } finally {
      setPasswordResetTarget(null);
      setPasswordResetValue("");
      setPasswordResetConfirmation("");
      setPasswordResetError(null);
      setBusyKey(null);
    }
  }

  async function changeBinding(row: AccountSummary, employeeId: string): Promise<void> {
    if (isStudentAccount(row) || row.status !== "active" || !canWrite) return;
    const metadata = mutationMetadata();
    if (!metadata) return;
    setBusyKey(`${row.id}:binding`);
    setError(null);
    setMessage(null);
    try {
      const result = await accounts.bindEmployee({ accountId: row.id, employeeId: employeeId || null, ...metadata });
      if (!result.ok) {
        setError(result.outcome === "uncertain" ? result.message + " 操作结果暂不可确认，已刷新服务端账号状态。" : result.message);
        requestRefresh();
        return;
      }
      replaceRow(result.data);
      setMessage(`账号“${row.username}”的评价身份已${employeeId ? "绑定" : "解除绑定"}。`);
      requestRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  async function resolveRegistrationRecovery(recovery: RegistrationRecoveryItem): Promise<void> {
    if (!canWrite || !accounts.recoverRegistration) return;
    const message = recovery.action === "restore_existing"
      ? `确认恢复${recovery.identityType === "student" ? "学员" : "员工"}“${recovery.displayName}”的注册？系统会完成现有登录账号与档案的绑定，按普通用户权限启用，并保留原登录名和密码；请提醒本人使用首次注册时设置的密码登录。`
      : `确认解除${recovery.identityType === "student" ? "学员" : "员工"}“${recovery.displayName}”未完成的注册占用？系统已核实没有创建登录账号；处理后本人可以重新注册并设置密码。`;
    if (!window.confirm(message)) return;
    setBusyKey(`registration:${recovery.id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await accounts.recoverRegistration({ claimId: recovery.id, action: recovery.action });
      if (!result.ok) {
        setError(result.outcome === "uncertain"
          ? "处理结果暂不可确认，已重新读取注册状态；请查看列表后再操作。"
          : result.message);
        requestRefresh();
        return;
      }
      setMessage(recovery.action === "restore_existing"
        ? `已恢复“${recovery.displayName}”的账号绑定，账号按普通用户权限启用。`
        : `已解除“${recovery.displayName}”未完成的注册占用，可以重新注册。`);
      requestRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  function openTransferDialog(): void {
    if (!canWrite || transferCandidates.length === 0) return;
    setTransferTargetId("");
    setShowFinalTransferConfirmation(false);
    setTransferDialogOpen(true);
  }

  function closeTransferDialog(): void {
    if (busyKey === "transfer") return;
    setTransferDialogOpen(false);
    setTransferTargetId("");
    setShowFinalTransferConfirmation(false);
  }

  async function submitTransfer(): Promise<void> {
    const source = currentActor;
    const target = transferCandidates.find((row) => row.id === transferTargetId);
    if (!canWrite || !source || isStudentAccount(source) || source.role !== "super_admin" || source.status !== "active" || !target || !showFinalTransferConfirmation) return;
    const metadata = mutationMetadata();
    if (!metadata) return;
    const input: SuperAdminTransferInput = { targetAccountId: target.id, ...metadata };
    if (!savePendingSuperAdminTransfer(actorAccountId, input)) {
      setError("无法在此浏览器保存转让请求，尚未提交。请检查浏览器存储设置后再试。");
      return;
    }
    setPendingTransfer(input);
    setBusyKey("transfer");
    setError(null);
    setMessage(null);
    setTransferDialogOpen(false);
    try {
      const result = await accounts.transferSuperAdmin(input);
      if (!result.ok) {
        if (result.outcome === "uncertain") {
          setError(result.message + " 已保存完全相同的转让请求；请使用原请求核对结果，不能另开转让。");
          requestRefresh();
          return;
        }
        clearPendingSuperAdminTransfer(actorAccountId);
        setPendingTransfer(null);
        setError(result.message);
        requestRefresh();
        return;
      }
      setMessage("身份转让已完成，正在刷新当前账号权限。");
      if (onTransferComplete) {
        try {
          await onTransferComplete();
        } catch {
          setError("服务端已确认转让，但当前会话权限刷新失败。原请求编号已保留，可在主界面按同一请求核对；不会创建新转让。");
          requestRefresh();
          return;
        }
      }
      clearPendingSuperAdminTransfer(actorAccountId);
      setPendingTransfer(null);
      if (!onTransferComplete) requestRefresh();
    } catch (transferError) {
      setError((transferError instanceof Error ? transferError.message : "转让结果暂不可确认。") + " 已保留原请求，请按同一请求核对结果。");
      requestRefresh();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="page-frame account-settings-page" data-permission-write-block={writeBlockReasons.map((reason) => reason.code).join(" ") || undefined}>
      <header className="page-header">
        <div>
          <span className="eyebrow">账号权限</span>
          <h1>账号与权限</h1>
        </div>
        <div className="page-header-actions">
          <button className="secondary-button" type="button" onClick={() => { setError(null); requestRefresh(); }} disabled={isLoading || busyKey !== null}>
            {isLoading ? <LoaderCircle size={16} /> : <RefreshCw size={16} />}刷新列表
          </button>
        </div>
      </header>

      {visibleWriteBlockReasons.length ? <div className="form-message form-message-error account-governance-write-block" role="status" aria-live="polite" data-diagnostic-codes={visibleWriteBlockReasons.map((reason) => reason.code).join(" ")}>
        <CircleAlert size={16} aria-hidden="true" />
        <div>
          <strong>账号权限暂时不能修改</strong>
          <ul>{visibleWriteBlockReasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul>
          <small>排查码：{writeBlockReasons.map((reason) => reason.code).join("、") || "未知"} · 名单状态：{governance?.state ?? "未读取"} · 名额：{governance?.activeCount ?? "未知"}/{governance?.limit ?? "未知"} · 版本：{governance?.revision ?? "未知"}</small>
        </div>
      </div> : null}
      {showRecoveryNotice && actorAccountId ? <PendingSuperAdminTransferNotice accountId={actorAccountId} accounts={accounts} onTransferComplete={onTransferComplete ?? (async () => undefined)} /> : null}
      {message ? <div className="form-message form-message-success" role="status"><CheckCircle2 size={16} />{message}</div> : null}
      {error ? <div className="form-message form-message-error" role="alert"><CircleAlert size={16} />{error}<button className="text-button" type="button" onClick={() => setError(null)}>关闭</button></div> : null}
      {registrationRecoveryError ? <div className="form-message form-message-error" role="status"><CircleAlert size={16} />{registrationRecoveryError}</div> : null}

      {registrationRecoveries.length ? <section className="registration-recovery-panel" aria-labelledby="registration-recovery-title">
        <header>
          <div><span className="settings-label">账号恢复</span><h2 id="registration-recovery-title">未完成的注册</h2><p>仅总管理员可处理；每次处理都会写入操作日志。</p></div>
          <span className="registration-recovery-count">{registrationRecoveries.length} 条</span>
        </header>
        <div className="registration-recovery-list">
          {registrationRecoveries.map((recovery) => {
            const isBusy = busyKey === `registration:${recovery.id}`;
            return <article className="registration-recovery-row" key={recovery.id}>
              <div className="registration-recovery-copy">
                <strong>{recovery.displayName}<span>{recovery.identityType === "student" ? "学员" : "员工"}</span></strong>
                <small>{recovery.message}</small>
              </div>
              <button className="secondary-button compact-button" type="button" onClick={() => void resolveRegistrationRecovery(recovery)} disabled={!canWrite || isBusy || busyKey !== null}>
                {isBusy ? <LoaderCircle size={15} /> : <CheckCircle2 size={15} />}
                {recovery.action === "restore_existing" ? "恢复账号" : "允许重新注册"}
              </button>
            </article>;
          })}
        </div>
      </section> : null}

      {isLoading ? <div className="empty-list account-settings-empty" aria-live="polite"><LoaderCircle size={32} /><h2>正在读取账号列表</h2></div> : rows.length ? <div className="account-settings-list">
        {rows.map((row) => {
          const isBusy = busyKey?.startsWith(`${row.id}:`) ?? false;
          const isStudent = isStudentAccount(row);
          const isSuperAdmin = row.role === "super_admin";
          const isCurrentActor = currentActor ? row.id === currentActor.id : !actorAccountUsername.trim() && row.id === actorAccountId;
          return <article className={`account-settings-card ${row.status === "disabled" ? "is-disabled" : ""}`} key={row.id}>
            <header className="account-settings-card-header">
              <div className="account-settings-identity"><span className="account-settings-mark"><UserCog size={18} /></span><div><strong>{row.displayName}</strong><span className="mono-value">{row.username}</span></div></div>
              <div className="account-settings-status"><span className={accountStatusClass(row.status)}>{accountStatusLabel(row.status)}</span><span className="account-role-pill">{isStudent ? "学员" : roleLabel(row.role)}</span></div>
            </header>
            <div className="account-settings-card-body">
              <div className="account-role-control">
                <div><span className="settings-label">账号角色</span><strong>{isStudent ? "学员 · 普通注册用户" : roleLabel(row.role)}</strong><small>{isStudent ? "学员账号固定为普通用户，不授予业务权限。" : roleDescription(row.role)}</small></div>
                {isStudent ? null : isSuperAdmin
                  ? isCurrentActor
                    ? <button className="secondary-button compact-button" type="button" onClick={openTransferDialog} disabled={!canWrite || isBusy || transferCandidates.length === 0}>转让总管理员身份</button>
                    : <button className="secondary-button compact-button" type="button" onClick={() => void changeRole(row, "admin")} disabled={!canWrite || isBusy || row.status !== "active"}><LockKeyhole size={14} />降为其他管理员</button>
                  : <select className="field-control account-role-select" aria-label={`调整${row.username}的账号角色`} value={row.role} onChange={(event) => void changeRole(row, event.target.value as AccountRole)} disabled={!canWrite || isBusy || row.status !== "active"}>
                    <option value="user">普通注册用户</option><option value="admin">其他管理员</option>
                    <option value="super_admin" disabled={!canIncreaseCount}>总管理员</option>
                  </select>}
              </div>
              {isStudent ? <div className="account-role-control account-identity-binding">
                <div><span className="settings-label">学员身份绑定</span><strong>{row.studentNameSnapshot || "未记录学员姓名"}</strong><small>{row.studentId ? `学员档案编号：${row.studentId}` : "未绑定学员档案，需核对注册记录。"}</small></div>
              </div> : data ? <div className="account-role-control account-identity-binding">
                <div><span className="settings-label">评价身份绑定</span><strong>{row.employeeNameSnapshot || "未绑定员工身份"}</strong><small>普通用户自评需要总管理员核验绑定；历史评价会保留当时对应的员工身份信息。</small></div>
                <select className="field-control account-role-select" aria-label={`绑定${row.username}的评价身份`} value={row.employeeId ?? ""} onChange={(event) => void changeBinding(row, event.target.value)} disabled={!canWrite || isBusy || row.status !== "active"}>
                  <option value="">未绑定</option>
                  {employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.department || "未填写部门"}</option>)}
                </select>
              </div> : null}
              {!isStudent ? <div className="account-permission-section">
                <div className="settings-label-row"><span className="settings-label">业务权限组</span><small>{isSuperAdmin ? "总管理员自动拥有全部权限" : row.role === "admin" ? "启用即授予整组权限，关闭即收回整组权限" : "普通注册用户仅可查看"}</small></div>
                <div className="permission-checkboxes">
                  {PERMISSION_GROUPS.map((group) => {
                    const state = getPermissionGroupState(row.role, row.permissions, group);
                    const checked = state === "all" || state === "enabled" || state === "partial";
                    const permissionBusy = busyKey === `${row.id}:${group.id}`;
                    return <div className={`permission-checkbox ${row.role !== "admin" ? "is-readonly" : ""}`} key={group.id}>
                      <input type="checkbox" checked={checked} aria-label={`切换${row.username}的${group.label}权限组`} disabled={!canWrite || isSuperAdmin || row.role !== "admin" || row.status !== "active" || isBusy} onChange={(event) => void changePermissionGroup(row, group, event.target.checked)} />
                      <span><strong>{group.label}</strong><small>{group.description}</small><small>{getPermissionGroupStateLabel(state)}</small></span>
                      {state === "partial" && !permissionBusy ? <button className="text-button" type="button" onClick={() => void changePermissionGroup(row, group, true)} disabled={!canWrite || row.status !== "active" || isBusy}>补齐权限</button> : null}
                      {permissionBusy ? <LoaderCircle size={14} /> : null}
                    </div>;
                  })}
                </div>
              </div> : null}
            </div>
            <footer className="account-settings-card-footer">
              {!isStudent && canResetPassword && row.status === "active" && !isCurrentActor ? <button className="secondary-button compact-button" type="button" onClick={() => openPasswordResetDialog(row)} disabled={isBusy || busyKey !== null}><LockKeyhole size={14} />重置密码</button> : null}
              {row.status === "active" || row.status === "disabled" ? <button className="secondary-button compact-button" type="button" onClick={() => void changeStatus(row)} disabled={!canWrite || isBusy || (row.status === "disabled" && row.role === "super_admin" && !canIncreaseCount)}>{isBusy && busyKey === `${row.id}:status` ? <LoaderCircle size={15} /> : <Power size={15} />}{row.status === "active" ? "停用账号" : "恢复账号"}</button> : <span className="permission-readout"><LockKeyhole size={14} />{row.status === "pending_activation" ? "激活完成后可管理账号" : "需管理员核对后再操作"}</span>}
            </footer>
          </article>;
        })}
      </div> : <div className="empty-list account-settings-empty"><UserCog size={32} /><h2>暂无账号记录</h2><p>注册账号后，账号会出现在这里。</p></div>}

      {passwordResetTarget ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePasswordResetDialog(); }}>
        <section className="editor-modal account-governance-dialog" role="dialog" aria-modal="true" aria-labelledby="password-reset-title">
          <header className="editor-header">
            <div><span className="eyebrow">账号凭据管理</span><h2 id="password-reset-title">重置登录密码</h2></div>
            <button className="icon-button" type="button" aria-label="关闭密码重置" onClick={closePasswordResetDialog} disabled={busyKey?.endsWith(":password-reset")}><X size={18} /></button>
          </header>
          <div className="editor-body">
            <div className="editor-notice"><p>目标账号：<strong>{passwordResetTarget.displayName} · {passwordResetTarget.username}</strong></p><p>系统无法查询原密码。确认后将为该账号设置新密码，请通过安全渠道告知本人。</p></div>
            <div className="field"><label className="field-label" htmlFor="password-reset-new">新密码</label><input id="password-reset-new" className="field-control" type="password" autoComplete="new-password" value={passwordResetValue} onChange={(event) => { setPasswordResetValue(event.target.value); setPasswordResetError(null); }} disabled={busyKey?.endsWith(":password-reset")} /></div>
            <div className="field"><label className="field-label" htmlFor="password-reset-confirm">确认新密码</label><input id="password-reset-confirm" className="field-control" type="password" autoComplete="new-password" value={passwordResetConfirmation} onChange={(event) => { setPasswordResetConfirmation(event.target.value); setPasswordResetError(null); }} disabled={busyKey?.endsWith(":password-reset")} /></div>
            <p className="password-reset-policy-help">{REGISTRATION_PASSWORD_RULE_MESSAGE}</p>
            {passwordResetError ? <div className="form-message form-message-error" role="alert"><CircleAlert size={16} />{passwordResetError}</div> : null}
          </div>
          <footer className="editor-footer">
            <button className="secondary-button" type="button" onClick={closePasswordResetDialog} disabled={busyKey?.endsWith(":password-reset")}>取消</button>
            <button className="primary-button" type="button" onClick={() => void submitPasswordReset()} disabled={!passwordResetValue || !passwordResetConfirmation || busyKey !== null}>
              {busyKey?.endsWith(":password-reset") ? <LoaderCircle size={15} /> : <LockKeyhole size={15} />}确认并重置
            </button>
          </footer>
        </section>
      </div> : null}

      {transferDialogOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTransferDialog(); }}>
        <section className="editor-modal account-governance-dialog" role="dialog" aria-modal="true" aria-labelledby="super-admin-transfer-title">
          <header className="editor-header">
            <div><span className="eyebrow">账号权限交接</span><h2 id="super-admin-transfer-title">转让总管理员身份</h2></div>
            <button className="icon-button" type="button" aria-label="关闭转让确认" onClick={closeTransferDialog} disabled={busyKey === "transfer"}><X size={18} /></button>
          </header>
          <div className="editor-body">
            <label className="field-label" htmlFor="super-admin-transfer-target">选择一名启用账号</label>
            <select id="super-admin-transfer-target" className="field-control" value={transferTargetId} onChange={(event) => { setTransferTargetId(event.target.value); setShowFinalTransferConfirmation(false); }}>
              <option value="">请选择受让账号</option>
              {transferCandidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.displayName} · {candidate.username}（{roleLabel(candidate.role)}）</option>)}
            </select>
            {!showFinalTransferConfirmation ? <p>系统不会预选受让人；仅在明确选择并最终确认后提交。</p> : null}
            {showFinalTransferConfirmation && transferTargetId ? (() => {
              const source = currentActor;
              const target = transferCandidates.find((row) => row.id === transferTargetId);
              if (!source || !target || !governance) return <p role="alert">所选账号状态已变化，请关闭窗口并刷新后重试。</p>;
              return <div className="editor-notice" data-testid="transfer-final-summary">
                <p><strong>{source.displayName}</strong>：总管理员 → 其他管理员</p>
                <p><strong>{target.displayName}</strong>：{roleLabel(target.role)} → 总管理员</p>
                <p>原账号保留现有日常业务权限；只失去总管理员专属的账号管理权限。认证身份与员工绑定保持不变。</p>
                <p>这是最终确认，不会自动转让身份。</p>
              </div>;
            })() : null}
          </div>
          <footer className="editor-footer">
            <button className="secondary-button" type="button" onClick={closeTransferDialog} disabled={busyKey === "transfer"}>取消</button>
            {showFinalTransferConfirmation
              ? <button className="primary-button" type="button" onClick={() => void submitTransfer()} disabled={!transferTargetId || busyKey === "transfer"}>确认并提交转让</button>
              : <button className="primary-button" type="button" onClick={() => setShowFinalTransferConfirmation(true)} disabled={!transferTargetId}>继续核对转让内容</button>}
          </footer>
        </section>
      </div> : null}
    </div>
  );
}
