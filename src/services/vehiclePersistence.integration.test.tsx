// @vitest-environment jsdom

import { createRequire } from "node:module";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Employee, EmployeeDraft, ServiceResult } from "../types";
import { EmployeeFormModal } from "../components/EmployeeFormModal";
import { CloudFunctionDataService, employeeToDraft } from "./dataService";

const { callFunctionMock } = vi.hoisted(() => ({ callFunctionMock: vi.fn() }));

vi.mock("./cloudbaseAdapter", () => ({ app: { callFunction: callFunctionMock } }));

const require = createRequire(import.meta.url);
const {
  COLLECTIONS,
  MANAGED_PERMISSIONS,
  createHandler,
} = require("../../backend/employeeArchiveApi/index.js") as {
  COLLECTIONS: Record<string, string>;
  MANAGED_PERMISSIONS: string[];
  createHandler: (options: Record<string, unknown>) => (event: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LocalState = {
  accounts: Array<Record<string, unknown>>;
  employees: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
};

type LocalDocument = {
  get(): Promise<{ data: Record<string, unknown> | Record<string, unknown>[] }>;
  update(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  set(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
};

type LocalCollection = {
  where(filters: Record<string, unknown>): LocalCollection;
  field(fields: Record<string, unknown>): LocalCollection;
  orderBy(field: string, direction?: string): LocalCollection;
  skip(count: number): LocalCollection;
  limit(count: number): LocalCollection;
  get(): Promise<{ data: Record<string, unknown>[] }>;
  doc(id: string): LocalDocument;
  add(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
};

type LocalDatabase = {
  collection(collectionName: string): LocalCollection;
  runTransaction<T>(work: (transaction: LocalDatabase) => Promise<T>): Promise<T>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

const VEHICLE_UPDATE_METADATA_FIELDS = new Set(["vehicle", "version", "updatedAt", "updatedByAuthUid"]);

function employeeContentWithoutVehicleUpdateMetadata(employee: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(employee).filter(([key]) => !VEHICLE_UPDATE_METADATA_FIELDS.has(key)));
}

function createLocalDatabase(initialEmployees: Array<Record<string, unknown>>, permissions = MANAGED_PERMISSIONS) {
  const state: LocalState = {
    accounts: [{
      _id: "vehicle-local-admin",
      authUid: "vehicle-local-auth",
      username: "vehicle-local-admin",
      displayName: "本地车辆集成测试账号",
      status: "active",
      role: "admin",
      permissions: [...permissions],
    }],
    employees: clone(initialEmployees),
    audits: [],
  };
  let sequence = 1;
  let failAuditWrites = false;

  function rowsFor(collectionName: string, target: LocalState): Array<Record<string, unknown>> {
    if (collectionName === COLLECTIONS.adminAccounts) return target.accounts;
    if (collectionName === COLLECTIONS.employees) return target.employees;
    if (collectionName === COLLECTIONS.auditLogs) return target.audits;
    throw new Error(`Unexpected local test collection: ${collectionName}`);
  }

  function buildCollection(collectionName: string, target: LocalState) {
    let filters: Record<string, unknown> = {};
    let selectedFields: Record<string, unknown> | null = null;
    let offset = 0;
    let limit = Number.POSITIVE_INFINITY;
    let orderByField = "";
    let orderDirection = "asc";

    const query = {
      where(nextFilters: Record<string, unknown>) {
        filters = { ...filters, ...nextFilters };
        return query;
      },
      field(fields: Record<string, unknown>) {
        selectedFields = fields;
        return query;
      },
      orderBy(field: string, direction = "asc") {
        orderByField = field;
        orderDirection = direction;
        return query;
      },
      skip(count: number) {
        offset = count;
        return query;
      },
      limit(count: number) {
        limit = count;
        return query;
      },
      async get() {
        let found = rowsFor(collectionName, target).filter((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value),
        );
        if (orderByField) {
          found = [...found].sort((left, right) => {
            const comparison = String(left[orderByField] ?? "").localeCompare(String(right[orderByField] ?? ""));
            return orderDirection === "desc" ? -comparison : comparison;
          });
        }
        found = found.slice(offset, offset + limit);
        return {
          data: found.map((row) => selectedFields
            ? Object.fromEntries(Object.keys(selectedFields).filter((key) => selectedFields?.[key]).map((key) => [key, clone(row[key])]))
            : clone(row)),
        };
      },
      doc(id: string) {
        return {
          async get() {
            const row = rowsFor(collectionName, target).find((candidate) => String(candidate._id || candidate.id) === String(id));
            return { data: row ? clone(row) : [] };
          },
          async update(payload: Record<string, unknown>) {
            const row = rowsFor(collectionName, target).find((candidate) => String(candidate._id || candidate.id) === String(id));
            if (!row) throw new Error(`Missing local test document: ${collectionName}/${id}`);
            Object.assign(row, clone(payload));
            return { updated: 1 };
          },
          async set(payload: Record<string, unknown>) {
            const collectionRows = rowsFor(collectionName, target);
            const row = collectionRows.find((candidate) => String(candidate._id || candidate.id) === String(id));
            if (row) Object.assign(row, clone(payload));
            else collectionRows.push({ ...clone(payload), _id: String(id) });
            return { id: String(id) };
          },
        };
      },
      async add(payload: Record<string, unknown>) {
        if (collectionName === COLLECTIONS.auditLogs && failAuditWrites) throw new Error("injected local audit write failure");
        const id = String(payload._id || `${collectionName}-local-${sequence++}`);
        rowsFor(collectionName, target).push({ ...clone(payload), _id: id });
        return { id };
      },
    };
    return query;
  }

  function buildDatabase(target: LocalState): LocalDatabase {
    return {
      collection(collectionName: string) {
        return buildCollection(collectionName, target);
      },
      async runTransaction<T>(work: (transaction: LocalDatabase) => Promise<T>): Promise<T> {
        const staged = clone(target);
        const result = await work(buildDatabase(staged));
        Object.assign(target, staged);
        return result;
      },
    };
  }

  return {
    state,
    database: buildDatabase(state),
    setAuditFailure(value: boolean) {
      failAuditWrites = value;
    },
  };
}

function createHarness(initialEmployees: Array<Record<string, unknown>> = [], permissions = MANAGED_PERMISSIONS) {
  const local = createLocalDatabase(initialEmployees, permissions);
  const database = local.database;
  const sdk = {
    init() {
      return {
        auth: () => ({ getUserInfo: () => ({ uid: "vehicle-local-auth" }) }),
        database: () => database,
      };
    },
  };
  const handler = createHandler({
    sdkFactory: () => sdk,
    // The handler requires its configured storage authority before any route;
    // sdkFactory above is an in-memory adapter and never opens a CloudBase client.
    env: { TCB_ENV_ID: "archive-demo-environment" },
    now: () => "2026-10-13T00:00:00.000Z",
    requestIdFactory: () => "vehicle-local-request",
    managerFactory: () => { throw new Error("Manager must not be called by employee vehicle routes"); },
  });
  callFunctionMock.mockImplementation(async ({ name, data }: { name: string; data: Record<string, unknown> }) => {
    if (name !== "employeeArchiveApi") throw new Error(`Unexpected local function: ${name}`);
    const { route, ...input } = data;
    return { result: await handler({ route, input }) };
  });
  return {
    local,
    service: new CloudFunctionDataService(),
    async invoke(route: string, input: Record<string, unknown> = {}) {
      const { result } = await callFunctionMock({ name: "employeeArchiveApi", data: { route, ...input } });
      return result as Record<string, unknown>;
    },
  };
}

function employeeFixture(overrides: Record<string, unknown> = {}): Employee & Record<string, unknown> {
  return {
    id: "vehicle-history-employee",
    recordType: "employee",
    version: 4,
    sourceSheet: "虚构历史表",
    sourceRow: 9,
    sourceSequence: "fixture-9",
    name: "车辆历史测试员工",
    status: "active",
    department: "本地集成测试组",
    onlyChildStatus: "已核实",
    personalPhone: "",
    workPhone: "原工作电话",
    phonePlan: "保留套餐",
    phoneOwnership: "单位",
    computerOwnership: "单位",
    hireDate: "2020-01-01",
    regularizationDate: "2020-04-01",
    notes: "保留员工备注",
    contract: { id: "fixture-contract", type: "当前合同", startDate: "2025-01-01", endDate: "2027-01-01", notes: "保留合同" },
    vehicle: {
      id: "fixture-vehicle-id",
      model: "旧款测试车型",
      plateNumber: "测试牌照A",
      startDate: "2025-01-01",
      endDate: "2027-01-01",
      notes: "保留车辆备注",
      sourceRef: { sheet: "车辆历史", row: 12 },
      legacyMarker: { imported: true, tags: ["keep", "nested"] },
    } as Employee["vehicle"],
    courseRecords: [{
      id: "fixture-course-record",
      courseName: "历史安全培训",
      status: "completed",
      attendedDate: "2024-06-01",
      note: "车辆编辑不应改动课程历史",
    }],
    events: [{
      id: "fixture-event",
      eventDate: "2025-03-01",
      eventType: "历史工作事件",
      summary: "保留事件摘要",
      detail: "车辆编辑不应改动事件详情",
      attachments: [{
        id: "fixture-event-attachment",
        fileName: "event-note.pdf",
        mimeType: "application/pdf",
        size: 1234,
        visibility: "normal",
        uploadedAt: "2025-03-01T00:00:00.000Z",
      }],
    }],
    attachments: [{
      id: "fixture-attachment",
      fileName: "employee-note.pdf",
      mimeType: "application/pdf",
      size: 2345,
      visibility: "sensitive",
      uploadedAt: "2025-04-01T00:00:00.000Z",
    }],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    quarterlyMetadataSentinel: { periodKey: "2026-Q2", reviewVersion: 3, note: "preserve-quarterly-metadata" },
    customEmployeeMetadata: { source: "fixture", nested: { preserve: true } },
    ...overrides,
  } as Employee & Record<string, unknown>;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mountForm(employee: Employee | null, onSave: (draft: EmployeeDraft) => Promise<ServiceResult<Employee>>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<EmployeeFormModal employee={employee} departments={["本地集成测试组"]} onClose={vi.fn()} onSave={onSave} />);
  });
}

function changeField(labelText: string, value: string) {
  const label = [...(container?.querySelectorAll<HTMLLabelElement>("label.field") ?? [])]
    .find((candidate) => candidate.textContent?.includes(labelText));
  const field = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (!field) throw new Error(`Form field not found: ${labelText}`);
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function saveForm() {
  const button = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((candidate) => candidate.textContent?.includes("保存档案"));
  if (!button) throw new Error("Save button not found");
  await act(async () => button.click());
}

function unmountForm() {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
}

afterEach(() => {
  unmountForm();
  callFunctionMock.mockReset();
});

describe("vehicle persistence through the actual employee form and local handler", () => {
  it("creates, edits, reads, clears, and keeps vehicle null on a later unrelated save", async () => {
    const { service, local } = createHarness();
    const createResults: Array<Awaited<ReturnType<typeof service.createEmployee>>> = [];
    mountForm(null, async (draft) => {
      const result = await service.createEmployee(draft);
      createResults.push(result);
      return result;
    });
    changeField("姓名", "车辆新增虚构员工");
    changeField("部门 / 分组", "本地集成测试组");
    changeField("车辆型号", "测试车型一");
    changeField("车牌号码", "测试牌照一");
    changeField("车辆备注", "新增车辆备注");
    changeField("使用开始日期", "2026-01-01");
    changeField("使用结束日期", "2027-01-01");
    await saveForm();

    const created = createResults[0];
    expect(created?.ok).toBe(true);
    if (!created?.ok) throw new Error("Employee create failed in the local handler");
    const employeeId = created.data.id;
    const createdVehicle = local.state.employees.find((row) => row._id === employeeId)?.vehicle as Record<string, unknown>;
    expect(createdVehicle).toEqual({
      id: expect.any(String),
      model: "测试车型一",
      plateNumber: "测试牌照一",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
      notes: "新增车辆备注",
    });
    expect(callFunctionMock.mock.calls[0][0].data).toMatchObject({
      route: "employees/create",
      vehicle: { model: "测试车型一", plateNumber: "测试牌照一" },
    });
    expect(callFunctionMock.mock.calls[0][0].data).not.toHaveProperty("vehicleModel");
    const readAfterCreate = await service.getEmployee(employeeId);
    expect(readAfterCreate.vehicle).toMatchObject(createdVehicle);

    unmountForm();
    mountForm(readAfterCreate, async (draft) => service.updateEmployee(employeeId, draft, readAfterCreate.version));
    changeField("车牌号码", "测试牌照二");
    await saveForm();
    const readAfterEdit = await service.getEmployee(employeeId);
    const editedVehicle = {
      id: createdVehicle.id,
      model: "测试车型一",
      plateNumber: "测试牌照二",
      startDate: "2026-01-01",
      endDate: "2027-01-01",
      notes: "新增车辆备注",
    };
    expect(local.state.employees.find((row) => row._id === employeeId)?.vehicle).toEqual(editedVehicle);
    expect(readAfterEdit.vehicle).toEqual(editedVehicle);
    const listedAfterEdit = await service.listEmployees({ search: "车辆新增虚构员工", status: "all", department: "all", attention: "all" });
    expect(listedAfterEdit.find((employee) => employee.id === employeeId)?.vehicle).toEqual(editedVehicle);

    unmountForm();
    mountForm(readAfterEdit, async (draft) => service.updateEmployee(employeeId, draft, readAfterEdit.version));
    for (const field of ["车辆型号", "车牌号码", "车辆备注", "使用开始日期", "使用结束日期"]) changeField(field, "");
    await saveForm();
    const cleared = await service.getEmployee(employeeId);
    expect(local.state.employees.find((row) => row._id === employeeId)?.vehicle).toBeNull();
    expect(cleared.vehicle).toBeNull();

    unmountForm();
    mountForm(cleared, async (draft) => service.updateEmployee(employeeId, draft, cleared.version));
    changeField("工作电话", "更新的普通字段");
    await saveForm();
    expect((await service.getEmployee(employeeId)).vehicle).toBeNull();
    expect((await service.listEmployees({ search: "车辆新增虚构员工", status: "all", department: "all", attention: "all" }))[0].vehicle).toBeNull();
  });

  it("preserves the complete employee record and historical vehicle metadata on edit", async () => {
    const historical = employeeFixture();
    const { service, invoke, local } = createHarness([historical as unknown as Record<string, unknown>]);
    const beforeRaw = clone(local.state.employees[0]);
    const response = await invoke("employees/update", {
      employeeId: historical.id,
      expectedVersion: historical.version,
      vehicle: {
        id: "caller-forged-vehicle-id",
        model: "更新历史车型",
        plateNumber: "更新历史牌照",
        startDate: "2025-02-01",
        endDate: "2027-02-01",
        notes: "已编辑历史车辆备注",
        sourceRef: { sheet: "调用方伪造", row: 999 },
        callerOnlyMetadata: "must be ignored",
      },
    });
    expect(response.ok).toBe(true);

    const rawVehicle = local.state.employees[0].vehicle as Record<string, unknown>;
    expect(rawVehicle).toMatchObject({
      id: "fixture-vehicle-id",
      model: "更新历史车型",
      plateNumber: "更新历史牌照",
      startDate: "2025-02-01",
      endDate: "2027-02-01",
      notes: "已编辑历史车辆备注",
      sourceRef: { sheet: "车辆历史", row: 12 },
      legacyMarker: { imported: true, tags: ["keep", "nested"] },
    });
    expect(rawVehicle).not.toHaveProperty("callerOnlyMetadata");
    expect(employeeContentWithoutVehicleUpdateMetadata(local.state.employees[0]))
      .toEqual(employeeContentWithoutVehicleUpdateMetadata(beforeRaw));
    const reread = await service.getEmployee(historical.id);
    expect(reread.vehicle).toEqual(rawVehicle);
    expect(reread.onlyChildStatus).toBe("已核实");
    expect(reread.contract).toEqual(historical.contract);
    expect(reread.attachments).toEqual(historical.attachments);
    expect(reread.events).toEqual(historical.events);
    expect(reread.courseRecords).toEqual(historical.courseRecords);
    expect(local.state.employees[0].quarterlyMetadataSentinel).toEqual(historical.quarterlyMetadataSentinel);
    expect(local.state.employees[0].customEmployeeMetadata).toEqual(historical.customEmployeeMetadata);
  });

  it("assigns a stable preview-compatible id when editing an embedded historical vehicle without one", async () => {
    const historical = employeeFixture({
      vehicle: {
        model: "历史嵌套车型",
        plateNumber: "历史牌照",
        startDate: "2025-01-01",
        endDate: "2027-01-01",
        notes: "历史备注",
        sourceRef: { sheet: "车辆历史", row: 18 },
      } as unknown as Employee["vehicle"],
    });
    const { service, local } = createHarness([historical as unknown as Record<string, unknown>]);
    const current = await service.getEmployee(historical.id);
    mountForm(current, async (draft) => service.updateEmployee(historical.id, draft, current.version));
    changeField("车牌号码", "更新历史牌照");
    await saveForm();

    const rawVehicle = local.state.employees[0].vehicle as Record<string, unknown>;
    expect(rawVehicle.id).toBe(`${historical.id}-vehicle`);
    expect(rawVehicle.plateNumber).toBe("更新历史牌照");
    expect(rawVehicle.sourceRef).toEqual({ sheet: "车辆历史", row: 18 });

    const rereadAfterFirstSave = await service.getEmployee(historical.id);
    unmountForm();
    mountForm(rereadAfterFirstSave, async (draft) => service.updateEmployee(historical.id, draft, rereadAfterFirstSave.version));
    changeField("车辆备注", "再次保存历史备注");
    await saveForm();
    const rereadAfterSecondSave = await service.getEmployee(historical.id);
    const twiceSavedVehicle = local.state.employees[0].vehicle as Record<string, unknown>;
    expect(twiceSavedVehicle.id).toBe(`${historical.id}-vehicle`);
    expect(twiceSavedVehicle.notes).toBe("再次保存历史备注");
    expect(twiceSavedVehicle.sourceRef).toEqual({ sheet: "车辆历史", row: 18 });
    expect(rereadAfterSecondSave.vehicle).toEqual(twiceSavedVehicle);
  });

  it("accepts legacy flat vehicle drafts only when nested vehicle is absent", async () => {
    const { invoke, local } = createHarness();
    const created = await invoke("employees/create", {
      name: "旧客户端虚构员工",
      department: "本地集成测试组",
      vehicleModel: "旧客户端车型",
      vehiclePlateNumber: "旧客户端牌照",
      vehicleStartDate: "2026-02-01",
      vehicleEndDate: "2027-02-01",
      vehicleNotes: "旧客户端备注",
    });
    expect(created.ok).toBe(true);
    const employeeId = String((created.data as Record<string, unknown>).id);
    expect(local.state.employees.find((row) => row._id === employeeId)?.vehicle).toMatchObject({
      model: "旧客户端车型",
      plateNumber: "旧客户端牌照",
      notes: "旧客户端备注",
    });

    const flatUpdate = await invoke("employees/update", {
      employeeId,
      expectedVersion: 1,
      vehicleModel: "旧客户端再次修改",
      vehiclePlateNumber: "旧客户端再次牌照",
    });
    expect(flatUpdate.ok).toBe(true);
    expect(local.state.employees.find((row) => row._id === employeeId)?.vehicle).toMatchObject({
      id: expect.any(String),
      model: "旧客户端再次修改",
      plateNumber: "旧客户端再次牌照",
    });

    const nestedNullWins = await invoke("employees/update", {
      employeeId,
      expectedVersion: 2,
      vehicle: null,
      vehicleModel: "nested null wins",
    });
    expect(nestedNullWins.ok).toBe(true);
    expect(local.state.employees.find((row) => row._id === employeeId)?.vehicle).toBeNull();

    const emptyFlatClear = await invoke("employees/update", {
      employeeId,
      expectedVersion: 3,
      vehicleModel: "",
      vehiclePlateNumber: "",
      vehicleStartDate: "",
      vehicleEndDate: "",
      vehicleNotes: "",
    });
    expect(emptyFlatClear.ok).toBe(true);
    expect(local.state.employees.find((row) => row._id === employeeId)?.vehicle).toBeNull();

    const emptyNestedWins = await invoke("employees/update", {
      employeeId,
      expectedVersion: 4,
      vehicle: {},
      vehicleModel: "nested empty wins",
    });
    expect(emptyNestedWins.ok).toBe(true);
    expect(local.state.employees.find((row) => row._id === employeeId)?.vehicle).toBeNull();
  });

  it("leaves vehicle unchanged when omitted, rejects stale versions and unauthorized writes", async () => {
    const historical = employeeFixture();
    const { service, invoke, local } = createHarness([historical as unknown as Record<string, unknown>]);
    const noVehiclePatch = await invoke("employees/update", {
      employeeId: historical.id,
      expectedVersion: historical.version,
      notes: "仅修改其他字段",
    });
    expect(noVehiclePatch.ok).toBe(true);
    expect((await service.getEmployee(historical.id)).vehicle).toMatchObject(historical.vehicle!);
    const afterNoVehiclePatch = clone(local.state.employees[0]);

    const stale = await service.updateEmployee(historical.id, employeeToDraft(await service.getEmployee(historical.id)), historical.version);
    expect(stale.ok).toBe(false);
    expect(local.state.employees[0]).toMatchObject({
      ...afterNoVehiclePatch,
      version: historical.version + 1,
    });
    expect(local.state.audits.some((audit) => audit.result === "success" && audit.action === "update_employee")).toBe(true);
    const staleResponse = await invoke("employees/update", {
      employeeId: historical.id,
      expectedVersion: historical.version,
      vehicle: { model: "过期版本不得提交" },
    });
    expect(staleResponse).toMatchObject({
      ok: false,
      error: { code: "EMPLOYEE_CONFLICT", status: 409 },
    });
    expect(local.state.employees[0]).toEqual(afterNoVehiclePatch);

    const unauthorized = createHarness([], []);
    const denied = await unauthorized.service.createEmployee({
      ...employeeToDraft(employeeFixture()),
      name: "无权限虚构员工",
      department: "本地集成测试组",
    });
    expect(denied.ok).toBe(false);
    expect(unauthorized.local.state.employees).toHaveLength(0);
    const deniedResponse = await unauthorized.invoke("employees/create", {
      name: "无权限虚构员工",
      department: "本地集成测试组",
      vehicle: { model: "无权限车辆" },
    });
    expect(deniedResponse).toMatchObject({
      ok: false,
      error: { code: "PERMISSION_DENIED", status: 403 },
    });
    expect(unauthorized.local.state.employees).toHaveLength(0);
  });

  it("rejects invalid vehicle shapes and dates without changing the employee", async () => {
    const historical = employeeFixture();
    const { invoke, local } = createHarness([historical as unknown as Record<string, unknown>]);
    const before = clone(local.state.employees[0]);
    const invalidVehicles = [
      "not-an-object",
      { model: "格式错误日期", startDate: "2026/06/01" },
      { model: "结束早于开始", startDate: "2026-06-01", endDate: "2026-05-31" },
    ];

    for (const vehicle of invalidVehicles) {
      const response = await invoke("employees/update", {
        employeeId: historical.id,
        expectedVersion: historical.version,
        vehicle,
      });
      expect(response).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", status: 400 } });
      expect(local.state.employees[0]).toEqual(before);
    }
  });

  it("rolls back employee and vehicle changes when transactional audit persistence fails", async () => {
    const historical = employeeFixture();
    const { invoke, local } = createHarness([historical as unknown as Record<string, unknown>]);
    const before = clone(local.state.employees[0]);
    local.setAuditFailure(true);
    const result = await invoke("employees/update", {
      employeeId: historical.id,
      expectedVersion: historical.version,
      vehicle: { model: "车辆更新应回滚", plateNumber: "不得提交的牌照" },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "AUDIT_WRITE_FAILED", status: 502 } });
    expect(local.state.employees[0]).toEqual(before);
    expect(local.state.audits).toHaveLength(0);
  });
});
