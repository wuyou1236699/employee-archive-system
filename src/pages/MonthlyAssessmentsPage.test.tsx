// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonthlyAssessmentsPage } from "./MonthlyAssessmentsPage";
import { LocalPreviewDataService, type EmployeeDataService } from "../services/dataService";
import type { MonthlyAssessmentOverview } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeOverview(): MonthlyAssessmentOverview {
  return {
    items: [{
      inScope: true,
      employeeId: "employee-monthly-1",
      monthKey: "2026-09",
      employeeName: "测试员工",
      department: "演示研发组",
      employmentStatus: "active",
      hasRecord: true,
      results: {
        meeting: "achieved",
        renewalRate: "not_achieved",
        influence: "unassessed",
        visits: "achieved",
        nineGrid: "unassessed",
      },
      note: "本月说明",
      version: 2,
      filledCount: 3,
    }],
    page: 1,
    pageSize: 50,
    total: 1,
    stats: {
      eligibleActiveCount: 1,
      fullyEvaluatedCount: 0,
      partiallyEvaluatedCount: 1,
      unassessedCount: 0,
      metrics: {
        meeting: { achieved: 1, not_achieved: 0, unassessed: 0, achievementRate: 1 },
        renewalRate: { achieved: 0, not_achieved: 1, unassessed: 0, achievementRate: 0 },
        influence: { achieved: 0, not_achieved: 0, unassessed: 1, achievementRate: null },
        visits: { achieved: 1, not_achieved: 0, unassessed: 0, achievementRate: 1 },
        nineGrid: { achieved: 0, not_achieved: 0, unassessed: 1, achievementRate: null },
      },
    },
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("MonthlyAssessmentsPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("shows the three status labels and keeps the overview readable without edit permission", async () => {
    const overview = makeOverview();
    const data = {
      getDepartments: vi.fn(() => ["演示研发组"]),
      getMonthlyAssessmentOverview: vi.fn(() => ({ ok: true as const, data: overview })),
    } as unknown as EmployeeDataService;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MonthlyAssessmentsPage data={data} canEdit={false} />);
    });
    await settle();

    expect(container.textContent).toContain("月度考核总览");
    expect(container.textContent).not.toContain("MONTHLY ASSESSMENT / 03");
    expect(container.textContent).not.toContain("FILTER / 03");
    expect(container.textContent).toContain("当前账号为只读");
    expect(container.textContent).toContain("当前筛选结果");
    expect(container.querySelector(".monthly-status-achieved")?.textContent).toContain("达成");
    expect(container.querySelector(".monthly-status-not_achieved")?.textContent).toContain("未达成");
    expect(container.querySelector(".monthly-status-unassessed")?.textContent).toContain("未评价");
    expect(container.textContent).toContain("3 / 5");
  });

  it("shows a clear empty state when the local preview has no mapped targets", async () => {
    const data = new LocalPreviewDataService();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MonthlyAssessmentsPage data={data} canEdit />);
    });
    await settle();

    expect(container.textContent).toContain("暂无月度考核对象");
    expect(container.textContent).toContain("当前没有可展示的考核对象。");
    expect(container.textContent).not.toContain("尚未完成 Excel 名单映射");
    expect(container.textContent).not.toContain("按已确认的 Excel 名单映射查看员工月度考核状态");
    expect(container.textContent).not.toContain("版本 v");
  });
});
