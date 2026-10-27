import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AccountService } from "../services/accountService";
import {
  clearPendingSuperAdminTransfer,
  PENDING_SUPER_ADMIN_TRANSFER_CHANGED,
  readPendingSuperAdminTransfer,
  requestAccountGovernanceRefresh,
} from "../services/superAdminTransferRecovery";
import type { SuperAdminTransferInput } from "../types";

interface PendingSuperAdminTransferNoticeProps {
  accountId: string;
  accounts: AccountService;
  onTransferComplete: () => Promise<void>;
}

export function PendingSuperAdminTransferNotice({
  accountId,
  accounts,
  onTransferComplete,
}: PendingSuperAdminTransferNoticeProps) {
  const [pending, setPending] = useState<SuperAdminTransferInput | null>(() => readPendingSuperAdminTransfer(accountId));
  const [isRetrying, setIsRetrying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const syncPending = () => setPending(readPendingSuperAdminTransfer(accountId));
    window.addEventListener(PENDING_SUPER_ADMIN_TRANSFER_CHANGED, syncPending);
    window.addEventListener("storage", syncPending);
    syncPending();
    return () => {
      window.removeEventListener(PENDING_SUPER_ADMIN_TRANSFER_CHANGED, syncPending);
      window.removeEventListener("storage", syncPending);
    };
  }, [accountId]);

  async function retrySameTransfer(): Promise<void> {
    if (!pending || isRetrying) return;
    setIsRetrying(true);
    setMessage(null);
    try {
      const result = await accounts.transferSuperAdmin(pending);
      if (result.ok) {
        setMessage("转让结果已确认。正在刷新当前账号权限。");
        try {
          await onTransferComplete();
        } catch {
          setMessage("服务端已确认转让，但当前会话权限刷新失败。原请求编号已保留，可再次按同一请求核对。");
          return;
        }
        clearPendingSuperAdminTransfer(accountId);
        setPending(null);
        return;
      }
      if (result.outcome === "uncertain") {
        setMessage(`${result.message} 原请求已保留；请稍后仅按同一请求再次核对。`);
        return;
      }
      clearPendingSuperAdminTransfer(accountId);
      setPending(null);
      setMessage(`${result.message} 原请求已明确失败，已清除重试记录。`);
      try {
        await accounts.listAccounts();
        requestAccountGovernanceRefresh();
      } catch {
        // A transferred source may no longer have permission to read the account list.
      }
    } finally {
      setIsRetrying(false);
    }
  }

  if (!pending && !message) return null;
  return (
    <section className="form-message form-message-error account-transfer-recovery" aria-live="polite">
      <div>
        <strong>{pending ? "此前确认的转让结果待核对" : "转让结果"}</strong>
        <span>{pending
          ? "为避免重复转让，此处只会重试此前保存的相同请求编号、受让人和名额版本。"
          : message}</span>
        {pending && message ? <small>{message}</small> : null}
      </div>
      {pending ? <button className="secondary-button compact-button" type="button" onClick={() => void retrySameTransfer()} disabled={isRetrying}>
        {isRetrying ? <LoaderCircle size={15} /> : <RefreshCw size={15} />}
        {isRetrying ? "正在核对" : "按原请求核对/重试"}
      </button> : null}
      {pending ? <CircleAlert size={17} aria-hidden="true" /> : null}
    </section>
  );
}
