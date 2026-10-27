// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSettingsPage } from "./AdminSettingsPage";
import { readPendingSuperAdminTransfer } from "../services/superAdminTransferRecovery";
import type { AccountService } from "../services/accountService";
import type { AccountSummary, SuperAdminGovernanceSummary, SuperAdminTransferResult } from "../types";
import { PERMISSION_GROUPS } from "../utils/permissionGroups";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: "account-001",
    username: "archive-editor",
    displayName: "档案编辑员",
    role: "admin",
    permissions: [],
    status: "active",
    createdAt: null,
    updatedAt: null,
    permissionVersion: 1,
    ...overrides,
  };
}

const DEFAULT_GOVERNANCE: SuperAdminGovernanceSummary = {
  state: "ready",
  activeCount: 1,
  limit: 5,
  revision: 7,
};

function serviceFor(rows: AccountSummary[], governance: SuperAdminGovernanceSummary = DEFAULT_GOVERNANCE): AccountService {
  return {
    register: vi.fn(),
    selfResetPassword: vi.fn(),
    listAccounts: vi.fn().mockResolvedValue({ items: rows, total: rows.length, governance }),
    initializeSuperAdminGovernance: vi.fn().mockResolvedValue({ ok: false, message: "not expected", outcome: "definite" }),
    upgradeSuperAdminGovernanceLimit: vi.fn().mockResolvedValue({ ok: false, message: "not expected", outcome: "definite" }),
    updateRole: vi.fn().mockResolvedValue({ ok: true, data: rows[0] }),
    grantPermissions: vi.fn().mockResolvedValue({ ok: true, data: account({ permissions: [...PERMISSION_GROUPS[0].permissions] }) }),
    revokePermissions: vi.fn().mockResolvedValue({ ok: true, data: account() }),
    disableAccount: vi.fn().mockResolvedValue({ ok: true, data: rows[0] }),
    restoreAccount: vi.fn().mockResolvedValue({ ok: true, data: rows[0] }),
    resetPassword: vi.fn().mockResolvedValue({ ok: true, data: { reset: true } }),
    bindEmployee: vi.fn().mockResolvedValue({ ok: true, data: rows[0] }),
    transferSuperAdmin: vi.fn().mockResolvedValue({ ok: false, message: "not expected", outcome: "definite" }),
  };
}

interface RenderOptions {
  actorAccountId?: string;
  actorAccountUsername?: string;
  onTransferComplete?: () => Promise<void>;
  showRecoveryNotice?: boolean;
}

async function renderPage(service: AccountService, options: RenderOptions = {}): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AdminSettingsPage
        accounts={service}
        actorAccountId={options.actorAccountId ?? "current-super-admin"}
        actorAccountUsername={options.actorAccountUsername}
        onTransferComplete={options.onTransferComplete ?? (async () => undefined)}
        showRecoveryNotice={options.showRecoveryNotice}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

async function clickButton(container: HTMLDivElement, name: string): Promise<void> {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.textContent?.includes(name));
  if (!button) throw new Error("Button not found: " + name);
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function selectValue(select: HTMLSelectElement | null, value: string): Promise<void> {
  if (!select) throw new Error("Select element not found.");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function changeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    changeInputValue(input, value);
    await Promise.resolve();
  });
}

function successfulTransfer(source: AccountSummary, target: AccountSummary): { ok: true; data: SuperAdminTransferResult } {
  return {
    ok: true,
    data: {
      sourceAccount: source,
      targetAccount: target,
      governance: { ...DEFAULT_GOVERNANCE, activeCount: 1, revision: 8 },
    },
  };
}

describe("AdminSettingsPage permission groups", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.stubEnv("VITE_ACCOUNT_GOVERNANCE_WRITES_ENABLED", "true");
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the signed-in username to identify the actor and initializes governance through the app service", async () => {
    const actor = account({ id: "database-account-id", username: "root-one", role: "super_admin", displayName: "当前总管理员" });
    const editor = account({ id: "editor-id", username: "editor-one", role: "admin" });
    const initializedGovernance: SuperAdminGovernanceSummary = { state: "ready", activeCount: 1, limit: 5, revision: 1 };
    const service = serviceFor([actor, editor], { state: "not_initialized", activeCount: 1, limit: 5, revision: null });
    vi.stubEnv("VITE_ACCOUNT_GOVERNANCE_WRITES_ENABLED", "true");
    vi.mocked(service.listAccounts)
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: { state: "not_initialized", activeCount: 1, limit: 5, revision: null } })
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: initializedGovernance });
    vi.mocked(service.initializeSuperAdminGovernance!).mockResolvedValue({ ok: true, data: initializedGovernance });

    ({ container, root } = await renderPage(service, { actorAccountId: "cloudbase-auth-uid", actorAccountUsername: "ROOT-ONE" }));

    expect(service.initializeSuperAdminGovernance).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("登记当前总管理员名单");
    expect(container.textContent).toContain("当前总管理员");
    const editorPermission = container.querySelector<HTMLInputElement>("input[aria-label='切换editor-one的员工档案编辑权限组']");
    expect(editorPermission?.disabled).toBe(false);
    const ownTransferButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("转让总管理员身份"));
    expect(ownTransferButton).toBeDefined();
    expect(ownTransferButton?.disabled).toBe(false);
  });

  it("accepts a concurrently initialized roster after this page receives an initialization conflict", async () => {
    const actor = account({ id: "current-super-admin", username: "root-one", role: "super_admin", displayName: "当前总管理员" });
    const editor = account({ id: "editor-id", username: "editor-one", role: "admin" });
    const notInitialized: SuperAdminGovernanceSummary = { state: "not_initialized", activeCount: 1, limit: 5, revision: null };
    const initialized: SuperAdminGovernanceSummary = { state: "ready", activeCount: 1, limit: 5, revision: 1 };
    const service = serviceFor([actor, editor], notInitialized);
    vi.mocked(service.listAccounts)
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: notInitialized })
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: initialized });
    vi.mocked(service.initializeSuperAdminGovernance!).mockResolvedValue({ ok: false, message: "名单已初始化", outcome: "definite" });

    ({ container, root } = await renderPage(service, { actorAccountId: actor.id }));

    expect(service.initializeSuperAdminGovernance).toHaveBeenCalledTimes(1);
    expect(service.listAccounts).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("账号权限状态暂时无法确认");
    expect(container.querySelector<HTMLInputElement>("input[aria-label='切换editor-one的员工档案编辑权限组']")?.disabled).toBe(false);
  });

  it("re-reads governance after an initialization response is lost", async () => {
    const actor = account({ id: "current-super-admin", username: "root-one", role: "super_admin", displayName: "当前总管理员" });
    const editor = account({ id: "editor-id", username: "editor-one", role: "admin" });
    const notInitialized: SuperAdminGovernanceSummary = { state: "not_initialized", activeCount: 1, limit: 5, revision: null };
    const initialized: SuperAdminGovernanceSummary = { state: "ready", activeCount: 1, limit: 5, revision: 1 };
    const service = serviceFor([actor, editor], notInitialized);
    vi.mocked(service.listAccounts)
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: notInitialized })
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: initialized });
    vi.mocked(service.initializeSuperAdminGovernance!).mockRejectedValue(new Error("response lost after commit"));

    ({ container, root } = await renderPage(service, { actorAccountId: actor.id }));

    expect(service.initializeSuperAdminGovernance).toHaveBeenCalledTimes(1);
    expect(service.listAccounts).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("账号权限状态暂时无法确认");
    expect(container.querySelector<HTMLInputElement>("input[aria-label='切换editor-one的员工档案编辑权限组']")?.disabled).toBe(false);
  });

  it("keeps permission controls unavailable when initialization fails and the roster stays unready", async () => {
    const actor = account({ id: "current-super-admin", username: "root-one", role: "super_admin", displayName: "当前总管理员" });
    const editor = account({ id: "editor-id", username: "editor-one", role: "admin" });
    const notInitialized: SuperAdminGovernanceSummary = { state: "not_initialized", activeCount: 1, limit: 5, revision: null };
    const service = serviceFor([actor, editor], notInitialized);
    vi.mocked(service.listAccounts)
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: notInitialized })
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: notInitialized });
    vi.mocked(service.initializeSuperAdminGovernance!).mockResolvedValue({ ok: false, message: "初始化未完成", outcome: "definite" });

    ({ container, root } = await renderPage(service, { actorAccountId: actor.id }));

    expect(service.listAccounts).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("账号权限状态暂时无法确认，请刷新列表后重试。");
    expect(container.querySelector<HTMLInputElement>("input[aria-label='切换editor-one的员工档案编辑权限组']")?.disabled).toBe(true);
  });

  it("silently upgrades the legacy quota before enabling account changes", async () => {
    const actor = account({ id: "current-super", username: "root-one", role: "super_admin", displayName: "当前总管理员" });
    const editor = account({ id: "editor-id", username: "editor-one", role: "admin" });
    const migratedGovernance: SuperAdminGovernanceSummary = { state: "ready", activeCount: 2, limit: 5, revision: 5 };
    const service = serviceFor([actor, editor], { state: "ready", activeCount: 2, limit: 3, revision: 4 });
    vi.stubEnv("VITE_ACCOUNT_GOVERNANCE_WRITES_ENABLED", "true");
    vi.mocked(service.listAccounts)
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: { state: "ready", activeCount: 2, limit: 3, revision: 4 } })
      .mockResolvedValueOnce({ items: [actor, editor], total: 2, governance: migratedGovernance });
    vi.mocked(service.upgradeSuperAdminGovernanceLimit!).mockResolvedValue({ ok: true, data: migratedGovernance });

    ({ container, root } = await renderPage(service, { actorAccountId: "current-super" }));

    expect(service.upgradeSuperAdminGovernanceLimit).toHaveBeenCalledTimes(1);
    expect(service.upgradeSuperAdminGovernanceLimit).toHaveBeenCalledWith({
      operationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      expectedGovernanceRevision: 4,
    });
    expect(container.textContent).not.toContain("名额升级");
    expect(container.querySelector<HTMLInputElement>("input[aria-label='切换editor-one的员工档案编辑权限组']")?.disabled).toBe(false);
  });

  it("grants the complete employee archive group in one request", async () => {
    const service = serviceFor([account()]);
    ({ container, root } = await renderPage(service));

    expect(container.textContent).toContain("员工档案编辑");
    expect(container.textContent).toContain("月度考核编辑");
    expect(container.textContent).not.toContain("employee.write");
    const checkbox = container.querySelector<HTMLInputElement>("input[aria-label='切换archive-editor的员工档案编辑权限组']");
    expect(checkbox?.checked).toBe(false);

    await act(async () => {
      checkbox?.click();
      await Promise.resolve();
    });

    const grantInput = vi.mocked(service.grantPermissions).mock.calls[0]?.[0];
    expect(grantInput).toMatchObject({
      accountId: "account-001",
      permissions: ["employee.write", "history.write", "attachment.read", "attachment.write"],
      expectedGovernanceRevision: 7,
    });
    expect(grantInput?.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(service.revokePermissions).not.toHaveBeenCalled();
  });

  it("shows partial authorization instead of treating it as fully enabled", async () => {
    const service = serviceFor([account({ permissions: ["employee.write"] })]);
    ({ container, root } = await renderPage(service));

    expect(container.textContent).toContain("部分授权");
    expect(container.textContent).toContain("补齐权限");
    expect(container.textContent).not.toContain("employee.write");
  });

  it("locks both groups for a super administrator and shows the system status", async () => {
    const service = serviceFor([account({ role: "super_admin" })]);
    ({ container, root } = await renderPage(service));

    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes.every((checkbox) => checkbox.checked && checkbox.disabled)).toBe(true);
    expect(container.textContent).toContain("总管理员自动拥有");
    expect(container.textContent).not.toContain("audit.read");
  });

  it("lets an active super administrator explicitly reset another active account password", async () => {
    const actor = account({ id: "actor", username: "root-one", role: "super_admin", displayName: "当前总管理员" });
    const target = account({ id: "stable-target-id", username: "target-one", displayName: "目标账号", role: "admin" });
    const service = serviceFor([actor, target], { ...DEFAULT_GOVERNANCE, revision: 31 });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    ({ container, root } = await renderPage(service, { actorAccountId: "actor" }));

    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.textContent?.includes("重置密码"))).toHaveLength(1);
    await clickButton(container, "重置密码");
    expect(container.querySelector("[role='dialog']")?.textContent).toContain("系统无法查询原密码");
    const newPassword = container.querySelector<HTMLInputElement>("#password-reset-new");
    const confirmation = container.querySelector<HTMLInputElement>("#password-reset-confirm");
    expect(newPassword?.type).toBe("password");
    expect(confirmation?.type).toBe("password");

    await typeInput(newPassword as HTMLInputElement, "ResetOnlyPass1!");
    await typeInput(confirmation as HTMLInputElement, "ResetOnlyPass2!");
    await clickButton(container, "确认并重置");
    expect(container.textContent).toContain("两次输入的密码不一致");
    expect(service.resetPassword).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    await typeInput(confirmation as HTMLInputElement, "ResetOnlyPass1!");
    await clickButton(container, "确认并重置");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("target-one"));
    expect(service.resetPassword).toHaveBeenCalledWith({
      accountId: "stable-target-id",
      newPassword: "ResetOnlyPass1!",
      expectedGovernanceRevision: 31,
    });
    expect(container.textContent).toContain("的密码已重置");
    expect(container.querySelector("#password-reset-new")).toBeNull();
  });

  it("does not offer password reset to a non-super administrator or for its own account", async () => {
    const actor = account({ id: "actor", role: "admin" });
    const target = account({ id: "target", username: "target-two" });
    ({ container, root } = await renderPage(serviceFor([actor, target]), { actorAccountId: "actor" }));
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some((button) => button.textContent?.includes("重置密码"))).toBe(false);

    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    const superActor = account({ id: "actor", role: "super_admin" });
    const service = serviceFor([superActor, target]);
    ({ container, root } = await renderPage(service, { actorAccountId: "actor" }));
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.textContent?.includes("重置密码"))).toHaveLength(1);
    const selfCard = Array.from(container.querySelectorAll<HTMLElement>(".account-settings-card")).find((card) => card.textContent?.includes(superActor.username));
    expect(Array.from(selfCard?.querySelectorAll<HTMLButtonElement>("button") ?? []).some((button) => button.textContent?.includes("重置密码"))).toBe(false);
    expect(service.resetPassword).not.toHaveBeenCalled();
  });

  it("clears password fields when the reset dialog is closed", async () => {
    const actor = account({ id: "actor", role: "super_admin" });
    const target = account({ id: "target", username: "clear-target" });
    ({ container, root } = await renderPage(serviceFor([actor, target]), { actorAccountId: "actor" }));
    await clickButton(container, "重置密码");
    await typeInput(container.querySelector<HTMLInputElement>("#password-reset-new") as HTMLInputElement, "ResetOnlyPass1!");
    await clickButton(container, "取消");
    expect(container.querySelector("#password-reset-new")).toBeNull();
    await clickButton(container, "重置密码");
    expect(container.querySelector<HTMLInputElement>("#password-reset-new")?.value).toBe("");
    expect(container.querySelector<HTMLInputElement>("#password-reset-confirm")?.value).toBe("");
  });

  it("does not expose the retired employee invitation controls", async () => {
    const service = serviceFor([account()]);
    ({ container, root } = await renderPage(service));

    expect(container.textContent).not.toContain("员工账号邀请码");
    expect(container.textContent).not.toContain("生成一次性邀请码");
    expect(container.textContent).not.toContain("已发出的邀请码");
  });

  it("shows the server governance headcount and disables writes when its state cannot be verified", async () => {
    const service = serviceFor(
      [account({ id: "actor", role: "super_admin", displayName: "当前总管理员" }), account({ id: "pending", username: "pending", status: "pending_activation" })],
      { state: "drift", activeCount: 2, limit: 5, revision: 7 },
    );
    ({ container, root } = await renderPage(service, { actorAccountId: "actor" }));

    expect(container.textContent).toContain("待激活");
    expect(container.querySelector<HTMLSelectElement>("select[aria-label='调整pending的账号角色']")?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("input[aria-label='切换pending的员工档案编辑权限组']")?.disabled).toBe(true);
  });

  it("blocks count-increasing actions at quota and over limit", async () => {
    const fullService = serviceFor(
      [
        account({ id: "actor", role: "super_admin" }),
        account({ id: "quota-super-2", role: "super_admin" }),
        account({ id: "quota-super-3", role: "super_admin" }),
        account({ id: "quota-super-4", role: "super_admin" }),
        account({ id: "quota-super-5", role: "super_admin" }),
        account({ id: "editor" }),
        account({ id: "disabled-super", role: "super_admin", status: "disabled" }),
      ],
      { state: "ready", activeCount: 5, limit: 5, revision: 12 },
    );
    ({ container, root } = await renderPage(fullService, { actorAccountId: "actor" }));

    const editorSelect = container.querySelector<HTMLSelectElement>("select[aria-label='调整archive-editor的账号角色']");
    const promotionOption = Array.from(editorSelect?.options ?? []).find((option) => option.value === "super_admin");
    expect(promotionOption?.disabled).toBe(true);
    const ordinaryDisable = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("停用账号"));
    const superRestore = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("恢复账号"));
    expect(ordinaryDisable?.disabled).toBe(false);
    expect(superRestore?.disabled).toBe(true);

    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;

    const overLimitService = serviceFor(
      [
        account({ id: "actor", role: "super_admin", username: "root-one" }),
        account({ id: "other-super", role: "super_admin", username: "root-two" }),
        account({ id: "over-limit-super-3", role: "super_admin" }),
        account({ id: "over-limit-super-4", role: "super_admin" }),
        account({ id: "over-limit-super-5", role: "super_admin" }),
        account({ id: "over-limit-super-6", role: "super_admin" }),
        account({ id: "ordinary" }),
        account({ id: "disabled-super", role: "super_admin", status: "disabled" }),
      ],
      { state: "over_limit", activeCount: 6, limit: 5, revision: 13 },
    );
    ({ container, root } = await renderPage(overLimitService, { actorAccountId: "actor" }));
    const demoteOther = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("降为其他管理员"));
    const disabledSuperRestore = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("恢复账号"));
    expect(demoteOther?.disabled).toBe(false);
    expect(disabledSuperRestore?.disabled).toBe(true);
  });

  it("requires an explicit promotion confirmation and sends a fresh UUID with the server revision", async () => {
    const service = serviceFor([account({ id: "target" })], { ...DEFAULT_GOVERNANCE, activeCount: 2, revision: 19 });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    ({ container, root } = await renderPage(service));

    const select = container.querySelector<HTMLSelectElement>("select[aria-label='调整archive-editor的账号角色']");
    await selectValue(select, "super_admin");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("提升为总管理员"));
    expect(service.updateRole).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await selectValue(select, "super_admin");
    const input = vi.mocked(service.updateRole).mock.calls[0]?.[0];
    expect(input).toMatchObject({ accountId: "target", role: "super_admin", expectedGovernanceRevision: 19 });
    expect(input?.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("requires both transfer confirmations and retries the exact saved payload after a refresh", async () => {
    const actor = account({ id: "actor", username: "source-admin", displayName: "发起总管理员", role: "super_admin" });
    const target = account({ id: "target", username: "receiver", displayName: "受让管理员", role: "admin", permissions: ["employee.write"] });
    const service = serviceFor([actor, target], { ...DEFAULT_GOVERNANCE, activeCount: 2, revision: 23 });
    const onTransferComplete = vi.fn().mockResolvedValue(undefined);
    vi.mocked(service.transferSuperAdmin)
      .mockResolvedValueOnce({ ok: false, message: "连接中断", outcome: "uncertain" })
      .mockResolvedValueOnce(successfulTransfer(account({ ...actor, role: "admin" }), account({ ...target, role: "super_admin" })));
    ({ container, root } = await renderPage(service, { actorAccountId: "actor", onTransferComplete }));

    await clickButton(container, "转让总管理员身份");
    const targetSelect = container.querySelector<HTMLSelectElement>("#super-admin-transfer-target");
    expect(targetSelect?.value).toBe("");
    await selectValue(targetSelect, "target");
    await clickButton(container, "继续核对转让内容");
    const confirmation = container.querySelector<HTMLElement>("[data-testid='transfer-final-summary']");
    expect(confirmation?.textContent).toContain("发起总管理员：总管理员 → 其他管理员");
    expect(confirmation?.textContent).toContain("受让管理员：其他管理员 → 总管理员");
    expect(confirmation?.textContent).toContain("原账号保留现有日常业务权限");
    expect(service.transferSuperAdmin).not.toHaveBeenCalled();

    await clickButton(container, "确认并提交转让");
    const originalPayload = vi.mocked(service.transferSuperAdmin).mock.calls[0]?.[0];
    expect(originalPayload).toMatchObject({ targetAccountId: "target", expectedGovernanceRevision: 23 });
    expect(originalPayload?.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(readPendingSuperAdminTransfer("actor")).toEqual(originalPayload);
    expect(container.textContent).toContain("按原请求核对/重试");

    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    ({ container, root } = await renderPage(service, { actorAccountId: "actor", onTransferComplete }));
    expect(container.textContent).toContain("此前确认的转让结果待核对");
    await clickButton(container, "按原请求核对/重试");
    const retriedPayload = vi.mocked(service.transferSuperAdmin).mock.calls[1]?.[0];
    expect(retriedPayload).toEqual(originalPayload);
    expect(onTransferComplete).toHaveBeenCalledTimes(1);
    expect(readPendingSuperAdminTransfer("actor")).toBeNull();
  });

  it("clears a definitely failed transfer key so a later user-confirmed attempt gets a new UUID", async () => {
    const actor = account({ id: "actor", role: "super_admin" });
    const target = account({ id: "target", role: "admin" });
    const service = serviceFor([actor, target]);
    vi.mocked(service.transferSuperAdmin).mockResolvedValue({ ok: false, message: "版本冲突", code: "SUPER_ADMIN_REVISION_CONFLICT", outcome: "definite" });
    ({ container, root } = await renderPage(service, { actorAccountId: "actor" }));

    await clickButton(container, "转让总管理员身份");
    await selectValue(container.querySelector<HTMLSelectElement>("#super-admin-transfer-target"), "target");
    await clickButton(container, "继续核对转让内容");
    await clickButton(container, "确认并提交转让");
    const failedId = vi.mocked(service.transferSuperAdmin).mock.calls[0]?.[0].operationId;
    expect(readPendingSuperAdminTransfer("actor")).toBeNull();
    expect(container.textContent).toContain("版本冲突");

    await clickButton(container, "转让总管理员身份");
    await selectValue(container.querySelector<HTMLSelectElement>("#super-admin-transfer-target"), "target");
    await clickButton(container, "继续核对转让内容");
    await clickButton(container, "确认并提交转让");
    const nextId = vi.mocked(service.transferSuperAdmin).mock.calls[1]?.[0].operationId;
    expect(nextId).not.toBe(failedId);
  });
});
