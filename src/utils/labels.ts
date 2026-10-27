import type { AuditLog, CourseStatus, EmployeeStatus, ExpiryStatus } from "../types";

export function getEmployeeStatusLabel(status: EmployeeStatus): string {
  return status === "active" ? "在职" : "离职";
}

export function getCourseStatusLabel(status: CourseStatus): string {
  const labels: Record<CourseStatus, string> = {
    completed: "已完成",
    incomplete: "未完成",
    partial: "部分记录",
    unknown: "未知",
    not_applicable: "不适用",
  };
  return labels[status];
}

export function getExpiryStatusLabel(status: ExpiryStatus): string {
  const labels: Record<ExpiryStatus, string> = {
    normal: "有效期正常",
    soon: "即将到期",
    expired: "已到期",
    missing: "日期缺失",
  };
  return labels[status];
}

const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
    preview_login: "进入预览",
    preview_logout: "退出预览",
    update_display_name: "修改显示名称",
    update_account_display_name: "修改显示名称",
    create_employee: "新增员工",
    create_student: "新增学员",
    update_student: "修改学员",
    archive_student: "归档学员",
    restore_student: "恢复学员",
    update_employee: "修改员工",
    archive_employee: "归档员工",
    initial_import: "历史资料导入",
    initial_migration: "历史资料导入",
    add_course: "新增课程记录",
    add_event: "新增事件记录",
    add_attachment: "上传员工附件",
    view_attachment: "查看附件图片",
    view_audit: "查看操作日志",
    register_account: "注册账号",
    update_account_role: "调整账号角色",
    grant_account_permissions: "授予账号权限",
    revoke_account_permissions: "收回账号权限",
    reset_account_password: "重置账号密码",
    disable_account: "停用账号",
    restore_account: "恢复账号",
    save_monthly_assessment: "保存月度考核",
    materialize_monthly_assessment_targets: "准备月度考核对象",
    save_quarterly_draft: "保存季度评价草稿",
    submit_quarterly_review: "提交季度评价",
    return_quarterly_review: "退回季度评价",
    void_quarterly_review: "作废季度评价",
    save_quarterly_period: "保存季度周期",
    save_quarterly_task: "保存季度评价任务",
    bind_quarterly_relation_student: "绑定季度评价学员身份",
    bind_account_employee: "绑定账号身份",
});

export function getAuditActionLabel(action: unknown): string {
  if (typeof action !== "string") return "其他操作";
  return AUDIT_ACTION_LABELS[action] ?? "其他操作";
}

export function getAuditDetail(log: Pick<AuditLog, "action" | "detail">): string {
  return typeof log.detail === "string" ? log.detail : "";
}

export function maskPhone(value: string): string {
  if (!value) {
    return "未填写";
  }
  if (/^\d{3}\*{4}\d{4}$/.test(value)) {
    return value;
  }
  if (value.length < 7) {
    return "已隐藏";
  }
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

export function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
