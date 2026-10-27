// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmployeesPage } from "./EmployeesPage";
import { EMPLOYEE_LIST_PAGE_SIZE, paginateEmployees } from "./employeePagination";
import type { Employee, StudentProfile } from "../types";
import type { EmployeeDataService } from "../services/dataService";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeEmployee(index: number): Employee {
  return {
    id: `employee-${index}`,
    version: 1,
    sourceSheet: "在职",
    sourceRow: index + 1,
    sourceSequence: String(index + 1).padStart(3, "0"),
    name: `测试员工${index}`,
    status: index % 2 === 0 ? "active" : "former",
    department: index % 2 === 0 ? "演示研发组" : "演示支持组",
    onlyChildStatus: "未填写",
    personalPhone: `1380000${String(index).padStart(4, "0")}`,
    workPhone: "",
    phonePlan: "未填写",
    phoneOwnership: "未填写",
    computerOwnership: "未填写",
    hireDate: "2024-01-01",
    regularizationDate: "",
    notes: "",
    contract: null,
    vehicle: null,
    courseRecords: [],
    events: [],
    attachments: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes(label));
}

describe("员工档案列表分页", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("uses a fixed page size and clamps an out-of-range page", () => {
    const employees = Array.from({ length: 25 }, (_, index) => makeEmployee(index));
    const page = paginateEmployees(employees, 99);

    expect(EMPLOYEE_LIST_PAGE_SIZE).toBe(12);
    expect(page.totalPages).toBe(3);
    expect(page.currentPage).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.startIndex).toBe(24);
    expect(page.endIndex).toBe(25);

    expect(paginateEmployees([], 2)).toMatchObject({
      items: [],
      totalPages: 0,
      currentPage: 1,
      startIndex: 0,
      endIndex: 0,
    });
  });

  it("shows 12 rows and resets to page one after filtering", async () => {
    const employees = Array.from({ length: 25 }, (_, index) => makeEmployee(index));
    const data = {
      mode: "local-preview" as const,
      listEmployees: vi.fn(() => employees),
    } as unknown as EmployeeDataService;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<EmployeesPage data={data} role="super_admin" permissions={[]} />);
    });
    await settle();

    expect(container.querySelectorAll(".employee-table tbody tr")).toHaveLength(12);
    expect(container.textContent).toContain("第 1–12 条，共 25 条");

    await act(async () => container?.querySelector<HTMLButtonElement>("button[aria-label='第3页']")?.click());
    expect(container.textContent).toContain("测试员工24");
    expect(container.textContent).not.toContain("测试员工0");

    await act(async () => container && findButton(container, "离职")?.click());
    await settle();

    expect(container.textContent).toContain("第 1–12 条，共 12 条");
    expect(container.textContent).toContain("测试员工1");
    expect(container.textContent).not.toContain("测试员工24");
  });

  it("does not show pagination controls for an empty result", async () => {
    const data = {
      mode: "local-preview" as const,
      listEmployees: vi.fn(() => []),
    } as unknown as EmployeeDataService;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<EmployeesPage data={data} role="super_admin" permissions={[]} />);
    });
    await settle();

    expect(container.querySelector("button[aria-label='上一页']")).toBeNull();
    expect(container.querySelector("button[aria-label='下一页']")).toBeNull();
    expect(container.textContent).toContain("没有匹配的档案");
  });

  it("shows students and employees in one table while keeping metrics and employee filters scoped", async () => {
    const privatePhoneMarker = "private-student-phone-marker";
    const student = {
      id: "student-list-1",
      recordType: "student" as const,
      name: "测试学员甲",
      status: "active" as const,
      version: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      phoneNumber: privatePhoneMarker,
    } as StudentProfile & { phoneNumber: string };
    const studentDetailPhone = "13800005075";
    const getStudent = vi.fn(async () => ({ ...student, phoneNumber: studentDetailPhone }));
    const recordAudit = vi.fn();
    const data = {
      mode: "local-preview" as const,
      listEmployees: vi.fn(() => [makeEmployee(0), makeEmployee(1)]),
      listStudents: vi.fn(() => [student]),
      getStudent,
      recordAudit,
    } as unknown as EmployeeDataService;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<EmployeesPage data={data} role="super_admin" permissions={[]} />);
    });
    await settle();

    expect(findButton(container, "新增员工")).toBeDefined();
    expect(findButton(container, "新增学员")).toBeDefined();

    await act(async () => findButton(container!, "新增员工")?.click());
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("新增员工档案");
    await act(async () => container!.querySelector<HTMLButtonElement>('button[aria-label="关闭表单"]')?.click());

    await act(async () => findButton(container!, "新增学员")?.click());
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe("新增学员档案");
    await act(async () => container!.querySelector<HTMLButtonElement>('button[aria-label="关闭表单"]')?.click());

    expect(container.querySelectorAll(".employee-list-panel")).toHaveLength(1);
    expect(container.querySelectorAll(".employee-table")).toHaveLength(1);
    expect(container.querySelectorAll(".employee-table tbody tr")).toHaveLength(3);
    expect(container.querySelector(".metric-strip")).not.toBeNull();
    expect(container.querySelectorAll(".metric-card strong")[0]?.textContent).toBe("2");
    expect(container.textContent).toContain("测试员工0");
    expect(container.textContent).toContain("测试员工1");
    expect(container.textContent).toContain("测试学员甲");
    expect(container.textContent).not.toContain(privatePhoneMarker);
    expect(Array.from(container.querySelectorAll("td[data-label='类型']")).map((cell) => cell.textContent)).toEqual(["员工", "员工", "学员"]);

    const studentStatusButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".filter-group .segmented-control button"))
      .find((button) => button.textContent?.trim() === "学员");
    await act(async () => studentStatusButton?.click());
    await settle();

    expect(container.querySelectorAll(".employee-list-panel")).toHaveLength(1);
    expect(container.querySelectorAll("input[aria-label='搜索档案']")).toHaveLength(1);
    expect(container.querySelectorAll(".employee-table")).toHaveLength(1);
    expect(container.querySelector(".metric-strip")).not.toBeNull();
    expect(container.querySelectorAll(".metric-card strong")[0]?.textContent).toBe("2");
    expect(container.querySelectorAll(".employee-table tbody tr")).toHaveLength(1);
    expect(container.textContent).not.toContain("测试员工0");
    expect(container.textContent).not.toContain("测试员工1");
    expect(container.textContent).toContain("测试学员甲");
    expect(container.textContent).not.toContain(privatePhoneMarker);
    expect(container.querySelector("td[data-label='类型']")?.textContent).toBe("学员");
    expect(data.listStudents).toHaveBeenCalledTimes(1);

    await act(async () => container!.querySelector<HTMLButtonElement>("button[aria-label='打开测试学员甲学员详情']")?.click());
    await settle();
    expect(getStudent).toHaveBeenCalledWith(student.id);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('input[inputmode="tel"]')?.value).toBe(studentDetailPhone);
    expect(container.textContent).not.toContain("系统已记录本次查看");
    expect(container.textContent).not.toContain("审计完成后显示");
    await act(async () => container!.querySelector<HTMLButtonElement>('button[aria-label="关闭表单"]')?.click());

    await act(async () => findButton(container!, "在职")?.click());
    await settle();
    expect(container.querySelectorAll(".employee-table tbody tr")).toHaveLength(1);
    expect(container.textContent).toContain("测试员工0");
    expect(container.textContent).not.toContain("测试员工1");
    expect(container.textContent).not.toContain("测试学员甲");

    await act(async () => findButton(container!, "离职")?.click());
    await settle();
    expect(container.querySelectorAll(".employee-table tbody tr")).toHaveLength(1);
    expect(container.textContent).not.toContain("测试员工0");
    expect(container.textContent).toContain("测试员工1");
    expect(container.textContent).not.toContain("测试学员甲");
  });
});
