// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import type { Session } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: Session = {
  accountId: "technical-user-id",
  username: "leader.account",
  displayName: "档案查看账号",
  mode: "cloudbase",
  role: "admin",
  permissions: [],
  status: "active",
};
function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes(label));
}

describe("AppShell account panel", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("shows the display name and login account without technical identifiers", async () => {
    const onSwitchAccount = vi.fn();
    const onSignOut = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppShell
          page="employees"
          session={session}
          onNavigate={vi.fn()}
          onSwitchAccount={onSwitchAccount}
          onSignOut={onSignOut}
        >
          <div>档案内容</div>
        </AppShell>,
      );
    });

    const accountButton = container.querySelector<HTMLButtonElement>(".account-chip-button");
    expect(accountButton?.textContent).toContain("档案查看账号");
    expect(accountButton?.textContent).toContain("leader.account");
    expect(accountButton?.textContent).not.toContain("technical-user-id");
    expect(container.textContent).not.toContain("ARCHIVE / 01");
    expect(findButton(container as HTMLElement, "月度考核总览")).toBeDefined();

    await act(async () => accountButton?.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("账号信息");
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("SESSION / ACCOUNT");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("仅查看");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("显示名称");
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("显示名称注册后不可修改");
    expect(findButton(container as HTMLElement, "编辑显示名称")).toBeUndefined();
    expect(container.querySelector("input[aria-label='显示名称']")).toBeNull();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("leader.account");
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("technical-user-id");

    await act(async () => findButton(container as HTMLElement, "切换账号")?.click());
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);

    await act(async () => accountButton?.click());
    await act(async () => findButton(container as HTMLElement, "退出账号")?.click());
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("keeps account fields readable when a session has no display values", async () => {
    const blankSession: Session = {
      accountId: "technical-user-id",
      username: "",
      displayName: "",
      mode: "cloudbase",
      role: "user",
      permissions: [],
      status: "active",
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <AppShell
          page="employees"
          session={blankSession}
          onNavigate={vi.fn()}
          onSwitchAccount={vi.fn()}
          onSignOut={vi.fn()}
        >
          <div>档案内容</div>
        </AppShell>,
      );
    });

    const accountButton = container.querySelector<HTMLButtonElement>(".account-chip-button");
    expect(accountButton?.textContent).toContain("已登录用户");
    expect(accountButton?.textContent).toContain("已登录账号");
    expect(accountButton?.textContent).not.toContain("technical-user-id");

    await act(async () => accountButton?.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("已登录用户");
    expect(dialog?.textContent).toContain("已登录账号");
    expect(dialog?.textContent).not.toContain("technical-user-id");
  });

  it("keeps the registered display name read-only", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AppShell page="employees" session={session} onNavigate={vi.fn()} onSwitchAccount={vi.fn()} onSignOut={vi.fn()}><div /></AppShell>);
    });
    await act(async () => container?.querySelector<HTMLButtonElement>(".account-chip-button")?.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("档案查看账号");
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("显示名称注册后不可修改");
    expect(findButton(container as HTMLElement, "编辑显示名称")).toBeUndefined();
    expect(container.querySelector("input[aria-label='显示名称']")).toBeNull();
  });

  it("shows business permission groups in the account panel", async () => {
    const groupSession: Session = {
      ...session,
      permissions: ["employee.write", "history.write", "attachment.read", "attachment.write", "monthly_assessment_edit"],
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AppShell page="employees" session={groupSession} onNavigate={vi.fn()} onSwitchAccount={vi.fn()} onSignOut={vi.fn()}><div /></AppShell>);
    });
    await act(async () => container?.querySelector<HTMLButtonElement>(".account-chip-button")?.click());

    const dialogText = container.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(dialogText).toContain("员工档案编辑");
    expect(dialogText).toContain("月度考核编辑");
    expect(dialogText).not.toContain("6 项已授权");
    expect(dialogText).not.toContain("employee.write");
  });
});
