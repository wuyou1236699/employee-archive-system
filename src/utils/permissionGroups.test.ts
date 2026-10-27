import { describe, expect, it } from "vitest";
import type { AccountPermission } from "../types";
import { getBusinessPermissionSummary, getPermissionGroupState, getPermissionGroupStateLabel, PERMISSION_GROUPS } from "./permissionGroups";

describe("permission groups", () => {
  it("maps the employee archive group to all of its existing backend permissions", () => {
    expect(PERMISSION_GROUPS[0]).toMatchObject({
      id: "employee_archive_edit",
      label: "员工档案编辑",
      permissions: ["employee.write", "history.write", "attachment.read", "attachment.write"],
    });
    expect(PERMISSION_GROUPS[1]).toMatchObject({
      id: "monthly_assessment_edit",
      label: "月度考核编辑",
      permissions: ["monthly_assessment_edit"],
    });
    expect(PERMISSION_GROUPS.flatMap((group) => group.permissions)).not.toContain("audit.read");
  });

  it("distinguishes disabled, partially granted, and fully granted groups", () => {
    const employeeGroup = PERMISSION_GROUPS[0];
    const onePermission: AccountPermission[] = ["employee.write"];
    expect(getPermissionGroupState("admin", [], employeeGroup)).toBe("disabled");
    expect(getPermissionGroupState("admin", onePermission, employeeGroup)).toBe("partial");
    expect(getPermissionGroupState("admin", [...employeeGroup.permissions], employeeGroup)).toBe("enabled");
    expect(getPermissionGroupStateLabel("partial")).toBe("部分授权");
  });

  it("treats a super administrator as fully enabled without exposing technical permissions", () => {
    expect(getPermissionGroupState("super_admin", [], PERMISSION_GROUPS[0])).toBe("all");
    expect(getBusinessPermissionSummary("super_admin", [])).toBe("全部权限");
    expect(getBusinessPermissionSummary("admin", ["employee.write"])).toBe("员工档案编辑（部分授权）");
    expect(getBusinessPermissionSummary("admin", ["audit.read"])).toBe("仅查看");
  });
});
