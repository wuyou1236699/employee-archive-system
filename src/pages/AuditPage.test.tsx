// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "./AuditPage";
import { filterAuditLogs, LocalPreviewDataService } from "../services/dataService";
import type { AuditLogInput } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function addAuditLogs(service: LocalPreviewDataService): void {
  const auditInputs: AuditLogInput[] = [
    {
      action: "create_employee",
      targetId: "employee-lin",
      targetName: "示例员工甲",
      result: "success",
      detail: "网页新增员工档案。",
    },
    {
      action: "update_employee",
      targetId: "employee-zhou",
      targetName: "示例员工乙",
      result: "failure",
      detail: "网页编辑员工档案失败。",
    },
    {
      action: "update_account_display_name",
      targetId: null,
      targetName: null,
      result: "success",
      detail: "修改账号显示名称。",
    },
    {
      action: "view_attachment",
      targetId: "employee-lin",
      targetName: "示例员工甲",
      result: "success",
      detail: "查看员工附件“工作证.png”。",
    },
    {
      action: "view_student_detail",
      targetId: "student-old-log",
      targetName: "历史学员记录",
      result: "success",
      detail: "查看学员档案详情（含手机号）。",
    },
  ];
  auditInputs.forEach((input) => {
    service.recordAudit(input);
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

function getRowTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr")).map((row) => row.textContent ?? "");
}

function changeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function changeSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AuditPage filters", () => {
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

  it("reloads for employee name changes and restores all logs after clearing", async () => {
    const service = new LocalPreviewDataService();
    addAuditLogs(service);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();
    expect(container.querySelector(".rail-heading .eyebrow")?.textContent).toBe("筛选范围");
    expect(container.querySelector(".rail-heading h2")?.textContent).toBe("日志筛选");
    expect(getRowTexts(container)).toHaveLength(4);
    expect(getRowTexts(container).join(" ")).not.toContain("历史学员记录");
    expect(container.textContent).not.toContain("查看学员详情");

    const nameInput = container.querySelector<HTMLInputElement>("input[aria-label='按员工姓名筛选日志']");
    expect(nameInput).not.toBeNull();
    await act(async () => {
      changeInputValue(nameInput as HTMLInputElement, "示例员工乙");
    });
    await settle();
    expect(getRowTexts(container)).toHaveLength(1);
    expect(getRowTexts(container).every((text) => text.includes("示例员工乙"))).toBe(true);

    const clearButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("重置筛选条件"));
    expect(clearButton).not.toBeUndefined();
    await act(async () => {
      clearButton?.click();
    });
    await settle();
    expect(getRowTexts(container)).toHaveLength(4);
  });

  it("reloads for operation and result selection changes", async () => {
    const service = new LocalPreviewDataService();
    addAuditLogs(service);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();

    const actionSelect = container.querySelector<HTMLSelectElement>("select[aria-label='按操作类型筛选日志']");
    const resultSelect = container.querySelector<HTMLSelectElement>("select[aria-label='按执行结果筛选日志']");
    expect(actionSelect).not.toBeNull();
    expect(resultSelect).not.toBeNull();

    await act(async () => {
      changeSelectValue(actionSelect as HTMLSelectElement, "update_employee");
    });
    await settle();
    expect(getRowTexts(container)).toHaveLength(1);
    expect(getRowTexts(container)[0]).toContain("修改员工");

    await act(async () => {
      changeSelectValue(resultSelect as HTMLSelectElement, "success");
    });
    await settle();
    expect(getRowTexts(container)).toHaveLength(0);
    expect(container.textContent).toContain("暂无匹配日志");
    expect(container.textContent).toContain("暂无操作记录。");
  });

  it("shows only display-name update logs when that action is selected", async () => {
    const service = new LocalPreviewDataService();
    addAuditLogs(service);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();

    const actionSelect = container.querySelector<HTMLSelectElement>("select[aria-label='按操作类型筛选日志']");
    expect(actionSelect).not.toBeNull();
    expect(Array.from((actionSelect as HTMLSelectElement).options).map((option) => option.value)).not.toContain("initial_import");
    expect(Array.from((actionSelect as HTMLSelectElement).options).map((option) => option.value)).not.toContain("archive_employee");
    expect(Array.from((actionSelect as HTMLSelectElement).options).map((option) => option.value)).toContain("initial_migration");
    expect(Array.from((actionSelect as HTMLSelectElement).options).map((option) => option.value)).toContain("update_employee");
    expect(Array.from((actionSelect as HTMLSelectElement).options).map((option) => option.value)).not.toContain("view_student_detail");

    await act(async () => {
      changeSelectValue(actionSelect as HTMLSelectElement, "update_account_display_name");
    });
    await settle();

    expect(getRowTexts(container)).toHaveLength(1);
    expect(getRowTexts(container)[0]).toContain("修改显示名称");
    expect(getRowTexts(container)[0]).not.toContain("修改员工");
  });

  it("shows and filters password reset audits with an unconfirmed result", async () => {
    const service = new LocalPreviewDataService();
    service.recordAudit({
      action: "reset_account_password",
      targetId: "stable-account-id",
      targetName: "reset-user",
      detail: "管理员重置账号密码的结果暂不可确认。",
    });
    const originalListAuditLogs = service.listAuditLogs.bind(service);
    vi.spyOn(service, "listAuditLogs").mockImplementation((filters) => filterAuditLogs(
      originalListAuditLogs().map((log) => ({ ...log, result: "unknown", targetType: "account" })),
      filters,
    ));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();

    expect(container.textContent).toContain("重置账号密码");
    expect(container.textContent).toContain("未确认");
    expect(container.textContent).toContain("reset-user");
    const actionSelect = container.querySelector<HTMLSelectElement>("select[aria-label='按操作类型筛选日志']");
    const resultSelect = container.querySelector<HTMLSelectElement>("select[aria-label='按执行结果筛选日志']");
    expect(Array.from((actionSelect as HTMLSelectElement).options).map((option) => option.value)).toContain("reset_account_password");
    expect(Array.from((resultSelect as HTMLSelectElement).options).map((option) => option.value)).toContain("unknown");
    await act(async () => {
      changeSelectValue(resultSelect as HTMLSelectElement, "unknown");
    });
    await settle();
    expect(getRowTexts(container)).toHaveLength(1);
  });

  it("uses a plain-language label for preparing monthly assessment targets", async () => {
    const service = new LocalPreviewDataService();
    service.recordAudit({
      action: "materialize_monthly_assessment_targets",
      targetId: null,
      targetName: null,
      result: "success",
      detail: "准备月度考核对象。",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();

    const actionSelect = container.querySelector<HTMLSelectElement>("select[aria-label='按操作类型筛选日志']");
    expect(Array.from((actionSelect as HTMLSelectElement).options).find((option) => option.value === "materialize_monthly_assessment_targets")?.textContent).toBe("准备月度考核对象");
    expect(getRowTexts(container)[0]).toContain("准备月度考核对象");
    expect(container.textContent).not.toContain("生成月度考核对象快照");
  });

  it("keeps only the migration import option and removes redundant log-rule copy", async () => {
    const service = new LocalPreviewDataService();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();

    const actionSelect = container.querySelector<HTMLSelectElement>("select[aria-label='按操作类型筛选日志']");
    expect(actionSelect).not.toBeNull();
    const options = Array.from((actionSelect as HTMLSelectElement).options);
    expect(options.map((option) => option.value)).not.toContain("initial_import");
    expect(options.map((option) => option.value)).toContain("initial_migration");
    expect(options.map((option) => option.textContent)).not.toContain("初始导入");
    expect(options.find((option) => option.value === "initial_migration")?.textContent).toBe("历史资料导入");
    expect(container.textContent).not.toContain("迁移记录");
    expect(container.textContent).not.toContain("日志采用追加写入思路");
    expect(container.textContent).not.toContain("只读日志");
    expect(container.textContent).not.toContain("只读查看");
    expect(container.textContent).not.toContain("系统自动记录员工档案操作");
    expect(container.textContent).not.toContain("正在读取系统自动记录的日志");
  });

  it("keeps the service error message visible when loading fails", async () => {
    const service = new LocalPreviewDataService();
    service.listAuditLogs = vi.fn(() => {
      throw new Error("测试环境读取日志失败");
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("测试环境读取日志失败");
    expect(container.textContent).toContain("操作日志加载失败");
  });

  it("uses a safe Chinese label for an unknown audit action", async () => {
    const service = new LocalPreviewDataService();
    service.recordAudit({
      action: "backend_internal_operation" as AuditLogInput["action"],
      targetId: null,
      targetName: null,
      result: "success",
      detail: "业务操作记录。",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();

    expect(getRowTexts(container)[0]).toContain("其他操作");
    expect(container.textContent).not.toContain("backend_internal_operation");
  });

  it("renders readable business changes instead of raw audit snapshots", async () => {
    const service = new LocalPreviewDataService();
    service.recordAudit({
      action: "update_employee",
      targetId: "employee-lin",
      targetName: "示例员工甲",
      changedFields: ["department", "name", "personalPhone", "permissions", "_id"],
      before: {
        department: "演示部门甲",
        name: "旧名称",
        personalPhone: "137****4093",
        permissions: "employee.write",
        _id: "internal-before-id",
      },
      after: {
        department: "演示部门乙",
        name: "新名称",
        personalPhone: "138****4093",
        permissions: "audit.read",
        _id: "internal-after-id",
      },
      detail: "网页编辑员工档案。",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<AuditPage data={service} />);
    });
    await settle();

    const actionButton = container.querySelector<HTMLButtonElement>(".audit-action-button");
    expect(actionButton).not.toBeNull();
    await act(async () => {
      actionButton?.click();
    });

    const drawer = container.querySelector<HTMLElement>(".audit-detail-drawer");
    expect(drawer).not.toBeNull();
    const heading = drawer?.querySelector(".change-section-heading")?.textContent ?? "";
    const drawerText = drawer?.textContent ?? "";
    expect(heading).toBe("变化说明");
    expect(drawerText).toContain("部门：演示部门甲 → 演示部门乙");
    expect(drawerText).toContain("姓名：旧名称 → 新名称");
    expect(drawerText).toContain("138****4093");
    expect(drawerText).not.toContain("138********4093");
    expect(drawerText).not.toContain("internal-before-id");
    expect(drawerText).not.toContain("internal-after-id");
    expect(drawerText).not.toContain("employee.write");
    expect(drawerText).not.toContain("audit.read");
    expect(drawerText).not.toContain("操作前");
    expect(drawerText).not.toContain("操作后");
    expect(drawer?.querySelector("pre")).toBeNull();
    expect(drawerText).toContain("目标员工");
    expect(drawerText).toContain("执行结果");
    expect(drawerText).toContain("业务说明");
  });

});
