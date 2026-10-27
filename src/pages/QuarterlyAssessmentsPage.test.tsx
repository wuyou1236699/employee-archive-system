// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuarterlyAssessmentsPage } from "./QuarterlyAssessmentsPage";
import {
  beijingCurrentQuarterKey,
  CloudFunctionQuarterlyReviewService,
  LocalPreviewQuarterlyReviewService,
} from "../services/quarterlyReviewService";
import {
  calculateQuarterlyTotal,
  getQuarterlyValidationReport,
} from "../quarterly/quarterlyValidation";
import {
  emptyQuarterlyReasons,
  emptyQuarterlyScores,
  type QuarterlyAssignmentOptions,
  type QuarterlyPendingRelation,
  type QuarterlyRecord,
  type QuarterlyReviewService,
  type QuarterlyScores,
  type ServiceResult,
} from "../quarterly/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

function getButton(container: HTMLDivElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(label));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`未找到按钮：${label}`);
  return button;
}

async function clickButton(container: HTMLDivElement, label: string): Promise<void> {
  await act(async () => {
    getButton(container, label).click();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

async function fillInput(container: HTMLDivElement, placeholder: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!input) throw new Error(`未找到输入框：${placeholder}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function fillInputByAria(container: HTMLDivElement, label: string, value: string): Promise<void> {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find((candidate) => candidate.getAttribute("aria-label") === label);
  if (!input) throw new Error(`未找到输入框：${label}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function selectValue(container: HTMLDivElement, label: string, value: string): Promise<void> {
  const select = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((candidate) => candidate.getAttribute("aria-label") === label);
  if (!select) throw new Error(`未找到选项：${label}`);
  await selectElementValue(select, value);
}

async function selectElementValue(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

async function chooseGradeAndScore(container: HTMLDivElement, dimension: keyof QuarterlyScores, grade: "A" | "B" | "C" | "D", score: number): Promise<void> {
  const card = Array.from(container.querySelectorAll<HTMLElement>("[data-quarterly-dimension]"))
    .find((candidate) => candidate.dataset.quarterlyDimension === dimension);
  const gradeInput = card?.querySelector<HTMLInputElement>(`input[type="radio"][aria-label^="${grade} ·"]`);
  if (!gradeInput) throw new Error(`未找到维度“${dimension}”的 ${grade} 档单选项。`);
  await act(async () => {
    gradeInput.click();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
  await selectValue(container, `${dimension}分数`, String(score));
}

async function enterFirstEvaluationTask(container: HTMLDivElement): Promise<void> {
  await clickButton(container, "进入评价");
  await settle();
  await settle();
}

function getAssignmentSubmitButton(container: HTMLDivElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("#quarterly-manual-assignment-form button.primary-button");
  if (!button) throw new Error("未找到单项任务安排提交按钮。");
  return button;
}

function getSuccess<T>(result: { ok: true; data: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

function makeHistoryRecord(overrides: Partial<QuarterlyRecord> = {}): QuarterlyRecord {
  return {
    id: "history-q3-self",
    status: "submitted",
    total: 24,
    version: 1,
    updatedAt: "2026-07-15T00:00:00+08:00",
    submittedAt: "2026-07-15T00:00:00+08:00",
    returnedReason: null,
    taskId: "history-task-q3-self",
    periodKey: "2026-Q3",
    periodName: "2026年第三季度",
    type: "self",
    typeLabel: "自评",
    evaluatorAccountId: "history-account",
    evaluatorNameSnapshot: "测试评价人",
    evaluateeEmployeeId: "history-employee",
    evaluateeNameSnapshot: "测试员工",
    evaluateeDepartmentSnapshot: "测试部门",
    scores: { 任务完成: 4, 规范执行: 4, 问题处理: 4, 沟通协作: 4, 学习成长: 4, 服务支持: 4 },
    reasons: { 任务完成: "任务完成理由", 规范执行: "规范执行理由", 问题处理: "问题处理理由", 沟通协作: "沟通协作理由", 学习成长: "学习成长理由", 服务支持: "服务支持理由" },
    isReceived: true,
    resultVisible: true,
    managementEdited: false,
    actualOperatorName: null,
    ...overrides,
  };
}

function offsetQuarterKey(periodKey: string, offset: number): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(periodKey);
  if (!match) throw new Error(`无效季度：${periodKey}`);
  const index = Number(match[1]) * 4 + Number(match[2]) - 1 - offset;
  return `${Math.floor(index / 4)}-Q${index % 4 + 1}`;
}

function createDraftCyclePreview(assignmentOptions?: QuarterlyAssignmentOptions): LocalPreviewQuarterlyReviewService {
  const now = () => new Date("2026-09-01T00:00:00+08:00");
  const baseline = new LocalPreviewQuarterlyReviewService({ now });
  const periods = baseline.listPeriods().map((period) => ({ ...period, status: "draft" as const, opensAt: null, rosterLocked: false }));
  const seed = assignmentOptions ? { periods, assignmentOptions } : { periods };
  return new LocalPreviewQuarterlyReviewService({ now, seed });
}

describe("quarterlyValidation", () => {
  it("validates complete scores and requires reasons for A/D grades", () => {
    const scores = emptyQuarterlyScores();
    const reasons = emptyQuarterlyReasons();
    for (const dimension of Object.keys(scores) as Array<keyof typeof scores>) scores[dimension] = 20;
    scores.任务完成 = 25;
    scores.服务支持 = 4;

    const incomplete = getQuarterlyValidationReport(scores, reasons, "submit");
    expect(incomplete.ok).toBe(false);
    expect(incomplete.errors.任务完成).toContain("A");
    expect(incomplete.errors.服务支持).toContain("D");

    reasons.任务完成 = "本季度主动承担关键任务并完成闭环。";
    reasons.服务支持 = "持续记录伙伴支持和复盘行动。";
    const complete = getQuarterlyValidationReport(scores, reasons, "submit");
    expect(complete.ok).toBe(true);
    expect(complete.total).toBe(109);
    expect(calculateQuarterlyTotal(scores)).toBe(109);
  });
});

describe("LocalPreviewQuarterlyReviewService", () => {
  it("uses the three preview people and filters tasks without touching real employees", () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const allTasks = service.getMyTasks({ periodKey: "2026-Q3", type: "all", status: "all" });
    expect(allTasks.map((task) => task.evaluateeNameSnapshot)).toEqual(["测试1", "测试2", "测试3"]);
    expect(service.getMyTasks({ periodKey: "2026-Q3", type: "first", status: "all" }).map((task) => task.evaluateeNameSnapshot)).toEqual(["测试2"]);
    expect(service.getMyTasks({ periodKey: "2026-Q3", type: "all", status: "pending" }).map((task) => task.evaluateeNameSnapshot)).toEqual(["测试1", "测试2"]);
    const overview = service.getOverview("2026-Q3");
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      expect(overview.data.tasks.map((task) => task.evaluateeNameSnapshot)).toEqual(["测试1", "测试2", "测试3"]);
      expect(overview.data.tasks[0]?.record).toBeNull();
    }
  });

  it("keeps draft and submitted feedback in memory", () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const scores = emptyQuarterlyScores();
    const reasons = emptyQuarterlyReasons();
    const draft = service.saveDraft({ taskId: "quarterly-task-1", scores, reasons, expectedVersion: 0 });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.data.status).toBe("draft");
    expect(draft.data.version).toBe(1);

    const failedSubmit = service.submit({ taskId: "quarterly-task-1", scores, reasons, expectedVersion: 1 });
    expect(failedSubmit.ok).toBe(false);
    if (failedSubmit.ok) return;
    expect(failedSubmit.message).toContain("请填写");
  });

  it("returns the saved draft details used by the form", () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const detail = service.getTaskDetail("quarterly-task-2");

    expect(detail?.task.evaluateeNameSnapshot).toBe("测试2");
    expect(detail?.record?.status).toBe("draft");
    expect(detail?.record?.scores.规范执行).toBe(18);
    expect(detail?.record?.scores.问题处理).toBeNull();
  });
});

describe("CloudFunctionQuarterlyReviewService", () => {
  it("adapts every quarterly route and exposes malformed JSON errors", async () => {
    const local = new LocalPreviewQuarterlyReviewService();
    const period = local.listPeriods()[0];
    const task = local.getTask("quarterly-task-1");
    const record = local.listRecords({ periodKey: "2026-Q3", type: "all", status: "all", keyword: "" })[0];
    const overview = getSuccess(local.getOverview("2026-Q3"));
    if (!period || !task || !record) throw new Error("本地季度预览数据不完整。");
    const routes: string[] = [];
    const requests = new Map<string, Record<string, unknown>>();
    const callFunction = vi.fn(async (input: { name: string; data: Record<string, unknown> }) => {
      const route = input.data.route;
      if (typeof route !== "string") throw new Error("测试调用缺少 route。");
      routes.push(route);
      requests.set(route, input.data);
      if (route === "quarterly/periods/list") return { result: { ok: true, data: { periods: [period] } } };
      if (route === "quarterly/my-tasks") return { result: { ok: true, data: { tasks: [task] } } };
      if (route === "quarterly/my-results") return { result: { ok: true, data: { results: local.getMyResults("2026-Q3") } } };
      if (route === "quarterly/task") return { result: { ok: true, data: { task } } };
      if (route === "quarterly/draft") return { result: { ok: true, data: { task, record } } };
      if (route === "quarterly/overview") return { result: { ok: true, data: overview } };
      if (route === "quarterly/records" || route === "quarterly/history") return { result: { ok: true, data: { records: [record] } } };
      if (route === "quarterly/periods/save") return { result: { ok: true, data: { period } } };
      if (route === "quarterly/tasks/save") return { result: { ok: true, data: { task } } };
      return { result: { ok: true, data: { record } } };
    });
    const service = new CloudFunctionQuarterlyReviewService({ callFunction });

    await service.listPeriods();
    await service.getMyTasks({ periodKey: "2026-Q3", type: "all", status: "all" });
    await service.getMyResults("2026-Q3");
    await service.getTask(task.id);
    await service.getTaskDetail(task.id);
    await service.saveDraft({ taskId: task.id, scores: emptyQuarterlyScores(), reasons: emptyQuarterlyReasons(), expectedVersion: 0 });
    await service.submit({ taskId: task.id, scores: emptyQuarterlyScores(), reasons: emptyQuarterlyReasons(), expectedVersion: 0 });
    await service.getOverview("2026-Q3");
    await service.listRecords({ periodKey: "2026-Q3", type: "all", status: "all", keyword: "" });
    await service.reviseRecord({ recordId: record.id, scores: emptyQuarterlyScores(), reasons: emptyQuarterlyReasons(), reason: "管理员代录测试。", expectedVersion: record.version });
    await service.returnRecord({ recordId: record.id, reason: "请补充事实。", expectedVersion: record.version });
    await service.voidRecord({ recordId: record.id, reason: "重复任务。", expectedVersion: record.version });
    await service.savePeriod({ periodKey: period.periodKey, periodName: period.periodName, status: period.status, dueAt: period.dueAt, scoringStandardVersion: period.scoringStandardVersion });
    await service.assignTask({ periodKey: period.periodKey, type: "self", evaluatorAccountId: "preview-user-2", evaluateeEmployeeId: "preview-employee-2", dueAt: period.dueAt });
    await service.listEmployeeHistory({ employeeId: record.evaluateeEmployeeId, periodKey: record.periodKey });

    expect(routes).toEqual([
      "quarterly/periods/list",
      "quarterly/my-tasks",
      "quarterly/my-results",
      "quarterly/task",
      "quarterly/draft",
      "quarterly/draft",
      "quarterly/submit",
      "quarterly/overview",
      "quarterly/records",
      "quarterly/revise",
      "quarterly/return",
      "quarterly/void",
      "quarterly/periods/save",
      "quarterly/tasks/save",
      "quarterly/history",
    ]);
    expect(requests.get("quarterly/my-tasks")).toMatchObject({ periodKey: "2026-Q3", type: "all", status: "all" });
    expect(requests.get("quarterly/my-tasks")).not.toHaveProperty("filters");
    expect(requests.get("quarterly/records")).toMatchObject({ periodKey: "2026-Q3", type: "all", status: "all", keyword: "" });
    expect(requests.get("quarterly/records")).not.toHaveProperty("filters");

    const malformed = new CloudFunctionQuarterlyReviewService({
      callFunction: async () => ({ result: { ok: true, data: { periods: [{ id: "broken", periodName: "缺少周期标识", status: "open", resultVisibility: "hidden", scoringStandardVersion: "test", rosterVersion: 1, taskCount: 0, submittedTaskCount: 0 }] } } }),
    });
    await expect(malformed.listPeriods()).rejects.toThrow("周期标识");
  });

  it("falls back to user-visible periods and excludes received results", async () => {
    const local = new LocalPreviewQuarterlyReviewService();
    const task = local.getTask("quarterly-task-1");
    if (!task) throw new Error("本地季度预览任务不存在。");
    const hiddenResult = {
      id: "hidden-result",
      periodKey: task.periodKey,
      periodName: task.periodName,
      type: "first" as const,
      typeLabel: "一次评价",
      direction: "received" as const,
      status: "submitted" as const,
      published: false,
      evaluatorName: "不应展示的评价人",
      evaluateeName: "不应展示的被评价人",
      total: 150,
      scores: { 任务完成: 25, 规范执行: 25, 问题处理: 25, 沟通协作: 25, 学习成长: 25, 服务支持: 25 },
      reasons: { 任务完成: "不应展示的理由", 规范执行: "不应展示的理由", 问题处理: "不应展示的理由", 沟通协作: "不应展示的理由", 学习成长: "不应展示的理由", 服务支持: "不应展示的理由" },
    };
    const callFunction = vi.fn(async (input: { name: string; data: Record<string, unknown> }) => {
      if (input.data.route === "quarterly/periods/list") return { result: { ok: false, error: { message: "当前账号没有季度评价管理权限。" } } };
      if (input.data.route === "quarterly/my-tasks") return { result: { ok: true, data: { tasks: [task] } } };
      if (input.data.route === "quarterly/my-results") return { result: { ok: true, data: { results: [hiddenResult] } } };
      throw new Error(`未处理测试路由：${String(input.data.route)}`);
    });
    const service = new CloudFunctionQuarterlyReviewService({ callFunction });

    const periods = await service.listPeriods();
    const results = await service.getMyResults(task.periodKey);

    expect(periods).toHaveLength(1);
    expect(periods[0]?.periodKey).toBe(task.periodKey);
    expect(results).toEqual([]);
  });
});

describe("QuarterlyAssessmentsPage", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    if (scrollIntoViewDescriptor) Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("groups employee history by quarter and review type, then expands an individual score breakdown", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const historyRows = [
      makeHistoryRecord({ id: "q1-first", taskId: "task-q1-first", periodKey: "2026-Q1", periodName: "2026年第一季度", type: "first", typeLabel: "一级评价", evaluatorNameSnapshot: "一级评价人" }),
      makeHistoryRecord({ id: "q3-second", taskId: "task-q3-second", type: "second", typeLabel: "二级评价", evaluatorNameSnapshot: "二级评价人" }),
      makeHistoryRecord({ id: "q3-first", taskId: "task-q3-first", type: "first", typeLabel: "一级评价", evaluatorNameSnapshot: "一级评价人" }),
      makeHistoryRecord({ id: "q3-self", taskId: "task-q3-self", type: "self", typeLabel: "自评", evaluatorNameSnapshot: "本人" }),
    ];
    const history = vi.spyOn(service, "listEmployeeHistory").mockReturnValue(historyRows);
    vi.spyOn(service, "listRecords").mockReturnValue([makeHistoryRecord({ id: "trigger-record" })]);
    const revise = vi.spyOn(service, "reviseRecord");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" initialPeriodKey="2026-Q3" />); });
    await settle();
    await clickButton(container, "概览与记录");
    await settle();
    const button = getButton(container, "员工季度历史");
    expect(button.disabled).toBe(false);
    await clickButton(container, "员工季度历史");
    await settle();
    expect(history).toHaveBeenCalledWith({ employeeId: expect.any(String) });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("员工季度历史");
    const quarterSelect = dialog?.querySelector<HTMLSelectElement>('select[aria-label="查看季度"]');
    expect(Array.from(quarterSelect?.options ?? []).map((option) => option.value)).toEqual(["2026-Q3", "2026-Q1", "all"]);
    expect(quarterSelect?.value).toBe("2026-Q3");
    let quarterGroups = Array.from(dialog?.querySelectorAll<HTMLElement>("[data-quarterly-history-period]") ?? []);
    expect(quarterGroups.map((group) => group.dataset.quarterlyHistoryPeriod)).toEqual(["2026-Q3"]);
    expect(dialog?.textContent).toContain("3 条评价");
    expect(Array.from(quarterGroups[0].querySelectorAll("[data-quarterly-history-type]")).map((group) => group.getAttribute("data-quarterly-history-type"))).toEqual(["self", "first", "second"]);
    const selfRecord = quarterGroups[0].querySelector<HTMLDetailsElement>('[data-quarterly-history-record="q3-self"]');
    expect(selfRecord?.open).toBe(false);
    expect(selfRecord?.querySelector("summary")?.textContent).toContain("本人 · 自评 · 总分：24");
    expect(selfRecord?.textContent).toContain("已提交");
    await act(async () => { selfRecord?.querySelector("summary")?.click(); });
    expect(selfRecord?.open).toBe(true);
    expect(selfRecord?.querySelectorAll(".quarterly-result-scores span")).toHaveLength(6);
    expect(selfRecord?.querySelectorAll(".quarterly-result-reasons li")).toHaveLength(6);
    expect(selfRecord?.textContent).toContain("任务完成理由");
    expect(selfRecord?.textContent).toContain("服务支持理由");
    expect(quarterGroups[0].querySelector("details[data-quarterly-history-period]")).toBeNull();
    if (!quarterSelect) throw new Error("历史季度选择器未显示。");
    await selectElementValue(quarterSelect, "all");
    quarterGroups = Array.from(dialog?.querySelectorAll<HTMLElement>("[data-quarterly-history-period]") ?? []);
    expect(quarterGroups.map((group) => group.dataset.quarterlyHistoryPeriod)).toEqual(["2026-Q3", "2026-Q1"]);
    expect(dialog?.textContent).toContain("4 条评价");
    expect(revise).not.toHaveBeenCalled();
    await clickButton(container, "关闭");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("expands the newest available quarter when the selected quarter has no history", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const selectedPeriodKey = beijingCurrentQuarterKey();
    const newestHistoryPeriodKey = offsetQuarterKey(selectedPeriodKey, 1);
    const olderHistoryPeriodKey = offsetQuarterKey(selectedPeriodKey, 2);
    const historyRows = [
      makeHistoryRecord({ id: "older-history", periodKey: olderHistoryPeriodKey, periodName: olderHistoryPeriodKey, type: "self" }),
      makeHistoryRecord({ id: "newest-history", periodKey: newestHistoryPeriodKey, periodName: newestHistoryPeriodKey, type: "first", typeLabel: "一级评价" }),
    ];
    vi.spyOn(service, "listPeriods").mockReturnValue([]);
    vi.spyOn(service, "listRecords").mockReturnValue([makeHistoryRecord({ id: "trigger-current", periodKey: selectedPeriodKey, periodName: selectedPeriodKey })]);
    vi.spyOn(service, "listEmployeeHistory").mockReturnValue(historyRows);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" initialPeriodKey={selectedPeriodKey} />); });
    await settle();
    await clickButton(container, "概览与记录");
    await settle();
    await clickButton(container, "员工季度历史");
    await settle();

    const dialog = container.querySelector('[role="dialog"]');
    const quarterSelect = dialog?.querySelector<HTMLSelectElement>('select[aria-label="查看季度"]');
    expect(Array.from(quarterSelect?.options ?? []).map((option) => option.value)).toEqual([newestHistoryPeriodKey, olderHistoryPeriodKey, "all"]);
    expect(quarterSelect?.value).toBe(newestHistoryPeriodKey);
    const quarterGroups = Array.from(dialog?.querySelectorAll<HTMLElement>("[data-quarterly-history-period]") ?? []);
    expect(quarterGroups.map((group) => group.dataset.quarterlyHistoryPeriod)).toEqual([newestHistoryPeriodKey]);
    expect(quarterGroups.some((group) => group.dataset.quarterlyHistoryPeriod === selectedPeriodKey)).toBe(false);
    if (!quarterSelect) throw new Error("历史季度选择器未显示。");
    await selectElementValue(quarterSelect, "all");
    expect(Array.from(dialog?.querySelectorAll<HTMLElement>("[data-quarterly-history-period]") ?? []).map((group) => group.dataset.quarterlyHistoryPeriod)).toEqual([newestHistoryPeriodKey, olderHistoryPeriodKey]);
  });

  it("allows retrying a failed employee history read", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const history = vi.spyOn(service, "listEmployeeHistory").mockImplementationOnce(() => { throw new Error("历史读取失败"); });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />); });
    await settle();
    await clickButton(container, "概览与记录");
    await settle();
    await clickButton(container, "员工季度历史");
    await settle();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('[role="alert"]')).not.toBeNull();
    expect(dialog?.querySelector<HTMLSelectElement>('select[aria-label="查看季度"]')?.disabled).toBe(true);
    expect(dialog?.querySelector(".quarterly-history-count")?.textContent).toBe("—");
    await clickButton(container, "重试");
    await settle();
    expect(history).toHaveBeenCalledTimes(2);
    expect(dialog?.textContent).toContain("总分");
    expect(dialog?.querySelector<HTMLSelectElement>('select[aria-label="查看季度"]')?.disabled).toBe(false);
    expect(dialog?.querySelector(".quarterly-history-count")?.textContent).not.toBe("—");
  });

  it("opens the administrator workspace on my evaluations by default", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();

    const managementTabs = container.querySelector<HTMLElement>('[aria-label="季度评价管理工作区"]');
    expect(managementTabs?.querySelector("button.is-active")?.textContent).toContain("我的评价");
    expect(Array.from(managementTabs?.querySelectorAll("button") ?? []).map((button) => button.textContent?.trim())).toEqual([
      "我的评价",
      "概览与记录",
      "任务名单",
    ]);
    expect(container.textContent).toContain("我的评价任务");

    await clickButton(container, "任务名单");
    await act(async () => {
      root?.render(null);
    });
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();
    expect(container.querySelector('[aria-label="季度评价管理工作区"] button.is-active')?.textContent).toContain("我的评价");
  });

  it("combines progress, averages, exports, filters, and records on the overview and records tab", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const getOverview = vi.spyOn(service, "getOverview");
    const listRecords = vi.spyOn(service, "listRecords");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();
    await clickButton(container, "概览与记录");
    await settle();
    await settle();

    expect(getOverview).toHaveBeenCalled();
    expect(listRecords).toHaveBeenCalled();
    expect(container.textContent).toContain("任务总数");
    expect(container.textContent).toContain("评价类型进度");
    expect(container.textContent).toContain("已提交评价平均分");
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>(".quarterly-export-button")).map((button) => button.textContent?.trim())).toEqual([
      "导出所有评价 .xlsx",
      "导出自评 .xlsx",
      "导出一次评价 .xlsx",
      "导出二次评价 .xlsx",
    ]);
    const pendingLists = container.querySelectorAll<HTMLDetailsElement>(".quarterly-type-progress-card details");
    expect(pendingLists).toHaveLength(3);
    expect(pendingLists[0].open).toBe(false);
    pendingLists[0].querySelector("summary")?.click();
    expect(pendingLists[0].open).toBe(true);
    expect(pendingLists[0].textContent).toContain("测试1");
    expect(pendingLists[0].textContent).toContain("待填写");
    expect(pendingLists[1].textContent).toContain("测试2");
    expect(pendingLists[1].textContent).toContain("草稿");
    expect(pendingLists[2].querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector('input[aria-label="搜索季度评价记录"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="记录评价类型"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="记录状态"]')).not.toBeNull();
    expect(container.textContent).toContain("管理员可退回、作废或在留痕前提下修订/代录");
  });

  it("shows only the current quarter when there are no periods with data", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    vi.spyOn(service, "listPeriods").mockReturnValue([]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="测试用户" employeeId="preview-employee-1" />);
    });
    await settle();
    await settle();

    const workspaceTabs = container.querySelector<HTMLElement>('[aria-label="季度评价工作区"]');
    expect(Array.from(workspaceTabs?.querySelectorAll("button") ?? []).map((button) => button.textContent?.trim())).toEqual([
      "我的评价",
      "我的结果",
    ]);
    expect(workspaceTabs?.querySelector("button.is-active")?.textContent).toContain("我的评价");
    expect(container.querySelector(".quarterly-account-panel")).toBeNull();
    expect(container.textContent).not.toContain("季度评价权限");

    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="查看季度"]');
    expect(selector).not.toBeNull();
    expect(selector?.value).toBe(beijingCurrentQuarterKey());
    expect(Array.from(selector?.options ?? []).map((option) => option.value)).toEqual(["", beijingCurrentQuarterKey()]);
    await clickButton(container, "我的结果");
    expect(Array.from(workspaceTabs?.querySelectorAll("button") ?? []).map((button) => button.textContent?.trim())).toEqual([
      "我的评价",
      "我的结果",
    ]);
    expect(workspaceTabs?.querySelector("button.is-active")?.textContent).toContain("我的结果");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="查看季度"]')?.value).toBe(beijingCurrentQuarterKey());
  });

  it("does not select an empty open period hidden from the quarter choices", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const basePeriod = service.listPeriods()[0];
    if (!basePeriod) throw new Error("体验数据中缺少季度。");
    const currentQuarter = beijingCurrentQuarterKey();
    const previousQuarterKey = (key: string) => {
      const [yearText, quarterText] = key.split("-Q");
      const year = Number(yearText);
      const quarter = Number(quarterText);
      return quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
    };
    const previousQuarter = previousQuarterKey(currentQuarter);
    const emptyOpenQuarter = previousQuarterKey(previousQuarter);
    const emptyOpenPeriod = {
      ...basePeriod,
      id: `quarterly-period:${emptyOpenQuarter}`,
      periodKey: emptyOpenQuarter,
      periodName: emptyOpenQuarter,
      status: "open" as const,
      taskCount: 0,
    };
    const previousDataPeriod = {
      ...basePeriod,
      id: `quarterly-period:${previousQuarter}`,
      periodKey: previousQuarter,
      periodName: previousQuarter,
      status: "closed" as const,
      taskCount: 3,
    };
    const currentDraftPeriod = {
      ...basePeriod,
      id: `quarterly-period:${currentQuarter}`,
      periodKey: currentQuarter,
      periodName: currentQuarter,
      status: "draft" as const,
      opensAt: null,
      taskCount: 0,
    };
    vi.spyOn(service, "listPeriods").mockReturnValue([emptyOpenPeriod, previousDataPeriod, currentDraftPeriod]);
    const getMyTasks = vi.spyOn(service, "getMyTasks");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="测试用户" employeeId="preview-employee-1" />);
    });
    await settle();
    await settle();

    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="查看季度"]');
    expect(selector?.value).toBe(currentQuarter);
    expect(Array.from(selector?.options ?? []).map((option) => option.value)).toEqual(["", currentQuarter, previousQuarter]);
    expect(getMyTasks).toHaveBeenCalledWith(expect.objectContaining({ periodKey: currentQuarter }));
  });

  it("shows this account's submitted results", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="测试用户" employeeId="preview-employee-1" />);
    });
    await settle();
    await settle();
    await clickButton(container, "我的结果");
    await settle();

    expect(container.textContent).toContain("我的结果");
    expect(container.textContent).toContain("被评价人：测试3");
    expect(container.textContent).toContain("总分：132");
    expect(container.querySelector(".quarterly-result-item p")?.textContent).toBe("被评价人：测试3");
    expect(container.textContent).not.toContain("尚未公布");
  });

  it("gives clear save-draft and submit feedback in the user workflow", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="测试用户" employeeId="preview-employee-1" />);
    });
    await settle();
    await settle();

    expect(container.textContent).toContain("测试1");
    await enterFirstEvaluationTask(container);
    await clickButton(container, "保存草稿");
    await settle();
    expect(container.textContent).toContain("草稿已保存");

    await clickButton(container, "提交评价");
    await settle();
    expect(container.textContent).toContain("档位选择不等于具体分数");
  });

  it("locks a self task when the signed-in employee does not match the assignment", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="测试用户" employeeId="preview-employee-2" />);
    });
    await settle();
    await settle();

    expect(container.textContent).toContain("自评只能由当前账号绑定的本人完成");
    await enterFirstEvaluationTask(container);
    expect(container.querySelector<HTMLElement>('[data-quarterly-dimension="任务完成"] [data-quarterly-grade-picker]')?.hasAttribute("disabled")).toBe(true);
    expect(getButton(container, "保存草稿").disabled).toBe(true);
    expect(getButton(container, "提交评价").disabled).toBe(true);
  });

  it("shows management boundary and return/void feedback", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();

    await clickButton(container, "概览与记录");
    await settle();
    expect(container.textContent).toContain("管理员可退回、作废或在留痕前提下修订/代录");

    await clickButton(container, "修订/代录");
    await clickButton(container, "保存修订");
    expect(container.textContent).toContain("请填写这一维度的分数");

    await clickButton(container, "退回");
    await clickButton(container, "确认处理");
    expect(container.textContent).toContain("请填写退回理由");

    await fillInput(container, "请填写给对方可读的处理理由", "请补充本季度事实依据。");
    await clickButton(container, "确认处理");
    await settle();
    expect(container.textContent).toContain("记录已退回");

    await clickButton(container, "作废");
    await fillInput(container, "请填写给对方可读的处理理由", "重复任务，作废处理。");
    await clickButton(container, "确认处理");
    await settle();
    expect(container.textContent).toContain("记录已作废");
  });

  it("shows complete roster relationships and explains period setup", async () => {
    const service = createDraftCyclePreview();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();

    await clickButton(container, "任务名单");
    await clickButton(container, "手动安排单项任务");
    await settle();
    expect(container.textContent).toContain("本周期任务名单");
    expect(container.textContent).toContain("测试1");
    expect(container.querySelector(".quarterly-roster-table")?.textContent).toContain("预览组");
    expect(container.textContent).not.toContain("账号：preview-user");
    expect(container.textContent).not.toContain("档案：preview-employee");
    expect(container.textContent).toContain("待填写");
    expect(getAssignmentSubmitButton(container).disabled).toBe(true);
    await clickButton(container, "待处理关系（0）");
    expect(container.textContent).toContain("当前季度没有待处理关系。");
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(0);

    expect(container.textContent).not.toContain("周期设置");
    expect(container.querySelector('select[aria-label="查看季度"]')).toBeInstanceOf(HTMLSelectElement);
    expect(container.textContent).not.toContain("确认名单并按季度开放");
  });

  it("requires an explicit student profile selection before binding a pending relation", async () => {
    const source = new LocalPreviewQuarterlyReviewService();
    const allOptions = source.getAssignmentOptions();
    const students = Array.from({ length: 130 }, (_, index) => ({
      studentId: `student-profile-${String(index).padStart(3, "0")}`,
      name: index === 129 ? "虚构人员2" : `测试学员${index}`,
    }));
    const service = createDraftCyclePreview({ ...allOptions, students });
    Object.defineProperty(service, "mode", { configurable: true, value: "cloudbase" });
    const overview = service.getOverview("2026-Q3");
    if (!overview.ok) throw new Error(overview.message);
    const period = service.listPeriods().find((item) => item.periodKey === "2026-Q3");
    const sourceTask = overview.data.tasks[0];
    if (!period || !sourceTask) throw new Error("体验数据中缺少季度或评价任务。");
    const pendingRelation: QuarterlyPendingRelation = {
      id: "pending-student-relation",
      sourceRelationId: "source-student-relation",
      periodKey: "2026-Q3",
      periodName: period.periodName,
      type: "first",
      typeLabel: "一次评价",
      status: "pending_binding",
      evaluatorNameSnapshot: "虚构人员2",
      evaluatorEmployeeIdSnapshot: null,
      evaluatorStudentIdSnapshot: null,
      evaluateeEmployeeId: sourceTask.evaluateeEmployeeId,
      evaluateeNameSnapshot: sourceTask.evaluateeNameSnapshot,
      evaluateeDepartmentSnapshot: sourceTask.evaluateeDepartmentSnapshot,
    };
    const openPeriods = service.listPeriods().map((item) => item.periodKey === "2026-Q3"
      ? { ...item, status: "open" as const, rosterLocked: true, rosterVersion: 7 }
      : item);
    vi.spyOn(service, "listPeriods").mockReturnValue(openPeriods);
    let relationPending = true;
    const boundTask = {
      ...sourceTask,
      evaluatorAccountId: "account-student-zhang",
      evaluatorNameSnapshot: "虚构人员2",
      evaluatorEmployeeIdSnapshot: null,
      evaluatorStudentIdSnapshot: "student-profile-129",
      sourceLocked: true,
    };
    vi.spyOn(service, "getOverview").mockImplementation((periodKey) => {
      const current = source.getOverview(periodKey);
      if (!current.ok) return current;
      return {
        ok: true,
        data: {
          ...current.data,
          period: periodKey === "2026-Q3" ? openPeriods.find((item) => item.periodKey === periodKey) ?? current.data.period : current.data.period,
          pendingRelations: relationPending ? [pendingRelation] : [],
          tasks: relationPending ? current.data.tasks : [...current.data.tasks, boundTask],
        },
      };
    });
    const bindSpy = vi.fn(async () => {
      relationPending = false;
      return { ok: true as const, data: { task: boundTask, alreadyBound: false } };
    });
    Object.defineProperty(service, "bindPendingRelationToStudent", { configurable: true, value: bindSpy });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();
    await clickButton(container, "任务名单");
    await clickButton(container, "待处理关系（1）");

    const studentSelectLabel = `为${pendingRelation.id}选择评价人学员档案`;
    const studentSelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select"))
      .find((select) => select.getAttribute("aria-label") === studentSelectLabel);
    expect(studentSelect).toBeInstanceOf(HTMLSelectElement);
    expect(studentSelect?.value).toBe("");
    expect(container.textContent).toContain("来源姓名仅供核对，不会按姓名自动匹配");
    expect(getButton(container, "确认绑定并创建任务").disabled).toBe(true);

    await fillInputByAria(container, `搜索${pendingRelation.id}的评价人学员档案`, "129");
    expect(studentSelect?.options).toHaveLength(2);
    await selectValue(container, studentSelectLabel, "student-profile-129");
    expect(getButton(container, "确认绑定并创建任务").disabled).toBe(true);
    const acknowledgement = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((input) => input.getAttribute("aria-label") === `确认已核对${pendingRelation.id}的来源关系与学员身份`);
    expect(acknowledgement).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      acknowledgement?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    expect(getButton(container, "确认绑定并创建任务").disabled).toBe(false);
    await clickButton(container, "确认绑定并创建任务");
    await settle();

    expect(bindSpy).toHaveBeenCalledWith({
      relationId: pendingRelation.id,
      studentId: "student-profile-129",
      expectedRosterVersion: 7,
      acknowledged: true,
    });
    expect(container.textContent).toContain("只创建了这一条评价任务");
  });

  it("shows every evaluation type by default for a student-linked account", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const firstTask = service.getMyTasks({ periodKey: "2026-Q3", type: "all", status: "all" })[0];
    if (!firstTask) throw new Error("体验数据中缺少评价任务。");
    const getMyTasks = vi.spyOn(service, "getMyTasks").mockReturnValue([firstTask]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="虚构人员2" studentId="student-zhang" />);
    });
    await settle();
    await settle();

    expect(container.querySelector<HTMLSelectElement>('select[aria-label="按评价类型筛选"]')?.value).toBe("all");
    expect(container.textContent).toContain(firstTask.evaluateeNameSnapshot);
    expect(getMyTasks).toHaveBeenCalledWith(expect.objectContaining({ type: "all" }));
  });

  it("does not create a cycle when an administrator browses a different unconfigured quarter", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    Object.defineProperty(service, "mode", { configurable: true, value: "cloudbase" });
    vi.spyOn(service, "listPeriods").mockReturnValue([]);
    const savePeriod = vi.spyOn(service, "savePeriod").mockReturnValue({ ok: false, message: "test stop" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();
    savePeriod.mockClear();

    const currentQuarter = beijingCurrentQuarterKey();
    const [year, quarterText] = currentQuarter.split("-Q");
    const quarter = Number(quarterText);
    const otherQuarter = quarter === 4 ? `${Number(year) + 1}-Q1` : `${year}-Q${quarter + 1}`;
    await selectValue(container, "查看季度", otherQuarter);
    await settle();

    expect(savePeriod).not.toHaveBeenCalled();
  });

  it("uses the server's effective open period and task availability for employee access", async () => {
    const local = new LocalPreviewQuarterlyReviewService();
    const basePeriod = local.listPeriods()[0];
    const baseTask = local.getTask("quarterly-task-1");
    if (!basePeriod || !baseTask) throw new Error("体验数据中缺少季度或员工任务。");
    const currentQuarter = beijingCurrentQuarterKey();
    const period = {
      ...basePeriod,
      id: `quarterly-period:${currentQuarter}`,
      periodKey: currentQuarter,
      periodName: currentQuarter,
      status: "open" as const,
      rosterLocked: true,
      opensAt: "2026-07-01T00:00:00+08:00",
    };
    const task = {
      ...baseTask,
      availability: {
        canWrite: true,
        reason: null,
        opensAt: null,
        dueAt: baseTask.dueAt,
        serverNow: new Date().toISOString(),
      },
    };
    const callFunction = vi.fn(async (input: { name: string; data: Record<string, unknown> }) => {
      const route = input.data.route;
      if (route === "quarterly/periods/list") return { result: { ok: true, data: { periods: [period] } } };
      if (route === "quarterly/my-tasks") return { result: { ok: true, data: { tasks: [task] } } };
      if (route === "quarterly/draft") return { result: { ok: true, data: { task, record: null } } };
      return { result: { ok: true, data: { results: [] } } };
    });
    const service = new CloudFunctionQuarterlyReviewService({ callFunction });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="测试用户" employeeId="preview-employee-1" />);
    });
    await settle();
    await settle();

    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="查看季度"]');
    expect(selector?.value).toBe(currentQuarter);
    expect(Array.from(selector?.options ?? []).find((option) => option.value === currentQuarter)?.textContent).toContain("填写中");
    await enterFirstEvaluationTask(container);
    await chooseGradeAndScore(container, "任务完成", "B", 20);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="任务完成分数"]')?.disabled).toBe(false);
    expect(getButton(container, "保存草稿").disabled).toBe(false);
  });

  it("filters roster categories, paginates 12 at a time, and uses current employee names", async () => {
    const source = new LocalPreviewQuarterlyReviewService();
    const sourceOptions = source.getAssignmentOptions();
    const sourceOverview = source.getOverview("2026-Q3");
    expect(sourceOverview.ok).toBe(true);
    if (!sourceOverview.ok) return;
    const sourceTask = sourceOverview.data.tasks.find((task) => task.type === "first");
    expect(sourceTask).toBeDefined();
    if (!sourceTask) throw new Error("体验数据中缺少一次评价任务。");
    const sourceEvaluator = sourceOptions.accounts.find((account) => account.accountId === sourceTask.evaluatorAccountId);
    const evaluatorId = sourceTask.evaluatorEmployeeIdSnapshot ?? sourceEvaluator?.employeeId;
    expect(evaluatorId).toBeTruthy();
    const evaluateeId = sourceTask.evaluateeEmployeeId;
    const assignmentOptions: QuarterlyAssignmentOptions = {
      employees: sourceOptions.employees.map((employee) => employee.employeeId === evaluatorId
        ? { ...employee, name: "档案最新评价人", department: "最新评价部门" }
        : employee.employeeId === evaluateeId
          ? { ...employee, name: "档案最新被评价人", department: "最新被评价部门" }
          : employee),
      accounts: sourceOptions.accounts,
      students: [],
    };
    const service = createDraftCyclePreview(assignmentOptions);
    const getOverview = service.getOverview.bind(service);
    const taskTypes = [
      ...Array.from({ length: 4 }, () => "first" as const),
      ...Array.from({ length: 67 }, () => "second" as const),
      ...Array.from({ length: 19 }, () => "self" as const),
    ];
    const typeLabels = { first: "一次评价", second: "二次评价", self: "自评" };
    const rosterTasks = taskTypes.map((type, index) => ({
      ...sourceTask,
      id: `quarterly-task-display-${index + 1}`,
      type,
      typeLabel: typeLabels[type],
      evaluatorEmployeeIdSnapshot: null,
      evaluatorNameSnapshot: "旧评价人快照",
      evaluateeNameSnapshot: "旧被评价人快照",
      evaluateeDepartmentSnapshot: "旧被评价部门",
      record: null,
    }));
    const pendingRelation: QuarterlyPendingRelation = {
      id: "pending-renamed-employee",
      sourceRelationId: "source-renamed-employee",
      periodKey: sourceTask.periodKey,
      periodName: sourceTask.periodName,
      type: "first",
      typeLabel: "一次评价",
      status: "pending_binding",
      evaluatorNameSnapshot: "虚构人员2",
      evaluatorEmployeeIdSnapshot: null,
      evaluatorStudentIdSnapshot: null,
      evaluateeEmployeeId: evaluateeId,
      evaluateeNameSnapshot: "旧被评价人快照",
      evaluateeDepartmentSnapshot: "旧被评价部门",
    };
    vi.spyOn(service, "getOverview").mockImplementation((periodKey) => {
      const result = getOverview(periodKey);
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          tasks: rosterTasks,
          pendingRelations: [pendingRelation],
        },
      };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();

    await clickButton(container, "任务名单");
    await settle();

    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe("自评（19）");
    expect(container.textContent).toContain("一次评价（4）");
    expect(container.textContent).toContain("二次评价（67）");
    expect(container.textContent).toContain("自评（19）");
    expect(container.textContent).toContain("待处理关系（1）");
    expect(container.textContent).toContain("全部（91）");
    expect(container.textContent).toContain("关系共 91 条：已建任务 90 条，待处理来源关系 1 条。");
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(12);
    expect(container.textContent).toContain("每页 12 条 · 显示 1–12 条，共 19 条");
    expect(container.textContent).toContain("档案最新评价人");
    expect(container.textContent).toContain("最新评价部门");
    expect(container.textContent).toContain("档案最新被评价人");
    expect(container.textContent).toContain("最新被评价部门");
    expect(container.querySelector(".quarterly-roster-table")?.textContent).not.toContain("虚构人员2");
    expect(container.textContent).not.toContain("旧被评价人快照");
    expect(container.textContent).not.toContain("旧被评价部门");

    await clickButton(container, "下一页");
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(7);
    expect(container.textContent).toContain("每页 12 条 · 显示 13–19 条，共 19 条");

    await clickButton(container, "二次评价（67）");
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(12);
    expect(container.textContent).toContain("每页 12 条 · 显示 1–12 条，共 67 条");
    expect(container.querySelector('button[aria-label="第6页"]')).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[aria-label="第6页"]')?.click();
    });
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(7);
    expect(container.textContent).toContain("每页 12 条 · 显示 61–67 条，共 67 条");

    await clickButton(container, "一次评价（4）");
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(4);
    expect(container.textContent).toContain("每页 12 条 · 显示 1–4 条，共 4 条");
    expect(container.querySelector(".quarterly-roster-table")?.textContent).not.toContain("虚构人员2");

    await clickButton(container, "待处理关系（1）");
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(1);
    expect(container.querySelector(".quarterly-roster-table")?.textContent).toContain("虚构人员2");
    expect(container.querySelector(".quarterly-roster-table")?.textContent).toContain("评价人未匹配，待处理");

    await clickButton(container, "全部（91）");
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(12);
    expect(container.textContent).toContain("每页 12 条 · 显示 1–12 条，共 91 条");

    await clickButton(container, "二次评价（67）");
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[aria-label="第6页"]')?.click();
    });
    const currentQuarter = beijingCurrentQuarterKey();
    const [yearText, quarterText] = currentQuarter.split("-Q");
    const year = Number(yearText);
    const quarter = Number(quarterText);
    const previousQuarter = quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
    const targetQuarter = previousQuarter === "2026-Q3" ? currentQuarter : previousQuarter;
    await selectValue(container, "查看季度", targetQuarter);
    await settle();
    await settle();
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe("自评（19）");
    expect(container.querySelectorAll(".quarterly-roster-table tbody tr")).toHaveLength(12);
    expect(container.textContent).toContain("每页 12 条 · 显示 1–12 条，共 19 条");
  });

  it("disables all task assignment controls when the scheduled period is effectively open", async () => {
    const now = () => new Date("2026-09-01T00:00:00+08:00");
    const service = new LocalPreviewQuarterlyReviewService({ now });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();

    await clickButton(container, "任务名单");
    expect(service.listPeriods()[0]?.status).toBe("open");
    const controls = [
      container.querySelector<HTMLSelectElement>('select[aria-label="评价类型"]'),
      container.querySelector<HTMLInputElement>('input[aria-label="搜索评价人姓名或部门"]'),
      container.querySelector<HTMLSelectElement>('select[aria-label="选择评价人"]'),
      container.querySelector<HTMLInputElement>('input[aria-label="搜索被评价员工姓名或部门"]'),
      container.querySelector<HTMLSelectElement>('select[aria-label="选择被评价员工"]'),
    ];
    expect(controls.every((control) => control?.disabled)).toBe(true);
    expect(getAssignmentSubmitButton(container).disabled).toBe(true);
    expect(container.textContent).toContain("本周期填写中，任务名单只读。");
  });

  it("searches and distinguishes people, omits disabled accounts, and lists all missing identity bindings", async () => {
    const assignmentOptions: QuarterlyAssignmentOptions = {
      employees: [
        { employeeId: "employee-a", name: "虚构人员3", department: "市场部", status: "active" },
        { employeeId: "employee-b", name: "虚构人员3", department: "研发部", status: "active" },
        { employeeId: "employee-unbound", name: "待绑定员工", department: "运营部", status: "active" },
      ],
      accounts: [
        { accountId: "account-a", displayName: "虚构人员3", username: "chen.xiao.a", employeeId: "employee-a", employeeName: "虚构人员3", department: "市场部", status: "active" },
        { accountId: "account-b", displayName: "虚构人员3", username: "chen.xiao.b", employeeId: "employee-b", employeeName: "虚构人员3", department: "研发部", status: "active" },
        { accountId: "account-unbound", displayName: "虚构人员4", username: "leader.login", employeeId: null, employeeName: null, department: "管理层", status: "active" },
        { accountId: "account-disabled", displayName: "停用账号示例", username: "disabled.login", employeeId: null, employeeName: null, department: "管理层", status: "disabled" },
      ],
      students: [],
    };
    const service = createDraftCyclePreview(assignmentOptions);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();
    await clickButton(container, "任务名单");
    await clickButton(container, "手动安排单项任务");
    await settle();

    const accountSelect = container.querySelector<HTMLSelectElement>('select[aria-label="选择评价人"]');
    const employeeSelect = container.querySelector<HTMLSelectElement>('select[aria-label="选择被评价员工"]');
    expect(accountSelect).not.toBeNull();
    expect(employeeSelect).not.toBeNull();
    const accountOptions = Array.from(accountSelect!.options).map((option) => option.textContent ?? "");
    const employeeOptions = Array.from(employeeSelect!.options).map((option) => option.textContent ?? "");
    expect(accountOptions).toContain("虚构人员3 · 市场部 · 在职");
    expect(accountOptions).toContain("虚构人员3 · 研发部 · 在职");
    expect(accountOptions).not.toContain("停用账号示例 · 管理层 · 在职");
    expect(employeeOptions).toContain("虚构人员3 · 市场部 · 在职");
    expect(employeeOptions).toContain("虚构人员3 · 研发部 · 在职");
    expect(container.textContent).not.toContain("尚未完成员工身份绑定");
    expect(container.textContent).not.toContain("未绑定员工档案的账号");
    expect(container.textContent).not.toContain("停用账号不会出现在可选评价人名单中");
    expect(container.textContent).not.toContain("disabled.login");
    expect(container.textContent).not.toContain("employee-a");
    expect(container.textContent).not.toContain("account-a");
  });

  it("locks self evaluator to one active bound account and searches by username for other reviews", async () => {
    const assignmentOptions: QuarterlyAssignmentOptions = {
      employees: [
        { employeeId: "employee-a", name: "虚构人员3", department: "市场部", status: "active" },
        { employeeId: "employee-b", name: "虚构人员3", department: "研发部", status: "active" },
        { employeeId: "employee-unbound", name: "待绑定员工", department: "运营部", status: "active" },
      ],
      accounts: [
        { accountId: "account-a", displayName: "虚构人员3", username: "chen.xiao.a", employeeId: "employee-a", employeeName: "虚构人员3", department: "市场部", status: "active" },
        { accountId: "account-b", displayName: "虚构人员3", username: "chen.xiao.b", employeeId: "employee-b", employeeName: "虚构人员3", department: "研发部", status: "active" },
        { accountId: "account-unbound", displayName: "虚构人员4", username: "leader.login", employeeId: null, employeeName: null, department: "管理层", status: "active" },
      ],
      students: [],
    };
    const service = createDraftCyclePreview(assignmentOptions);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="admin" displayName="管理员" />);
    });
    await settle();
    await settle();
    await clickButton(container, "任务名单");
    await clickButton(container, "手动安排单项任务");
    await settle();

    await selectValue(container, "选择被评价员工", "employee-b");
    const evaluator = container.querySelector<HTMLSelectElement>('select[aria-label="选择评价人"]');
    expect(evaluator?.disabled).toBe(true);
    expect(evaluator?.value).toBe("employee-b");
    expect(container.textContent).toContain("自评由同一员工身份确定。");

    await selectValue(container, "选择被评价员工", "employee-b");
    await selectValue(container, "评价类型", "first");
    await fillInputByAria(container, "搜索评价人姓名或部门", "市场部");
    await selectValue(container, "选择评价人", "employee-a");
    await fillInputByAria(container, "搜索被评价员工姓名或部门", "研发部");
    await act(async () => {
      getAssignmentSubmitButton(container!).click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    await settle();

    const overview = service.getOverview("2026-Q3");
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      expect(overview.data.tasks).toContainEqual(expect.objectContaining({
        type: "first",
        evaluatorEmployeeIdSnapshot: "employee-a",
        evaluateeEmployeeId: "employee-b",
        evaluatorNameSnapshot: "虚构人员3",
        evaluateeNameSnapshot: "虚构人员3",
        evaluateeDepartmentSnapshot: "研发部",
      }));
    }
    expect(container.textContent).not.toContain("account-unbound");
    expect(container.textContent).not.toContain("employee-b");
  });

  it("shows the server deadline and denies editing when server availability is closed", async () => {
    const baseline = new LocalPreviewQuarterlyReviewService();
    const periods = baseline.listPeriods().map((period) => ({ ...period, status: "closed" as const }));
    const service = new LocalPreviewQuarterlyReviewService({ seed: { periods } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="测试用户" employeeId="preview-employee-1" />);
    });
    await settle();
    await settle();

    expect(container.textContent).toContain("截止：");
    expect(container.textContent).toContain("季度周期当前未开放填写");
    await enterFirstEvaluationTask(container);
    expect(container.querySelector<HTMLInputElement>('[data-quarterly-dimension="任务完成"] input[type="radio"]')?.disabled).toBe(true);
    expect(getButton(container, "保存草稿").disabled).toBe(true);
  });

  it("keeps the unsaved score when server availability refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const service = new LocalPreviewQuarterlyReviewService();
    const originalGetTaskDetail = service.getTaskDetail.bind(service);
    let detailReads = 0;
    vi.spyOn(service, "getTaskDetail").mockImplementation((taskId) => {
      detailReads += 1;
      if (detailReads > 1) throw new Error("CloudBase 请求失败");
      return originalGetTaskDetail(taskId);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={service} role="user" displayName="测试用户" employeeId="preview-employee-1" />);
    });
    await settle();
    await settle();
    await enterFirstEvaluationTask(container);
    await chooseGradeAndScore(container, "任务完成", "B", 19);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    const score = container.querySelector<HTMLSelectElement>('select[aria-label="任务完成分数"]');
    expect(score?.value).toBe("19");
    expect(score?.disabled).toBe(true);
    expect(getButton(container, "保存草稿").disabled).toBe(true);
    expect(container.textContent).toContain("当前任务状态刷新失败");
  });

  it("does not let a late save for an old task update the newly selected task", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const originalSubmit = service.submit.bind(service);
    const mockedService: QuarterlyReviewService = service;
    let resolveSubmit: ((result: ServiceResult<QuarterlyRecord>) => void) | undefined;
    vi.spyOn(mockedService, "submit").mockImplementation(() => new Promise((resolve) => { resolveSubmit = resolve; }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<QuarterlyAssessmentsPage data={mockedService} role="user" displayName="测试用户" employeeId="preview-employee-1" />);
    });
    await settle();
    await settle();
    await selectValue(container, "按评价类型筛选", "all");
    await settle();
    await settle();

    const oldTaskScores = emptyQuarterlyScores();
    await enterFirstEvaluationTask(container);
    for (const dimension of Object.keys(oldTaskScores) as Array<keyof QuarterlyScores>) {
      oldTaskScores[dimension] = 20;
      await chooseGradeAndScore(container, dimension, "B", 20);
    }
    await clickButton(container, "提交评价");
    expect(resolveSubmit).toBeTypeOf("function");

    await clickButton(container, "返回任务列表");
    await settle();
    const secondTaskCard = Array.from(container.querySelectorAll<HTMLElement>(".quarterly-task-item"))
      .find((candidate) => candidate.textContent?.includes("测试2") && candidate.textContent.includes("一次评价"));
    const secondTaskButton = secondTaskCard?.querySelector<HTMLButtonElement>("button");
    if (!secondTaskButton) throw new Error("未找到测试2的一次评价任务入口。");
    await act(async () => {
      secondTaskButton.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
    await settle();
    await settle();
    expect(container.textContent).toContain("测试2 · 一次评价");
    await chooseGradeAndScore(container, "任务完成", "C", 11);

    const saved = originalSubmit({ taskId: "quarterly-task-1", scores: oldTaskScores, reasons: emptyQuarterlyReasons(), expectedVersion: 0 });
    if (!saved.ok) throw new Error(saved.message);
    await act(async () => {
      resolveSubmit?.(saved);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    const selectedScore = container.querySelector<HTMLSelectElement>('select[aria-label="任务完成分数"]');
    expect(selectedScore?.value).toBe("11");
    expect(selectedScore?.disabled).toBe(false);
    expect(container.textContent).toContain("测试2 · 一次评价");
  });
});
