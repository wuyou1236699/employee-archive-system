// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountService } from "./services/accountService";
import type { AccountProfile, Session } from "./types";
import { savePendingSuperAdminTransfer } from "./services/superAdminTransferRecovery";
import App from "./App";

const appMocks = vi.hoisted(() => ({ services: undefined as unknown }));

vi.mock("./services/serviceFactory", () => ({
  createAppServices: () => appMocks.services,
}));

vi.mock("./components/AppShell", () => ({
  AppShell: ({ page, session, children }: { page: string; session: Session; children: ReactNode }) => (
    <main data-testid="app-shell" data-page={page} data-role={session.role} data-permissions={session.permissions.join("|")}>{children}</main>
  ),
}));

vi.mock("./pages/LoginPage", () => ({ LoginPage: () => <div data-testid="login-page">login</div> }));
vi.mock("./pages/EmployeesPage", () => ({ EmployeesPage: () => <div>employees</div> }));
vi.mock("./pages/AuditPage", () => ({ AuditPage: () => <div>audit</div> }));
vi.mock("./pages/MonthlyAssessmentsPage", () => ({ MonthlyAssessmentsPage: () => <div>monthly</div> }));
vi.mock("./pages/QuarterlyAssessmentsPage", () => ({ QuarterlyAssessmentsPage: () => <div>quarterly</div> }));
vi.mock("./pages/AdminSettingsPage", () => ({ AdminSettingsPage: () => <div>accounts</div> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actorSession: Session = {
  accountId: "actor-account",
  username: "source-admin",
  displayName: "发起总管理员",
  mode: "cloudbase",
  role: "super_admin",
  permissions: [],
  status: "active",
};

const currentProfile: AccountProfile = {
  accountId: "actor-account",
  username: "source-admin",
  displayName: "发起总管理员",
  scope: "all",
  role: "admin",
  permissions: ["employee.write", "history.write"],
  status: "active",
};

function accountSummary(id: string, role: "admin" | "super_admin") {
  return {
    id,
    username: id,
    displayName: id,
    role,
    permissions: role === "admin" ? ["employee.write" as const] : [],
    status: "active" as const,
    createdAt: null,
    updatedAt: null,
    permissionVersion: 2,
  };
}

function appServices(profileReader: ReturnType<typeof vi.fn>) {
  const accounts: AccountService = {
    register: vi.fn(),
    selfResetPassword: vi.fn(),
    listAccounts: vi.fn(),
    updateRole: vi.fn(),
    grantPermissions: vi.fn(),
    revokePermissions: vi.fn(),
    disableAccount: vi.fn(),
    restoreAccount: vi.fn(),
    resetPassword: vi.fn(),
    bindEmployee: vi.fn(),
    transferSuperAdmin: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        sourceAccount: accountSummary("actor-account", "admin"),
        targetAccount: accountSummary("target-account", "super_admin"),
        governance: { state: "ready", activeCount: 1, limit: 5, revision: 8 },
      },
    }),
  };
  const auth = {
    config: { mode: "cloudbase-missing", environmentConfigured: true, publishableKeyConfigured: true, region: "test", message: "" },
    onAuthStateChange: vi.fn(() => () => undefined),
    getSessionAsync: vi.fn().mockResolvedValue(actorSession),
    signOutAsync: vi.fn().mockResolvedValue(undefined),
  };
  const data = {
    mode: "cloudbase",
    getCurrentAccount: profileReader,
    recordAudit: vi.fn(),
  };
  return { auth, data, accounts, quarterly: {} };
}

async function renderApp(): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

describe("App transfer recovery session refresh", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.location.hash = "#/accounts";
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("re-reads the current account after same-key recovery and navigates with refreshed permissions", async () => {
    const profileReader = vi.fn().mockResolvedValue(currentProfile);
    const services = appServices(profileReader);
    appMocks.services = services;
    const payload = { targetAccountId: "target-account", operationId: "4a80b6bf-a17a-4fa3-9f4b-4a80b6bf0001", expectedGovernanceRevision: 8 };
    expect(savePendingSuperAdminTransfer("actor-account", payload)).toBe(true);
    ({ container, root } = await renderApp());

    expect(container.textContent).toContain("此前确认的转让结果待核对");
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("按原请求核对/重试"));
    expect(retry).toBeTruthy();
    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(services.accounts.transferSuperAdmin).toHaveBeenCalledWith(payload);
    expect(profileReader).toHaveBeenCalledTimes(2);
    const shell = container.querySelector<HTMLElement>("[data-testid='app-shell']");
    expect(shell?.dataset.role).toBe("admin");
    expect(shell?.dataset.permissions).toBe("employee.write|history.write");
    expect(shell?.dataset.page).toBe("employees");
    expect(window.location.hash).toBe("#/employees");
  });

  it("retains the original key when the transfer is confirmed but session permission refresh fails", async () => {
    const profileReader = vi.fn()
      .mockResolvedValueOnce(currentProfile)
      .mockRejectedValueOnce(new Error("session read unavailable"));
    const services = appServices(profileReader);
    appMocks.services = services;
    const payload = { targetAccountId: "target-account", operationId: "c135af2b-2a9e-47a4-b025-0f2be1480002", expectedGovernanceRevision: 9 };
    savePendingSuperAdminTransfer("actor-account", payload);
    ({ container, root } = await renderApp());

    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("按原请求核对/重试"));
    await act(async () => {
      retry?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(services.accounts.transferSuperAdmin).toHaveBeenCalledWith(payload);
    expect(window.sessionStorage.getItem("employeeArchive.pendingSuperAdminTransfer.v1:actor-account")).toContain(payload.operationId);
    expect(container.querySelector("[data-testid='login-page']")).not.toBeNull();
  });
});
