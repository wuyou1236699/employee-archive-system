import { Activity, ArrowDownRight, CheckCircle2, CircleAlert, Filter, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditFilters, AuditLog, AuditResult } from "../types";
import { toUserFacingServiceError, type AsyncEmployeeDataService, type EmployeeDataService } from "../services/dataService";
import { getAuditActionLabel, getAuditDetail, formatTimestamp, maskPhone } from "../utils/labels";

type AuditPageDataService = EmployeeDataService | AsyncEmployeeDataService;

interface AuditPageProps {
  data: AuditPageDataService;
}

const EMPTY_FILTERS: AuditFilters = {
  action: "all",
  result: "all",
  employeeName: "",
};

function getErrorMessage(error: unknown, fallback: string): string {
  return toUserFacingServiceError(error, fallback);
}

function getDisplayActionLabel(log: AuditLog): string {
  if (log.action === "materialize_monthly_assessment_targets") return "准备月度考核对象";
  return getAuditActionLabel(log.action);
}

function getDisplayDetail(log: AuditLog): string {
  return getAuditDetail(log);
}

function auditResultLabel(result: AuditResult): string {
  if (result === "success") return "成功";
  if (result === "failure") return "失败";
  return "未确认";
}

type AuditSnapshot = Record<string, unknown>;

const AUDIT_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  name: "姓名",
  department: "部门",
  status: "状态",
  onlyChildStatus: "是否独生子女",
  personalPhone: "个人手机号",
  workPhone: "工作电话",
  phonePlan: "电话套餐",
  phoneOwnership: "电话归属",
  computerOwnership: "电脑归属",
  hireDate: "入职日期",
  regularizationDate: "转正日期",
  contractEndDate: "合同结束日期",
  plateNumber: "车辆车牌",
  displayName: "显示名称",
  username: "账号名称",
  role: "账号角色",
  monthKey: "考核月份",
  note: "整体评价说明",
  courseName: "课程名称",
  eventDate: "事件日期",
  summary: "事件说明",
  fileName: "附件名称",
});

const AUDIT_FIELD_ORDER = [
  "name",
  "displayName",
  "username",
  "department",
  "status",
  "role",
  "onlyChildStatus",
  "personalPhone",
  "workPhone",
  "phonePlan",
  "phoneOwnership",
  "computerOwnership",
  "hireDate",
  "regularizationDate",
  "contractEndDate",
  "plateNumber",
  "monthKey",
  "courseName",
  "eventDate",
  "summary",
  "fileName",
  "note",
] as const;

const AUDIT_LABEL_TO_KEY: Readonly<Record<string, string>> = Object.freeze({
  姓名: "name",
  部门: "department",
  状态: "status",
  是否独生子女: "onlyChildStatus",
  个人手机号: "personalPhone",
  工作电话: "workPhone",
  电话套餐: "phonePlan",
  电话归属: "phoneOwnership",
  电脑归属: "computerOwnership",
  入职日期: "hireDate",
  转正日期: "regularizationDate",
  合同结束日期: "contractEndDate",
  车辆车牌: "plateNumber",
  显示名称: "displayName",
  账号名称: "username",
  账号角色: "role",
  角色: "role",
  账号状态: "status",
  考核月份: "monthKey",
  整体评价说明: "note",
  课程名称: "courseName",
  事件日期: "eventDate",
  事件说明: "summary",
  附件名称: "fileName",
});

const EMPLOYEE_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  active: "在职",
  inactive: "离职",
  archived: "已归档",
});

const STUDENT_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  active: "在册",
  inactive: "不在册",
});

const ACCOUNT_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  active: "启用",
  disabled: "停用",
});

const ACCOUNT_ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  super_admin: "总管理员",
  admin: "管理员",
  user: "只读用户",
});

const MONTHLY_RESULT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  achieved: "已达成",
  not_achieved: "未达成",
  unassessed: "未评价",
});

const MONTHLY_RESULT_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  meeting: "月度参会",
  renewalRate: "月度续费率",
  influence: "月度感召",
  visits: "月度走访",
  nineGrid: "月度九宫格考核",
});

function asAuditSnapshot(value: AuditLog["before"] | AuditLog["after"]): AuditSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as unknown as AuditSnapshot;
}

function isBlankAuditValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function getAuditFieldLabel(key: string): string | null {
  return AUDIT_FIELD_LABELS[key] ?? null;
}

function getAuditFieldOrder(key: string): number {
  const index = AUDIT_FIELD_ORDER.indexOf(key as (typeof AUDIT_FIELD_ORDER)[number]);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function normalizeAuditField(field: string): string | null {
  const trimmed = field.trim();
  if (getAuditFieldLabel(trimmed)) return trimmed;
  return AUDIT_LABEL_TO_KEY[trimmed] ?? null;
}

function formatAuditValue(value: unknown, key: string, log: AuditLog): string | null {
  if (isBlankAuditValue(value)) return "未填写";
  if (key === "personalPhone" || key === "workPhone") return maskPhone(String(value));
  if (key === "status") {
    if (log.targetType === "student") return STUDENT_STATUS_LABELS[String(value)] ?? String(value);
    const labels = log.targetType === "account" || log.action.includes("account")
      ? ACCOUNT_STATUS_LABELS
      : EMPLOYEE_STATUS_LABELS;
    return labels[String(value)] ?? String(value);
  }
  if (key === "role") return ACCOUNT_ROLE_LABELS[String(value)] ?? String(value);
  if (key in MONTHLY_RESULT_FIELDS) return MONTHLY_RESULT_LABELS[String(value)] ?? String(value);
  if (key === "monthKey" && typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) {
    return value.replace("-", "年") + "月";
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return null;
}

function getVisibleAuditKeys(log: AuditLog, before: AuditSnapshot, after: AuditSnapshot): string[] {
  const keys = new Set<string>();
  log.changedFields.forEach((field) => {
    const key = normalizeAuditField(field);
    if (key) keys.add(key);
  });
  if (!keys.size) {
    [...Object.keys(before), ...Object.keys(after)].forEach((key) => {
      if (getAuditFieldLabel(key)) keys.add(key);
    });
  }
  return [...keys].sort((left, right) => getAuditFieldOrder(left) - getAuditFieldOrder(right));
}

function getSnapshotChangeDescriptions(log: AuditLog, before: AuditSnapshot, after: AuditSnapshot): string[] {
  return getVisibleAuditKeys(log, before, after).flatMap((key) => {
    const label = getAuditFieldLabel(key);
    if (!label) return [];
    const beforeText = formatAuditValue(before[key], key, log);
    const afterText = formatAuditValue(after[key], key, log);
    if (!beforeText || !afterText || beforeText === afterText) return [];
    return [`${label}：${beforeText} → ${afterText}`];
  });
}

function getActionSpecificChangeDescriptions(log: AuditLog, after: AuditSnapshot): string[] | null {
  const targetName = log.targetNameSnapshot?.trim();
  const getAfterText = (key: string): string | null => formatAuditValue(after[key], key, log);
  switch (log.action) {
    case "create_employee":
      return targetName ? [`新增员工档案：${targetName}`] : null;
    case "create_student":
      return targetName ? [`新增学员档案：${targetName}`] : null;
    case "register_account":
      return targetName ? [`注册账号：${targetName}`] : null;
    case "add_course": {
      const courseName = getAfterText("courseName");
      return [courseName && courseName !== "未填写" ? `新增课程记录：${courseName}` : "新增课程记录"];
    }
    case "add_event": {
      const summary = getAfterText("summary");
      return [summary && summary !== "未填写" ? `新增特殊事件：${summary}` : "新增特殊事件"];
    }
    case "add_attachment": {
      const fileName = getAfterText("fileName");
      return [fileName && fileName !== "未填写" ? `新增员工附件：${fileName}` : "新增员工附件"];
    }
    case "view_attachment":
      return [];
    case "grant_account_permissions":
      return ["权限已授予（具体范围见业务说明）"];
    case "revoke_account_permissions":
      return ["权限已收回（具体范围见业务说明）"];
    default:
      return null;
  }
}

function getAuditChangeDescriptions(log: AuditLog): string[] {
  const before = asAuditSnapshot(log.before);
  const after = asAuditSnapshot(log.after);
  const specific = getActionSpecificChangeDescriptions(log, after);
  if (specific) return specific;

  const descriptions = getSnapshotChangeDescriptions(log, before, after);
  if (descriptions.length) return descriptions;

  const monthlyResults = after.results && typeof after.results === "object" && !Array.isArray(after.results)
    ? after.results as Record<string, unknown>
    : null;
  const previousMonthlyResults = before.results && typeof before.results === "object" && !Array.isArray(before.results)
    ? before.results as Record<string, unknown>
    : null;
  if (monthlyResults || previousMonthlyResults) {
    const monthlyDescriptions = Object.keys(MONTHLY_RESULT_FIELDS).flatMap((key) => {
      const beforeText = formatAuditValue(previousMonthlyResults?.[key], key, log);
      const afterText = formatAuditValue(monthlyResults?.[key], key, log);
      if (!beforeText || !afterText || beforeText === afterText) return [];
      return [`${MONTHLY_RESULT_FIELDS[key]}：${beforeText} → ${afterText}`];
    });
    if (monthlyDescriptions.length) return monthlyDescriptions;
  }
  return [];
}

export function AuditPage({ data }: AuditPageProps) {
  const [filters, setFilters] = useState<AuditFilters>({ ...EMPTY_FILTERS });
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const { action, result, employeeName } = filters;

  useEffect(() => {
    let cancelled = false;

    async function loadLogs() {
      setIsLoading(true);
      setError(null);
      try {
        const nextLogs = await data.listAuditLogs({ action, result, employeeName });
        if (!cancelled) setLogs(nextLogs.filter((log) => log.action !== "view_student_detail"));
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError, "读取操作日志失败。"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadLogs();
    return () => {
      cancelled = true;
    };
  }, [action, data, employeeName, reloadToken, result]);

  const hasFilters = Boolean(filters.employeeName || filters.action !== "all" || filters.result !== "all");

  function clearFilters() {
    setFilters({ ...EMPTY_FILTERS });
  }

  function retry() {
    setReloadToken((value) => value + 1);
  }

  return (
    <div className="page-frame audit-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">操作记录</span>
          <h1>操作日志</h1>
        </div>
        <div className="page-header-actions">
          <div className="audit-count"><Activity size={16} /><strong>{isLoading ? "—" : logs.length}</strong><span>条记录</span></div>
        </div>
      </header>

      <section className="audit-workspace">
        <aside className="audit-filter-panel">
          <div className="rail-heading"><div><span className="eyebrow">筛选范围</span><h2>日志筛选</h2></div><Filter size={18} /></div>
          <label className="search-box"><Search size={17} /><input aria-label="按员工姓名筛选日志" placeholder="按员工姓名搜索" value={filters.employeeName} onChange={(event) => setFilters((current) => ({ ...current, employeeName: event.target.value }))} /></label>
          <label className="filter-select"><span className="filter-label">操作类型</span><select aria-label="按操作类型筛选日志" value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value as AuditFilters["action"] }))}><option value="all">全部操作</option><option value="initial_migration">历史资料导入</option><option value="update_account_display_name">修改显示名称</option><option value="register_account">注册账号</option><option value="update_account_role">调整账号角色</option><option value="grant_account_permissions">授予账号权限</option><option value="revoke_account_permissions">收回账号权限</option><option value="reset_account_password">重置账号密码</option><option value="disable_account">停用账号</option><option value="restore_account">恢复账号</option><option value="materialize_monthly_assessment_targets">准备月度考核对象</option><option value="save_monthly_assessment">保存月度考核</option><option value="create_employee">新增员工</option><option value="update_employee">修改员工</option><option value="create_student">新增学员</option><option value="update_student">修改学员</option><option value="archive_student">归档学员</option><option value="restore_student">恢复学员</option><option value="add_course">新增课程记录</option><option value="add_event">新增事件记录</option><option value="add_attachment">上传员工附件</option><option value="view_attachment">查看附件图片</option></select></label>
          <label className="filter-select"><span className="filter-label">执行结果</span><select aria-label="按执行结果筛选日志" value={filters.result} onChange={(event) => setFilters((current) => ({ ...current, result: event.target.value as AuditResult | "all" }))}><option value="all">全部结果</option><option value="success">成功</option><option value="failure">失败</option><option value="unknown">未确认</option></select></label>
          <div className="rail-divider" />
          {hasFilters ? <button className="clear-filter-button" type="button" onClick={clearFilters}><Filter size={14} />重置筛选条件</button> : null}
        </aside>

        <div className="audit-list-panel">
          <div className="list-toolbar"><div><span className="eyebrow">操作记录 / {isLoading ? "--" : logs.length.toString().padStart(2, "0")}</span><strong>业务行为记录</strong></div><span className="toolbar-meta">点击记录查看变更摘要 <ArrowDownRight size={14} /></span></div>
          {isLoading ? <div className="empty-list" aria-live="polite"><LoaderCircle size={34} /><h2>正在加载操作日志</h2><p>请稍候，正在读取操作记录。</p></div> : error ? <div className="empty-list" role="alert"><CircleAlert size={34} /><h2>操作日志加载失败</h2><p>{error}</p><button className="secondary-button" type="button" onClick={retry}>重试</button></div> : logs.length ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>时间</th><th>操作账号</th><th>行为</th><th>目标对象</th><th>结果</th><th /></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className={selectedLog?.id === log.id ? "is-selected" : ""}>
            <td data-label="时间"><span className="timestamp">{formatTimestamp(log.createdAt)}</span></td>
            <td data-label="操作账号"><span className="actor-cell"><span className="actor-mark">{log.actorNameSnapshot.slice(0, 1)}</span>{log.actorNameSnapshot}</span></td>
            <td data-label="行为"><button className="audit-action-button" type="button" onClick={() => setSelectedLog(log)}><strong>{getDisplayActionLabel(log)}</strong><span>{getDisplayDetail(log)}</span></button></td>
            <td data-label="目标对象">{log.targetNameSnapshot ?? <span className="muted-text">系统操作</span>}</td>
            <td data-label="结果"><span className={`result-pill result-${log.result}`}>{log.result === "success" ? <CheckCircle2 size={14} /> : log.result === "failure" ? <CircleAlert size={14} /> : <Activity size={14} />}{auditResultLabel(log.result)}</span></td>
            <td data-label="打开"><button className="row-open-button" type="button" aria-label="查看日志详情" onClick={() => setSelectedLog(log)}><ArrowDownRight size={17} /></button></td>
          </tr>)}</tbody></table></div> : <div className="empty-list"><Activity size={34} /><h2>暂无匹配日志</h2><p>暂无操作记录。</p><button className="secondary-button" type="button" onClick={clearFilters}>重置筛选</button></div>}
        </div>
      </section>

      {selectedLog ? <AuditDetailDrawer log={selectedLog} onClose={() => setSelectedLog(null)} /> : null}
    </div>
  );
}

function AuditDetailDrawer({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  const changeDescriptions = getAuditChangeDescriptions(log);
  return (
    <aside className="audit-detail-drawer" aria-label="操作日志详情">
      <header className="drawer-header"><div className="drawer-topline"><span className="eyebrow">操作记录详情</span><button className="icon-button" type="button" aria-label="关闭日志详情" onClick={onClose}><X size={19} /></button></div><h2>{getDisplayActionLabel(log)}</h2><p className="drawer-subtitle">{formatTimestamp(log.createdAt)} · {log.actorNameSnapshot}</p></header>
      <div className="audit-detail-body">
        <div className="audit-detail-grid"><div><span>{log.targetType === "account" ? "目标账号" : "目标员工"}</span><strong>{log.targetNameSnapshot ?? "系统操作"}</strong></div><div><span>执行结果</span><strong>{auditResultLabel(log.result)}</strong></div><div><span>操作类型</span><strong>{getDisplayActionLabel(log)}</strong></div><div><span>操作账号</span><strong>{log.actorUsername || log.actorNameSnapshot || "系统操作"}</strong></div></div>
        <section className="change-section"><div className="change-section-heading"><span>变化说明</span></div>{changeDescriptions.length ? <div className="change-tags">{changeDescriptions.map((description) => <span key={description}>{description}</span>)}</div> : <p className="muted-text">本次操作没有可展示的具体变化</p>}</section>
        <div className="audit-detail-description"><span>业务说明</span><p>{getDisplayDetail(log)}</p></div>
      </div>
    </aside>
  );
}
