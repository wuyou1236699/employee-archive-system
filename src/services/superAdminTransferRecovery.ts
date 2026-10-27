import type { SuperAdminTransferInput } from "../types";

const STORAGE_PREFIX = "employeeArchive.pendingSuperAdminTransfer.v1:";
export const PENDING_SUPER_ADMIN_TRANSFER_CHANGED = "employeeArchive:pendingSuperAdminTransferChanged";
export const ACCOUNT_GOVERNANCE_REFRESH_REQUESTED = "employeeArchive:accountGovernanceRefreshRequested";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storageKey(accountId: string): string {
  return `${STORAGE_PREFIX}${accountId}`;
}

function announce(eventName: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(eventName));
}

function isTransferInput(value: unknown): value is SuperAdminTransferInput {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.targetAccountId === "string"
    && record.targetAccountId.trim().length > 0
    && typeof record.operationId === "string"
    && UUID_PATTERN.test(record.operationId)
    && Number.isInteger(record.expectedGovernanceRevision)
    && (record.expectedGovernanceRevision as number) > 0
    && Object.keys(record).sort().join(",") === "expectedGovernanceRevision,operationId,targetAccountId";
}

export function createGovernanceOperationId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error("当前浏览器无法生成安全操作编号，请更新浏览器后重试。");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readPendingSuperAdminTransfer(accountId: string): SuperAdminTransferInput | null {
  if (!accountId || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(accountId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isTransferInput(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePendingSuperAdminTransfer(accountId: string, input: SuperAdminTransferInput): boolean {
  if (!accountId || typeof window === "undefined" || !isTransferInput(input)) return false;
  try {
    window.sessionStorage.setItem(storageKey(accountId), JSON.stringify(input));
    announce(PENDING_SUPER_ADMIN_TRANSFER_CHANGED);
    return true;
  } catch {
    return false;
  }
}

export function clearPendingSuperAdminTransfer(accountId: string): void {
  if (!accountId || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(accountId));
  } finally {
    announce(PENDING_SUPER_ADMIN_TRANSFER_CHANGED);
  }
}

export function requestAccountGovernanceRefresh(): void {
  announce(ACCOUNT_GOVERNANCE_REFRESH_REQUESTED);
}
