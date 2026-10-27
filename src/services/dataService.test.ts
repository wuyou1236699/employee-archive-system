import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudFunctionDataService, LocalPreviewDataService, employeeToDraft, toUserFacingServiceError, validateAttachment, validateEventAttachment } from "./dataService";
import type { AuditLogInput, EmployeeDraft } from "../types";

const { callFunctionMock } = vi.hoisted(() => ({ callFunctionMock: vi.fn() }));

vi.mock("./cloudbaseAdapter", () => ({
  app: { callFunction: callFunctionMock },
}));

afterEach(() => {
  callFunctionMock.mockReset();
});

const emptyDraft: EmployeeDraft = {
  name: "",
  status: "active",
  department: "",
  personalPhone: "",
  workPhone: "",
  phonePlan: "",
  phoneOwnership: "",
  computerOwnership: "",
  hireDate: "",
  regularizationDate: "",
  notes: "",
  contractType: "",
  contractStartDate: "",
  contractEndDate: "",
  contractNotes: "",
  vehicleModel: "",
  vehiclePlateNumber: "",
  vehicleStartDate: "",
  vehicleEndDate: "",
  vehicleNotes: "",
};

function makeDraft(name: string): EmployeeDraft {
  return {
    ...emptyDraft,
    name,
    department: "测试部门",
    personalPhone: "13800000000",
    hireDate: "2026-01-02",
    regularizationDate: "2026-04-02",
    contractType: "当前合同",
    contractStartDate: "2026-01-02",
    contractEndDate: "2027-01-01",
  };
}

const baseEmployeeFilters = {
  search: "",
  status: "all" as const,
  department: "all" as const,
  attention: "all" as const,
};

function makeCloudEmployee(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    version: 1,
    name: id,
    status: "active",
    department: "测试部门",
    personalPhone: "13800000000",
    hireDate: "2026-01-02",
    ...overrides,
  };
}

function employeeListResponse(items: Record<string, unknown>[], total = items.length) {
  return { result: { ok: true, data: { items, total } } };
}

function makeFile(type: string, size: number): File {
  return { name: "测试图片.png", type, size } as File;
}

describe("toUserFacingServiceError", () => {
  const fallback = "系统暂时无法完成此操作，请稍后重试。";
  const quarterlyMessages = [
    "季度填写截止时间已到，不能再填写。",
    "季度截止时间配置无效，暂不能填写，请联系管理员。",
    "季度周期当前未开放填写。",
    "该季度评价任务已撤销。",
    "自评必须先绑定本人员工身份。",
    "自评只能评价当前账号绑定的本人员工。",
    "当前账号身份已变化，请刷新后重试。",
    "季度评价任务已发生变化，请刷新后重试。",
    "季度周期已发生变化，请刷新后重试。",
  ];

  it.each(quarterlyMessages)("preserves the exact quarterly contract: %s", (message) => {
    for (const error of [message, new Error(message), { message }, `  ${message}\n`]) {
      expect(toUserFacingServiceError(error, fallback)).toBe(message);
    }
    // Several callers sanitize the same failure more than once.
    expect(toUserFacingServiceError(toUserFacingServiceError(message, fallback), fallback)).toBe(message);
  });

  it.each([
    "CloudBase SDK 不能连接",
    "employeeArchiveApi 不存在",
    "缺少 expectedVersion",
    "storageKey 不存在",
    "mimeType 字段错误",
    "authUid 不能读取",
    "requestId=test-request",
    "QUARTERLY_DEADLINE_PASSED",
    "access_token=test-token",
    "SecretId=test-id; SecretKey=test-key",
    "Authorization: Bearer test-token",
    "api_key=test-key",
    "credential=test-value",
    "password=test-password",
    "密码：测试密码",
    "密钥不存在",
  ])("hides technical and credential detail before matching business text: %s", (detail) => {
    for (const message of [detail, ...quarterlyMessages.map((friendly) => `${friendly} ${detail}`)]) {
      expect(toUserFacingServiceError(message, fallback)).toBe(fallback);
      expect(toUserFacingServiceError({ message }, fallback)).toBe(fallback);
    }
  });

  it.each([
    ["没有权限读取", "当前账号没有执行此操作的权限，请联系管理员。"],
    ["已被其他账号更新", "这条记录已被其他人更新，请刷新后重试。"],
    ["记录不存在", "未找到相关记录，请刷新后重试。"],
    ["请填写姓名", "请补充必填信息后重试。"],
    ["附件不能超过限制", "填写内容或附件不符合要求，请检查后重试。"],
    ["当前不能保存", "当前记录状态不允许此操作，请刷新后重试。"],
    ["季度填写截止时间已到，不能再填写。 其他说明", "当前记录状态不允许此操作，请刷新后重试。"],
    ["季度填写截止时间已到，不能再填写", "当前记录状态不允许此操作，请刷新后重试。"],
    ["网络暂时不可用", "网络暂时不可用"],
  ])("keeps existing generic behavior and rejects near matches: %s", (message, expected) => {
    expect(toUserFacingServiceError(message, fallback)).toBe(expected);
  });

  it.each([undefined, null, "", "  ", {}, { message: 12 }, 42])("uses fallback for an absent message: %j", (error) => {
    expect(toUserFacingServiceError(error, fallback)).toBe(fallback);
  });
});

describe("LocalPreviewDataService", () => {
  it("validates general and special-event image attachments", () => {
    expect(validateAttachment(makeFile("image/png", 1024))).toBeNull();
    expect(validateEventAttachment(makeFile("application/pdf", 1024))).toContain("事件图片");
    expect(validateAttachment(makeFile("image/png", 10 * 1024 * 1024 + 1))).toContain("员工附件图片");
  });

  it("supports search, status and attention filters", () => {
    const service = new LocalPreviewDataService();
    const base = { search: "", status: "all" as const, department: "all" as const, attention: "all" as const };

    expect(service.listEmployees({ ...base, search: "示例员工甲" })).toHaveLength(1);
    expect(service.listEmployees({ ...base, status: "former" })).toHaveLength(1);
    expect(service.listEmployees({ ...base, attention: "missing" }).map((employee) => employee.name)).toContain("示例员工丙");
  });

  it("validates and persists a new employee without browser storage", () => {
    const service = new LocalPreviewDataService();
    const invalid = service.createEmployee({ ...makeDraft("新员工"), regularizationDate: "2025-01-01" });
    expect(invalid.ok).toBe(false);

    const created = service.createEmployee(makeDraft("新员工"));
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(service.listEmployees({ search: "新员工", status: "all", department: "all", attention: "all" })).toHaveLength(1);
    const duplicate = service.createEmployee(makeDraft("新员工"));
    expect(duplicate.ok).toBe(false);

    const updated = service.updateEmployee(created.data.id, { ...makeDraft("新员工"), department: "更新部门" });
    expect(updated.ok).toBe(true);
    expect(service.getEmployee(created.data.id)?.department).toBe("更新部门");
  });

  it("checks employee and student personal phones across record types", () => {
    const service = new LocalPreviewDataService();
    const student = service.createStudent({ name: "测试学员", phoneNumber: "13800003570" });
    expect(student.ok).toBe(true);
    if (!student.ok) return;

    const blankPhoneEmployee = service.createEmployee({ ...makeDraft("空手机号员工"), personalPhone: "" });
    expect(blankPhoneEmployee.ok).toBe(true);
    if (!blankPhoneEmployee.ok) return;
    const employeeCollision = service.updateEmployee(blankPhoneEmployee.data.id, {
      ...makeDraft("空手机号员工"),
      personalPhone: "13800003570",
    });
    expect(employeeCollision.ok).toBe(false);

    const employee = service.createEmployee({ ...makeDraft("用于查重员工"), personalPhone: "13800005034" });
    expect(employee.ok).toBe(true);
    const studentCollision = service.createStudent({ name: "另一测试学员", phoneNumber: "13800005034" });
    expect(studentCollision.ok).toBe(false);

    expect(service.archiveStudent(student.data.id, student.data.version).ok).toBe(true);
    expect(service.createStudent({ name: "归档后重复学员", phoneNumber: "13800003570" }).ok).toBe(false);
    expect(service.restoreStudent(student.data.id, student.data.version + 1).ok).toBe(true);
  });

  it("adds course/event records without a separate phone-view operation", () => {
    const service = new LocalPreviewDataService();
    const employee = service.getEmployee("emp-1002");
    expect(employee).toBeDefined();
    if (!employee) {
      return;
    }

    const course = service.addCourseRecord(employee.id, {
      courseName: "测试课程",
      status: "completed",
      attendedDate: "2026-09-15",
      note: "测试备注",
    });
    const event = service.addEventRecord(employee.id, {
      eventDate: "2026-09-15",
      eventType: "工作说明",
      summary: "测试事件",
      detail: "测试详情",
    });
    expect(course.ok).toBe(true);
    expect(event.ok).toBe(true);
    const updated = service.getEmployee(employee.id);
    expect(updated?.courseRecords.some((record) => record.courseName === "测试课程")).toBe(true);
    expect(updated?.events.some((record) => record.summary === "测试事件")).toBe(true);
    const logs = service.listAuditLogs({ employeeName: employee.name });
    expect(logs).toHaveLength(0);
  });

  it("filters audit logs by employee name, action and result, then restores all logs when cleared", () => {
    const service = new LocalPreviewDataService();
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
        action: "view_attachment",
        targetId: "employee-lin",
        targetName: "示例员工甲",
        result: "success",
        detail: "查看员工附件“工作证.png”。",
      },
    ];
    auditInputs.forEach((input) => {
      expect(service.recordAudit(input).ok).toBe(true);
    });

    const allLogs = service.listAuditLogs();
    expect(allLogs).toHaveLength(3);
    expect(service.listAuditLogs({ employeeName: " 示例员工乙 " })).toHaveLength(1);
    expect(service.listAuditLogs({ action: "update_employee" }).map((log) => log.id)).toHaveLength(1);
    expect(service.listAuditLogs({ result: "failure" }).map((log) => log.id)).toHaveLength(1);

    const clearedLogs = service.listAuditLogs({ employeeName: "", action: "all", result: "all" });
    expect(clearedLogs.map((log) => log.id)).toEqual(allLogs.map((log) => log.id));
  });
});

describe("CloudFunctionDataService audit filters", () => {
  it("passes normalized name, action and result filters to audit/list", async () => {
    callFunctionMock.mockResolvedValue({
      result: {
        ok: true,
        data: {
          items: [
            {
              id: "audit-cloud-1",
              actorNameSnapshot: "云端管理员",
              action: "update_employee",
              targetType: "employee",
              targetId: null,
              targetNameSnapshot: "示例员工乙",
              changedFields: [],
              before: null,
              after: null,
              result: "failure",
              detail: "网页编辑员工档案失败。",
              createdAt: "2026-09-15T08:00:00.000Z",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 200,
        },
      },
    });
    const service = new CloudFunctionDataService();

    const logs = await service.listAuditLogs({
      employeeName: " 示例员工乙 ",
      action: "update_employee",
      result: "failure",
      targetId: " employee-zhou ",
    });

    expect(logs).toHaveLength(1);
    expect(callFunctionMock).toHaveBeenCalledWith({
      name: "employeeArchiveApi",
      data: {
        route: "audit/list",
        action: "update_employee",
        result: "failure",
        employeeName: "示例员工乙",
        targetId: "employee-zhou",
        page: 1,
        pageSize: 200,
      },
    });

    callFunctionMock.mockResolvedValue({ result: { ok: true, data: { items: [], total: 0, page: 1, pageSize: 200 } } });
    await service.listAuditLogs({});
    expect(callFunctionMock).toHaveBeenLastCalledWith({
      name: "employeeArchiveApi",
      data: { route: "audit/list", action: "all", result: "all", employeeName: "", page: 1, pageSize: 200 },
    });
  });
});

describe("CloudFunctionDataService audit identifiers", () => {
  it("reports a missing identifier separately from duplicate identifiers", async () => {
    const service = new CloudFunctionDataService();
    callFunctionMock.mockResolvedValue({ result: { ok: true, data: {
      items: [{ action: "transfer_super_admin" }], total: 1, page: 1, pageSize: 200,
    } } });
    await expect(service.listAuditLogs()).rejects.toThrow("操作日志缺少有效编号，请联系管理员。");
    callFunctionMock.mockResolvedValue({ result: { ok: true, data: {
      items: [{ id: "audit-duplicate" }, { id: "audit-duplicate" }], total: 2, page: 1, pageSize: 200,
    } } });
    await expect(service.listAuditLogs()).rejects.toThrow("操作日志分页读取重复，请刷新后重试。");
  });
});

describe("CloudFunctionDataService employee list cache", () => {
  it("collects every employee and student directory page instead of silently truncating at the first page", async () => {
    const employeesFirstPage = Array.from({ length: 200 }, (_, index) => makeCloudEmployee(`employee-${index + 1}`));
    const employeesSecondPage = Array.from({ length: 7 }, (_, index) => makeCloudEmployee(`employee-${index + 201}`));
    const studentsFirstPage = Array.from({ length: 200 }, (_, index) => ({ id: `student-${index + 1}`, name: `学员${index + 1}`, status: "active" }));
    const studentsSecondPage = Array.from({ length: 3 }, (_, index) => ({ id: `student-${index + 201}`, name: `学员${index + 201}`, status: "inactive" }));
    callFunctionMock
      .mockResolvedValueOnce(employeeListResponse(employeesFirstPage, 207))
      .mockResolvedValueOnce(employeeListResponse(employeesSecondPage, 207))
      .mockResolvedValueOnce({ result: { ok: true, data: { items: studentsFirstPage, total: 203 } } })
      .mockResolvedValueOnce({ result: { ok: true, data: { items: studentsSecondPage, total: 203 } } });
    const service = new CloudFunctionDataService();

    const employees = await service.listEmployees(baseEmployeeFilters);
    const students = await service.listStudents();

    expect(employees).toHaveLength(207);
    expect(employees.at(-1)?.id).toBe("employee-207");
    expect(students).toHaveLength(203);
    expect(students.at(-1)?.id).toBe("student-203");
    expect(callFunctionMock).toHaveBeenNthCalledWith(1, {
      name: "employeeArchiveApi",
      data: { route: "employees/list", keyword: undefined, status: undefined, page: 1, pageSize: 200 },
    });
    expect(callFunctionMock).toHaveBeenNthCalledWith(2, {
      name: "employeeArchiveApi",
      data: { route: "employees/list", keyword: undefined, status: undefined, page: 2, pageSize: 200 },
    });
    expect(callFunctionMock).toHaveBeenNthCalledWith(3, {
      name: "employeeArchiveApi",
      data: { route: "students/list", page: 1, pageSize: 200 },
    });
    expect(callFunctionMock).toHaveBeenNthCalledWith(4, {
      name: "employeeArchiveApi",
      data: { route: "students/list", page: 2, pageSize: 200 },
    });
  });

  it("reuses the base request for local filters without mixing search or status results", async () => {
    const active = makeCloudEmployee("employee-active");
    const former = makeCloudEmployee("employee-former", { status: "former", department: "历史部门" });
    const phoneMatch = makeCloudEmployee("employee-phone", { personalPhone: "13800006075" });
    callFunctionMock
      .mockResolvedValueOnce(employeeListResponse([active]))
      .mockResolvedValueOnce(employeeListResponse([former]))
      .mockResolvedValueOnce(employeeListResponse([phoneMatch]));
    const service = new CloudFunctionDataService();

    const [allEmployees, departmentEmployees, attentionEmployees] = await Promise.all([
      service.listEmployees(baseEmployeeFilters),
      service.listEmployees({ ...baseEmployeeFilters, department: "测试部门" }),
      service.listEmployees({ ...baseEmployeeFilters, attention: "missing" }),
    ]);

    expect(allEmployees.map((employee) => employee.id)).toEqual(["employee-active"]);
    expect(departmentEmployees.map((employee) => employee.id)).toEqual(["employee-active"]);
    expect(attentionEmployees).toEqual([]);
    expect(callFunctionMock).toHaveBeenCalledTimes(1);

    const formerEmployees = await service.listEmployees({ ...baseEmployeeFilters, status: "former" });
    expect(formerEmployees.map((employee) => employee.id)).toEqual(["employee-former"]);
    expect(callFunctionMock).toHaveBeenCalledTimes(2);

    const phoneEmployees = await service.listEmployees({ ...baseEmployeeFilters, search: "139" });
    expect(phoneEmployees.map((employee) => employee.id)).toEqual(["employee-phone"]);
    expect(callFunctionMock).toHaveBeenCalledTimes(3);
  });

  it("removes failed requests so the next identical request can retry", async () => {
    callFunctionMock
      .mockRejectedValueOnce(new Error("网络暂时不可用"))
      .mockResolvedValueOnce(employeeListResponse([makeCloudEmployee("employee-retry")]));
    const service = new CloudFunctionDataService();

    await expect(service.listEmployees(baseEmployeeFilters)).rejects.toThrow("网络暂时不可用");
    const employees = await service.listEmployees(baseEmployeeFilters);

    expect(employees.map((employee) => employee.id)).toEqual(["employee-retry"]);
    expect(callFunctionMock).toHaveBeenCalledTimes(2);
  });

  it.each(["create", "update", "archive"] as const)("invalidates cached lists after a successful %s", async (operation) => {
    const oldEmployee = makeCloudEmployee("employee-old");
    const newEmployee = makeCloudEmployee("employee-new");
    callFunctionMock
      .mockResolvedValueOnce(employeeListResponse([oldEmployee]))
      .mockResolvedValueOnce({ result: { ok: true, data: newEmployee } })
      .mockResolvedValueOnce(employeeListResponse([newEmployee]));
    const service = new CloudFunctionDataService();

    await service.listEmployees(baseEmployeeFilters);
    if (operation === "create") {
      await expect(service.createEmployee(makeDraft("新员工"))).resolves.toMatchObject({ ok: true });
    } else if (operation === "update") {
      await expect(service.updateEmployee("employee-old", makeDraft("旧员工"), 1)).resolves.toMatchObject({ ok: true });
    } else {
      await expect(service.archiveEmployee("employee-old")).resolves.toMatchObject({ ok: true });
    }

    const employees = await service.listEmployees(baseEmployeeFilters);
    expect(employees.map((employee) => employee.id)).toEqual(["employee-new"]);
    expect(callFunctionMock).toHaveBeenCalledTimes(3);
  });
});

describe("CloudFunctionDataService optimistic concurrency", () => {
  it("serializes contract drafts under employee.contract and restores them after a read", async () => {
    const employeeId = "fictional-contract-employee";
    const createdContract = {
      id: "fictional-contract-record",
      type: "固定期限合同",
      startDate: "2026-02-01",
      endDate: "2027-01-31",
      notes: "虚构新增合同",
    };
    const updatedContract = {
      ...createdContract,
      type: "续签合同",
      startDate: "2027-02-01",
      endDate: "2028-01-31",
      notes: "虚构修改后的合同",
    };
    callFunctionMock
      .mockResolvedValueOnce({ result: { ok: true, data: makeCloudEmployee(employeeId, { contract: createdContract }) } })
      .mockResolvedValueOnce({ result: { ok: true, data: makeCloudEmployee(employeeId, { version: 2, contract: updatedContract }) } })
      .mockResolvedValueOnce({ result: { ok: true, data: makeCloudEmployee(employeeId, { version: 2, contract: updatedContract }) } });
    const service = new CloudFunctionDataService();

    const created = await service.createEmployee(makeDraft("虚构合同员工"));
    expect(created).toMatchObject({ ok: true, data: { id: employeeId, contract: createdContract } });

    const revisedDraft = {
      ...makeDraft("虚构合同员工"),
      contractType: updatedContract.type,
      contractStartDate: updatedContract.startDate,
      contractEndDate: updatedContract.endDate,
      contractNotes: updatedContract.notes,
    };
    const updated = await service.updateEmployee(employeeId, revisedDraft, 1);
    expect(updated).toMatchObject({ ok: true, data: { version: 2, contract: updatedContract } });

    const reread = await service.getEmployee(employeeId);
    expect(reread.contract).toEqual(updatedContract);
    expect(employeeToDraft(reread)).toMatchObject({
      contractType: "续签合同",
      contractStartDate: "2027-02-01",
      contractEndDate: "2028-01-31",
      contractNotes: "虚构修改后的合同",
    });

    for (const callIndex of [0, 1]) {
      const payload = callFunctionMock.mock.calls[callIndex][0].data;
      expect(payload.contract).toMatchObject({ type: expect.any(String), startDate: expect.any(String), endDate: expect.any(String) });
      expect(payload).not.toHaveProperty("contractType");
      expect(payload).not.toHaveProperty("contractStartDate");
      expect(payload).not.toHaveProperty("contractEndDate");
      expect(payload).not.toHaveProperty("contractNotes");
    }
    expect(callFunctionMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: "employeeArchiveApi",
      data: expect.objectContaining({ route: "employees/create", contract: expect.objectContaining({ type: "当前合同" }) }),
    }));
    expect(callFunctionMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: "employeeArchiveApi",
      data: expect.objectContaining({
        route: "employees/update",
        employeeId,
        expectedVersion: 1,
        contract: {
          type: updatedContract.type,
          startDate: updatedContract.startDate,
          endDate: updatedContract.endDate,
          notes: updatedContract.notes,
        },
      }),
    }));
  });

  it("passes expectedVersion to employees/update", async () => {
    callFunctionMock.mockResolvedValue({ result: { ok: true, data: { id: "emp-1001", version: 8 } } });
    const service = new CloudFunctionDataService();
    const draft = makeDraft("示例员工甲");
    const { contractType, contractStartDate, contractEndDate, contractNotes } = draft;
    const cloudDraft = Object.fromEntries(
      Object.entries(draft).filter(([field]) => ![
        "contractType", "contractStartDate", "contractEndDate", "contractNotes",
        "vehicleModel", "vehiclePlateNumber", "vehicleStartDate", "vehicleEndDate", "vehicleNotes",
      ].includes(field)),
    );

    await service.updateEmployee("emp-1001", draft, 7);

    expect(callFunctionMock).toHaveBeenCalledWith({
      name: "employeeArchiveApi",
      data: {
        route: "employees/update",
        employeeId: "emp-1001",
        expectedVersion: 7,
        ...cloudDraft,
        contract: {
          type: contractType,
          startDate: contractStartDate,
          endDate: contractEndDate,
          notes: contractNotes,
        },
        vehicle: null,
      },
    });
  });
});
