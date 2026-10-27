import type { AccountPermission, AccountRole } from "../types";

export type PermissionGroupId = "employee_archive_edit" | "monthly_assessment_edit" | "quarterly_manage";
export type PermissionGroupState = "all" | "enabled" | "partial" | "disabled";

export interface PermissionGroupDefinition {
  id: PermissionGroupId;
  label: string;
  description: string;
  permissions: AccountPermission[];
}

export const PERMISSION_GROUPS: PermissionGroupDefinition[] = [
  {
    id: "employee_archive_edit",
    label: "员工档案编辑",
    description: "新增、编辑、归档员工档案，维护培训与事件记录，以及查看和上传附件。",
    permissions: ["employee.write", "history.write", "attachment.read", "attachment.write"],
  },
  {
    id: "monthly_assessment_edit",
    label: "月度考核编辑",
    description: "填写和修改月度考核结果及整体评价说明。",
    permissions: ["monthly_assessment_edit"],
  },
  {
    id: "quarterly_manage",
    label: "季度评价管理",
    description: "维护季度周期、评价关系，查看记录并执行退回或作废。",
    permissions: ["quarterly.manage"],
  },
];

export function getPermissionGroupState(
  role: AccountRole,
  permissions: AccountPermission[],
  group: PermissionGroupDefinition,
): PermissionGroupState {
  if (role === "super_admin") return "all";
  const grantedCount = group.permissions.filter((permission) => permissions.includes(permission)).length;
  if (grantedCount === 0) return "disabled";
  if (grantedCount === group.permissions.length) return "enabled";
  return "partial";
}

export function getPermissionGroupStateLabel(state: PermissionGroupState): string {
  if (state === "all") return "总管理员自动拥有";
  if (state === "enabled") return "已启用";
  if (state === "partial") return "部分授权";
  return "未启用";
}

export function getBusinessPermissionSummary(role: AccountRole, permissions: AccountPermission[]): string {
  if (role === "super_admin") return "全部权限";
  const enabledGroups = PERMISSION_GROUPS.flatMap((group) => {
    const state = getPermissionGroupState(role, permissions, group);
    if (state === "enabled") return [group.label];
    if (state === "partial") return [`${group.label}（部分授权）`];
    return [];
  });
  return enabledGroups.length ? enabledGroups.join("、") : "仅查看";
}
