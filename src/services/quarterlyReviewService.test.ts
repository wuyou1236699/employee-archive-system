import { describe, expect, it, vi } from "vitest";
import { CloudFunctionQuarterlyReviewService, LocalPreviewQuarterlyReviewService, UnconfiguredQuarterlyReviewService, type LocalPreviewQuarterlyReviewServiceOptions } from "./quarterlyReviewService";
import { emptyQuarterlyReasons, emptyQuarterlyScores, type QuarterlyTask, type QuarterlyTaskAssignmentInput } from "../quarterly/types";
import { TASK_AVAILABILITY_MESSAGES } from "../quarterly/taskAvailability";

vi.mock("./cloudbaseAdapter", () => ({ app: null }));
const NOW = "2026-12-31T15:59:59.000Z";
const DUE = "2027-01-01T00:00:00+08:00";
const filters = { periodKey: "2026-Q3", type: "all", status: "all" } as const;
const draft = { taskId: "quarterly-task-1", scores: emptyQuarterlyScores(), reasons: emptyQuarterlyReasons(), expectedVersion: 0 };
const complete = { ...draft, scores: { 任务完成: 20, 规范执行: 20, 问题处理: 20, 沟通协作: 20, 学习成长: 20, 服务支持: 20 } };
function local(options: LocalPreviewQuarterlyReviewServiceOptions = {}) {
  return new LocalPreviewQuarterlyReviewService({ now: () => new Date(NOW), ...options });
}
function seed(taskOverrides: Partial<QuarterlyTask> = {}, periodDue: string | null = DUE) {
  const base = local();
  const task = base.getTask("quarterly-task-1")!;
  return { periods: [{ ...base.listPeriods()[0], dueAt: periodDue }], tasks: [{ ...task, dueAt: null, ...taskOverrides }], records: [] };
}
function draftPeriodSeed() {
  const fixture = seed();
  fixture.periods[0]!.status = "draft";
  fixture.periods[0]!.opensAt = null;
  return fixture;
}
function cloud(data: unknown) {
  const callFunction = vi.fn(async () => ({ result: { ok: true, data } }));
  return { service: new CloudFunctionQuarterlyReviewService({ callFunction }), callFunction };
}
function assignment(overrides: Partial<QuarterlyTaskAssignmentInput> = {}): QuarterlyTaskAssignmentInput {
  return { periodKey: "2026-Q3", type: "first", evaluatorEmployeeId: "preview-employee-2", evaluateeEmployeeId: "preview-employee-1", dueAt: null, ...overrides };
}

describe("quarterly assignment options transport", () => {
  it("uses direct accounts/employees shape and strips extra private fields", async () => {
    const options = local().getAssignmentOptions();
    const { service, callFunction } = cloud({ accounts: options.accounts.map((account) => ({ ...account, phone: "private", permissions: ["account.manage"] })), employees: options.employees });
    expect(await service.getAssignmentOptions()).toEqual(options);
    expect(callFunction).toHaveBeenCalledWith({ name: "employeeArchiveApi", data: { route: "quarterly/assignment-options" } });
  });
  it("allows empty departments and legacy empty usernames but preserves explicit nullable fields", async () => {
    const options = local().getAssignmentOptions();
    options.accounts[0] = { ...options.accounts[0], department: "", username: "", employeeId: null, employeeName: null };
    options.employees[0].department = "";
    expect(await cloud(options).service.getAssignmentOptions()).toEqual(options);
  });
  it.each(["accountId", "displayName", "username", "department", "employeeId", "employeeName", "status"])("rejects missing account field %s", async (field) => {
    const options = local().getAssignmentOptions();
    const account: Record<string, unknown> = { ...options.accounts[0] };
    delete account[field];
    await expect(cloud({ ...options, accounts: [account] }).service.getAssignmentOptions()).rejects.toThrow();
  });
  it.each(["employeeId", "name", "department", "status"])("rejects non-string employee field %s", async (field) => {
    const options = local().getAssignmentOptions();
    await expect(cloud({ ...options, employees: [{ ...options.employees[0], [field]: 123 }] }).service.getAssignmentOptions()).rejects.toThrow();
  });
  it.each([null, [], {}, { options: { accounts: [], employees: [] } }, { accounts: [], employees: null }])("rejects invalid direct shape %j", async (data) => {
    await expect(cloud(data).service.getAssignmentOptions()).rejects.toThrow();
  });
  it("returns no options when unconfigured", () => {
    expect(new UnconfiguredQuarterlyReviewService().getAssignmentOptions()).toEqual({ accounts: [], employees: [], students: [] });
  });
});

describe("availability transport", () => {
  it("preserves availability in list, detail, overview, assignment response", async () => {
    const preview = local();
    const task = preview.getTask(draft.taskId)!;
    expect((await cloud({ items: [task] }).service.getMyTasks(filters))[0].availability).toEqual(task.availability);
    expect((await cloud({ task }).service.getTask(task.id)).availability).toEqual(task.availability);
    expect((await cloud({ task, record: null }).service.getTaskDetail(task.id)).task.availability).toEqual(task.availability);
    const overview = preview.getOverview(filters.periodKey);
    if (!overview.ok) throw new Error(overview.message);
    expect(await cloud(overview.data).service.getOverview(filters.periodKey)).toEqual(overview);
    expect(await cloud({ task }).service.assignTask(assignment())).toEqual({ ok: true, data: task });
  });
  it("allows absent legacy availability but rejects malformed present values", async () => {
    const task = local().getTask(draft.taskId)!;
    delete task.availability;
    expect((await cloud({ task }).service.getTask(task.id)).availability).toBeUndefined();
    for (const availability of [null, {}, { canWrite: "true", reason: null, dueAt: null, serverNow: NOW }, { canWrite: true, dueAt: null, serverNow: NOW }, { canWrite: true, reason: null, serverNow: NOW }, { canWrite: true, reason: null, dueAt: "2026-02-30T00:00:00Z", serverNow: NOW }, { canWrite: true, reason: null, dueAt: null, serverNow: "2026-01-01T00:00:00" }]) {
      await expect(cloud({ task: { ...task, availability } }).service.getTask(task.id)).rejects.toThrow();
    }
  });
  it("accepts denied invalid stored deadline with null dueAt", async () => {
    const task = local().getTask(draft.taskId)!;
    task.availability = { canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.invalidTime, opensAt: null, dueAt: null, serverNow: NOW };
    expect((await cloud({ task }).service.getTask(task.id)).availability).toEqual(task.availability);
  });
});

describe("quarterly record pagination", () => {
  it("collects every management-record page before returning or exporting records", async () => {
    const saved = local().submit(complete);
    if (!saved.ok) throw new Error(saved.message);
    const firstPage = Array.from({ length: 200 }, (_, index) => ({ ...saved.data, id: `record-${index + 1}` }));
    const secondPage = [{ ...saved.data, id: "record-201" }];
    const callFunction = vi.fn()
      .mockResolvedValueOnce({ result: { ok: true, data: { items: firstPage, total: 201 } } })
      .mockResolvedValueOnce({ result: { ok: true, data: { items: secondPage, total: 201 } } });
    const service = new CloudFunctionQuarterlyReviewService({ callFunction });

    const recordFilters = { ...filters, keyword: "" };
    const records = await service.listRecordsAll(recordFilters);

    expect(records).toHaveLength(201);
    expect(records.at(-1)?.id).toBe("record-201");
    expect(callFunction).toHaveBeenNthCalledWith(1, {
      name: "employeeArchiveApi",
      data: { route: "quarterly/records", ...recordFilters, page: 1, pageSize: 200 },
    });
    expect(callFunction).toHaveBeenNthCalledWith(2, {
      name: "employeeArchiveApi",
      data: { route: "quarterly/records", ...recordFilters, page: 2, pageSize: 200 },
    });
  });
});

describe("preview deadlines and current identity", () => {
  it("keeps the default preview usable in a future year and self bound to its own employee", () => {
    const service = local({ now: () => new Date("2035-01-01T00:00:00Z") });
    const task = service.getTask(draft.taskId)!;
    expect(task.availability?.canWrite).toBe(true);
    expect(task.evaluatorAccountId).toBe("preview-admin");
    expect(task.evaluatorEmployeeIdSnapshot).toBe(task.evaluateeEmployeeId);
    expect(task.evaluatorAccountId).not.toBe(task.evaluateeEmployeeId);
    expect(service.saveDraft(draft).ok).toBe(true);
  });
  it.each(["draft", "submitted"] as const)("uses the earliest deadline and refuses %s exactly at the boundary without writing", (mode) => {
    let now = NOW;
    const service = local({ now: () => new Date(now), seed: seed({ dueAt: "2027-01-02T00:00:00+08:00" }) });
    expect(service.getTask(draft.taskId)?.availability?.dueAt).toBe(DUE);
    now = "2026-12-31T16:00:00.000Z";
    const result = mode === "draft" ? service.saveDraft(draft) : service.submit(complete);
    expect(result).toEqual({ ok: false, message: TASK_AVAILABILITY_MESSAGES.expired });
    expect(service.getTaskDetail(draft.taskId)?.record).toBeNull();
  });
  it("uses task deadline when earlier, and null/empty deadlines mean unlimited", () => {
    expect(local({ seed: seed({ dueAt: DUE }, "2027-01-02T00:00:00Z") }).getTask(draft.taskId)?.availability?.dueAt).toBe(DUE);
    const unlimited = local({ seed: seed({ dueAt: "" }, null) });
    expect(unlimited.getTask(draft.taskId)?.availability).toMatchObject({ canWrite: true, dueAt: null });
    expect(unlimited.submit(complete).ok).toBe(true);
  });
  it.each(["draft", "closed", "archived"] as const)("rejects saves for a %s period and preserves the effective deadline", (status) => {
    const fixture = seed();
    fixture.periods[0].status = status;
    const service = local({ seed: fixture });
    expect(service.getTask(draft.taskId)?.availability).toMatchObject({ canWrite: false, dueAt: DUE });
    expect(service.saveDraft(draft)).toEqual({ ok: false, message: "季度周期当前未开放填写。" });
  });
  it("rejects revoked tasks and retains their deadline", () => {
    const service = local({ seed: seed({ status: "revoked" }) });
    expect(service.getTask(draft.taskId)?.availability).toMatchObject({ canWrite: false, dueAt: DUE });
    expect(service.submit(complete)).toEqual({ ok: false, message: "该季度评价任务已撤销。" });
  });
  it.each(["2026-02-30T00:00:00Z", "2026-12-31T00:00:00", "bad", 42])("fails closed for malformed stored deadline %s without poisoning lists", (value) => {
    const fixture = seed();
    Object.assign(fixture.tasks[0], { dueAt: value });
    const service = local({ seed: fixture });
    expect(service.getMyTasks(filters)[0].availability).toMatchObject({ canWrite: false, reason: TASK_AVAILABILITY_MESSAGES.invalidTime, dueAt: null });
    expect(service.saveDraft(draft).ok).toBe(false);
  });
  it("does not let returned records bypass the deadline", () => {
    let now = NOW;
    const service = local({ now: () => new Date(now), seed: seed() });
    const submitted = service.submit(complete);
    if (!submitted.ok) throw new Error(submitted.message);
    const returned = service.returnRecord({ recordId: submitted.data.id, expectedVersion: submitted.data.version, reason: "补充事实" });
    if (!returned.ok) throw new Error(returned.message);
    now = "2027-01-01T00:00:00Z";
    expect(service.saveDraft({ ...draft, expectedVersion: returned.data.version })).toEqual({ ok: false, message: TASK_AVAILABILITY_MESSAGES.expired });
  });
  it.each([null, "preview-employee-2"])("checks current self binding %s instead of the old task snapshot", (employeeId) => {
    const options = local().getAssignmentOptions();
    options.accounts[0].employeeId = employeeId;
    const service = local({ seed: { ...seed(), assignmentOptions: options } });
    expect(service.getTask(draft.taskId)).toBeUndefined();
    expect(service.saveDraft(draft).ok).toBe(false);
  });
  it("does not conflate admin overview availability with the viewing account", () => {
    const service = local({ currentAccountId: "preview-user-2", seed: seed() });
    const overview = service.getOverview(filters.periodKey);
    if (!overview.ok) throw new Error(overview.message);
    expect(overview.data.tasks[0].availability?.canWrite).toBe(true);
    expect(service.getMyTasks(filters)).toEqual([]);
    expect(service.getTask(draft.taskId)).toBeUndefined();
    expect(service.submit(complete).ok).toBe(false);
  });
});

describe("preview assignment selection", () => {
  it("resolves IDs to trusted snapshots and returns detached option copies", () => {
    const service = local({ seed: draftPeriodSeed() });
    const options = service.getAssignmentOptions();
    options.accounts[1].displayName = "tampered";
    const result = service.assignTask(assignment());
    expect(result).toMatchObject({ ok: true, data: { evaluatorAccountId: null, evaluatorEmployeeIdSnapshot: "preview-employee-2", evaluatorNameSnapshot: "测试2", evaluateeNameSnapshot: "测试1" } });
    expect(service.getAssignmentOptions().accounts[1].displayName).toBe("测试2");
  });
  it("rejects usernames masquerading as account IDs and unknown employees", () => {
    const service = local({ seed: draftPeriodSeed() });
    expect(service.assignTask(assignment({ evaluatorAccountId: "test2" })).ok).toBe(false);
    expect(service.assignTask(assignment({ evaluateeEmployeeId: "unknown" })).ok).toBe(false);
  });
  it("rejects disabled accounts, unbound self and another employee self", () => {
    const service = local({ seed: draftPeriodSeed() });
    expect(service.assignTask(assignment({ evaluatorAccountId: "preview-disabled" })).ok).toBe(false);
    expect(service.assignTask(assignment({ evaluatorAccountId: "preview-unbound", evaluatorEmployeeId: "", type: "self" }))).toEqual({ ok: false, message: "自评必须先绑定本人员工身份。" });
    expect(service.assignTask(assignment({ type: "self" }))).toEqual({ ok: false, message: "自评只能评价当前账号绑定的本人员工。" });
    expect(service.assignTask(assignment({ type: "self", evaluateeEmployeeId: "preview-employee-2" })).ok).toBe(true);
  });
  it("requires a bound active employee identity for the evaluator", () => {
    const options = local().getAssignmentOptions();
    options.employees[0].status = "former";
    const service = local({ seed: { ...draftPeriodSeed(), assignmentOptions: options } });
    expect(service.assignTask(assignment({ evaluatorAccountId: "preview-unbound", evaluatorEmployeeId: "" })).ok).toBe(false);
  });
  it("rejects invalid deadline inputs without mutating periods or assignments", () => {
    const service = local({ seed: draftPeriodSeed() });
    const period = service.listPeriods()[0];
    expect(service.savePeriod({ ...period, dueAt: "2026-02-30T00:00:00Z" }).ok).toBe(false);
    expect(service.listPeriods()[0]).toEqual(period);
    expect(service.assignTask(assignment({ dueAt: "2026-01-01T00:00:00" })).ok).toBe(false);
    expect(service.assignTask(assignment()).ok).toBe(true);
  });
  it("freezes opening and deadline settings after the scheduled cycle opens", () => {
    let now = "2026-09-20T07:00:00.000Z";
    const fixture = seed();
    fixture.periods[0].status = "draft";
    fixture.periods[0].opensAt = null;
    fixture.periods[0].dueAt = null;
    const service = local({ now: () => new Date(now), seed: fixture });
    const period = service.listPeriods()[0];
    const opensAt = "2026-09-20T08:00:00.000Z";
    const dueAt = "2026-09-20T09:00:00.000Z";

    expect(service.savePeriod({ ...period, status: "draft", opensAt, dueAt })).toMatchObject({ ok: true });
    now = opensAt;
    const openPeriod = service.listPeriods()[0];
    expect(openPeriod.status).toBe("open");
    expect(service.savePeriod({ ...openPeriod, dueAt: "2026-09-20T10:00:00.000Z" })).toEqual({ ok: false, message: "周期开放后不能调整截止时间。" });
    expect(service.savePeriod({ ...openPeriod, opensAt: "2026-09-20T08:30:00.000Z" }).ok).toBe(false);
    expect(service.savePeriod({ ...openPeriod, status: "draft" }).ok).toBe(false);
    expect(service.listPeriods()[0]).toMatchObject({ status: "open", opensAt, dueAt });
    expect(service.savePeriod({ ...openPeriod, status: "closed" }).ok).toBe(true);
  });
});
