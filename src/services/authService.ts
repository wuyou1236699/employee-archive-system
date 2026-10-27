import { auth } from "./cloudbaseAdapter";
import { localShowcaseEnabled } from "./showcaseMode";
import type { AccountPermission, AuthConfigStatus, ServiceResult, Session } from "../types";

export type AuthStateChangeEvent = "SIGNED_OUT" | "SIGNED_IN" | "INITIAL_SESSION" | "PASSWORD_RECOVERY" | "TOKEN_REFRESHED" | "USER_UPDATED" | "BIND_IDENTITY";
export type AuthStateChangeHandler = (event: AuthStateChangeEvent, session: Session | null) => void;

export interface AuthService {
  readonly config: AuthConfigStatus;
  getSession(): Session | null;
  enterDevelopmentPreview(): ServiceResult<Session>;
  signIn(username: string, password: string): ServiceResult<Session>;
  signOut(): void;
  getSessionAsync(): Promise<Session | null>;
  enterDevelopmentPreviewAsync(): Promise<ServiceResult<Session>>;
  signInAsync(username: string, password: string): Promise<ServiceResult<Session>>;
  signOutAsync(): Promise<void>;
  onAuthStateChange(handler: AuthStateChangeHandler): () => void;
}

function isConfigured(value: string | undefined): boolean { return Boolean(value?.trim()); }

export function resolveAuthConfig(isDevelopment: boolean): AuthConfigStatus {
  const environmentConfigured = isConfigured(import.meta.env.VITE_CLOUDBASE_ENV_ID);
  const publishableKeyConfigured = isConfigured(import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY);
  const region = import.meta.env.VITE_CLOUDBASE_REGION?.trim() || "ap-shanghai";
  const cloudbaseConfigured = environmentConfigured && publishableKeyConfigured;
  if (localShowcaseEnabled) return { mode: "local-preview", environmentConfigured, publishableKeyConfigured, region, message: isDevelopment ? "当前为本地演示，数据仅保存在内存中。" : "当前为离线展示，数据仅保存在内存中。" };
  if (!cloudbaseConfigured) return { mode: "cloudbase-missing", environmentConfigured, publishableKeyConfigured, region, message: "登录服务暂时不可用，请联系管理员完成系统设置。" };
  return { mode: "cloudbase-unwired", environmentConfigured, publishableKeyConfigured, region, message: "登录服务已就绪。" };
}

const SAFE_DISPLAY_NAME = "已登录用户";
const SAFE_LOGIN_ACCOUNT = "已登录账号";
const INTERNAL_ACCOUNT_FALLBACK = "cloudbase-session";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? value as UnknownRecord : null;
}

function asReadableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized === "undefined" || normalized === "null") return null;
  return normalized;
}

export function toUserFacingAuthError(input: unknown, fallback: string): string {
  const raw = input instanceof Error
    ? input.message.trim()
    : typeof input === "string"
      ? input.trim()
      : asReadableString(asRecord(input)?.message) ?? "";
  if (!raw) return fallback;
  if (/(尝试次数|too many|rate.?limit)/i.test(raw)) {
    return "登录尝试次数过多，请稍后再试。";
  }
  if (/(停用|冻结|inactive|disabled)/i.test(raw)) {
    return "该账号已停用，请联系管理员。";
  }
  if (/(未授权|无权限|没有权限|禁止访问|forbidden|unauthori[sz]ed)/i.test(raw)) {
    return "该账号暂未获得系统使用权限，请联系管理员。";
  }
  if (/(账号|密码|凭证|invalid login|invalid credential|wrong password|incorrect password|user not found|not found)/i.test(raw)) {
    return "账号或密码不正确，请检查后重试。";
  }
  return fallback;
}

function asInternalIdentifier(value: unknown): string | null {
  const stringValue = asReadableString(value);
  if (stringValue) return stringValue;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function firstReadableString(...values: unknown[]): string | null {
  for (const value of values) {
    const readableValue = asReadableString(value);
    if (readableValue) return readableValue;
  }
  return null;
}

export function mapCloudBaseSession(cloudSession: unknown): Session | null {
  const session = asRecord(cloudSession);
  const user = asRecord(session?.user);
  if (!user || user.is_anonymous === true || user.is_anonymous === "true") return null;

  // CloudBase Web SDK v3 exposes profile fields in user_metadata. Keep the
  // top-level variants for compatibility with older/profile endpoint shapes.
  const metadata = asRecord(user.user_metadata) ?? asRecord(user.userMetadata) ?? asRecord(user.metadata);
  const accountId = asInternalIdentifier(user.id) ?? asInternalIdentifier(user.uid) ?? asInternalIdentifier(metadata?.uid) ?? INTERNAL_ACCOUNT_FALLBACK;
  const username = firstReadableString(
    metadata?.username,
    user.username,
    user.email,
    metadata?.email,
    user.phone,
    user.phone_number,
    metadata?.phone,
    metadata?.phone_number,
  ) ?? SAFE_LOGIN_ACCOUNT;
  const displayName = firstReadableString(
    metadata?.nickName,
    metadata?.nickname,
    metadata?.displayName,
    metadata?.display_name,
    metadata?.name,
    user.nickName,
    user.nickname,
    user.displayName,
    user.display_name,
    user.name,
    metadata?.username,
    user.username,
    user.email,
    metadata?.email,
    user.phone,
    user.phone_number,
    metadata?.phone,
    metadata?.phone_number,
  ) ?? SAFE_DISPLAY_NAME;

  return {
    accountId,
    username,
    displayName,
    mode: "cloudbase",
    // Authorization is refreshed from the server-side employee_admin_accounts
    // projection after sign-in. These safe defaults prevent a client session
    // claim from granting access while that refresh is pending.
    role: "user",
    permissions: [] as AccountPermission[],
    status: "active",
  };
}

export class LocalPreviewAuthService implements AuthService {
  readonly config: AuthConfigStatus;
  private session: Session | null = null;
  private readonly handlers = new Set<AuthStateChangeHandler>();
  constructor(config: AuthConfigStatus) { this.config = config; }
  getSession(): Session | null { return this.session; }
  enterDevelopmentPreview(): ServiceResult<Session> {
    this.session = {
      accountId: "preview-admin",
      username: "development-preview",
      displayName: "体验模式管理员",
      mode: "local-preview",
      role: "super_admin",
      permissions: ["employee.write", "history.write", "attachment.read", "attachment.write", "audit.read", "monthly_assessment_edit", "quarterly.manage"],
      status: "active",
    };
    this.emit("SIGNED_IN");
    return { ok: true, data: this.session };
  }
  signIn(): ServiceResult<Session> { return { ok: false, message: "当前为体验模式，请使用页面上的体验模式入口登录。" }; }
  signOut(): void { this.session = null; this.emit("SIGNED_OUT"); }
  async getSessionAsync(): Promise<Session | null> { return this.getSession(); }
  async enterDevelopmentPreviewAsync(): Promise<ServiceResult<Session>> { return this.enterDevelopmentPreview(); }
  async signInAsync(): Promise<ServiceResult<Session>> { return this.signIn(); }
  async signOutAsync(): Promise<void> { this.signOut(); }
  onAuthStateChange(handler: AuthStateChangeHandler): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  private emit(event: AuthStateChangeEvent): void { for (const handler of this.handlers) handler(event, this.session); }
}

export class CloudBaseAuthService implements AuthService {
  readonly config: AuthConfigStatus;
  private session: Session | null = null;
  private readonly handlers = new Set<AuthStateChangeHandler>();
  private readonly unsubscribeCloudListener: () => void = () => undefined;
  constructor(config: AuthConfigStatus) {
    this.config = config;
    if (!auth) return;
    const subscription = auth.onAuthStateChange((event, cloudSession) => { this.session = mapCloudBaseSession(cloudSession); for (const handler of this.handlers) handler(event, this.session); });
    this.unsubscribeCloudListener = subscription.data.subscription.unsubscribe;
  }
  getSession(): Session | null { return this.session; }
  enterDevelopmentPreview(): ServiceResult<Session> { return { ok: false, message: "当前已使用正式登录，不能进入体验模式。" }; }
  signIn(): ServiceResult<Session> { return { ok: false, message: "请使用页面上的登录按钮。" }; }
  signOut(): void { this.session = null; }
  async getSessionAsync(): Promise<Session | null> { if (!auth) return null; const result = await auth.getSession(); if (result.error) throw new Error(toUserFacingAuthError(result.error, "登录状态暂时无法读取，请刷新后重试。")); this.session = mapCloudBaseSession(result.data.session); return this.session; }
  async enterDevelopmentPreviewAsync(): Promise<ServiceResult<Session>> { return this.enterDevelopmentPreview(); }
  async signInAsync(username: string, password: string): Promise<ServiceResult<Session>> { if (!auth) return { ok: false, message: "登录服务暂时无法使用，请稍后重试。" }; const result = await auth.signInWithPassword({ username, password }); if (result.error) return { ok: false, message: toUserFacingAuthError(result.error, "登录失败，请检查账号和密码后重试。") }; const nextSession = mapCloudBaseSession(result.data.session); if (!nextSession) return { ok: false, message: "登录状态无效，请重新登录。" }; this.session = nextSession; return { ok: true, data: nextSession }; }
  async signOutAsync(): Promise<void> { if (!auth) return; await auth.signOut(); this.signOut(); }
  onAuthStateChange(handler: AuthStateChangeHandler): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  dispose(): void { this.unsubscribeCloudListener(); this.handlers.clear(); }
}

export class UnconfiguredCloudBaseAuthService extends CloudBaseAuthService {}

export function createAuthService(): AuthService { const config = resolveAuthConfig(import.meta.env.DEV); if (config.mode === "local-preview") return new LocalPreviewAuthService(config); if (config.mode === "cloudbase-missing") return new UnconfiguredCloudBaseAuthService(config); return new CloudBaseAuthService(config); }
