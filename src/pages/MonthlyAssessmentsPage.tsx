import { ArrowDownRight, CheckCircle2, ClipboardCheck, Filter, LoaderCircle, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  MonthlyAssessmentFilters,
  MonthlyAssessmentMetric,
  MonthlyAssessmentOverview,
  MonthlyAssessmentStatus,
} from "../types";
import { toUserFacingServiceError, type AsyncEmployeeDataService, type EmployeeDataService } from "../services/dataService";

type MonthlyPageDataService = EmployeeDataService | AsyncEmployeeDataService;

interface MonthlyAssessmentsPageProps {
  data: MonthlyPageDataService;
  canEdit: boolean;
}

const MONTHLY_METRICS: Array<{ value: MonthlyAssessmentMetric; label: string }> = [
  { value: "meeting", label: "月度参会" },
  { value: "renewalRate", label: "月度续费率" },
  { value: "influence", label: "月度感召" },
  { value: "visits", label: "月度走访" },
  { value: "nineGrid", label: "月度九宫格考核" },
];

const MONTHLY_STATUS_OPTIONS: Array<{ value: MonthlyAssessmentStatus; label: string }> = [
  { value: "achieved", label: "达成" },
  { value: "not_achieved", label: "未达成" },
  { value: "unassessed", label: "未评价" },
];

function getCurrentMonthKey(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

function formatMonthLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return "当前月份";
  return `${match[1]}年${Number(match[2])}月`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return toUserFacingServiceError(error, fallback);
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function statusLabel(status: MonthlyAssessmentStatus): string {
  return MONTHLY_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "未评价";
}

function statusClass(status: MonthlyAssessmentStatus): string {
  return `monthly-status monthly-status-${status}`;
}

const EMPTY_OVERVIEW: MonthlyAssessmentOverview = {
  items: [],
  page: 1,
  pageSize: 50,
  total: 0,
  stats: {
    eligibleActiveCount: 0,
    fullyEvaluatedCount: 0,
    partiallyEvaluatedCount: 0,
    unassessedCount: 0,
    metrics: {
      meeting: { achieved: 0, not_achieved: 0, unassessed: 0, achievementRate: null },
      renewalRate: { achieved: 0, not_achieved: 0, unassessed: 0, achievementRate: null },
      influence: { achieved: 0, not_achieved: 0, unassessed: 0, achievementRate: null },
      visits: { achieved: 0, not_achieved: 0, unassessed: 0, achievementRate: null },
      nineGrid: { achieved: 0, not_achieved: 0, unassessed: 0, achievementRate: null },
    },
  },
};

export function MonthlyAssessmentsPage({ data, canEdit }: MonthlyAssessmentsPageProps) {
  const currentMonthKey = useMemo(() => getCurrentMonthKey(), []);
  const [filters, setFilters] = useState<MonthlyAssessmentFilters>({
    monthKey: currentMonthKey,
    keyword: "",
    department: "all",
    metric: "all",
    metricStatus: "all",
    page: 1,
    pageSize: 50,
  });
  const [overview, setOverview] = useState<MonthlyAssessmentOverview>(EMPTY_OVERVIEW);
  const [departments, setDepartments] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(data.getDepartments())
      .then((nextDepartments) => {
        if (!cancelled) setDepartments(nextDepartments);
      })
      .catch(() => {
        if (!cancelled) setDepartments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void Promise.resolve(data.getMonthlyAssessmentOverview(filters))
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setOverview(EMPTY_OVERVIEW);
          setError(result.message);
          return;
        }
        setOverview(result.data);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setOverview(EMPTY_OVERVIEW);
          setError(getErrorMessage(loadError, "读取月度考核总览失败。"));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, filters, reloadToken]);

  function updateFilter<K extends keyof MonthlyAssessmentFilters>(key: K, value: MonthlyAssessmentFilters[K]): void {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }

  function clearFilters(): void {
    setFilters({
      monthKey: currentMonthKey,
      keyword: "",
      department: "all",
      metric: "all",
      metricStatus: "all",
      page: 1,
      pageSize: 50,
    });
  }

  function openEmployee(employeeId: string): void {
    window.location.hash = `#/employees?employeeId=${encodeURIComponent(employeeId)}&monthKey=${encodeURIComponent(filters.monthKey)}`;
  }

  const hasFilters = Boolean(filters.keyword || filters.department !== "all" || filters.metric !== "all" || filters.metricStatus !== "all" || filters.monthKey !== currentMonthKey);

  return (
    <div className="page-frame monthly-assessment-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">月度考核</span>
          <h1>月度考核总览</h1>
        </div>
        <div className="page-header-actions">
          <div className="assessment-count"><ClipboardCheck size={16} /><strong>{isLoading ? "—" : overview.total}</strong><span>名考核对象</span></div>
          <span className="permission-readout">{canEdit ? "当前账号可编辑" : "当前账号为只读"}</span>
        </div>
      </header>

      <section className="monthly-assessment-workspace">
        <aside className="monthly-filter-panel">
          <div className="rail-heading"><div><span className="eyebrow">筛选条件</span><h2>考核筛选</h2></div><Filter size={18} /></div>
          <label className="filter-select"><span className="filter-label">考核月份</span><input aria-label="选择考核月份" type="month" max={currentMonthKey} value={filters.monthKey} onChange={(event) => updateFilter("monthKey", event.target.value)} /></label>
          <label className="search-box"><Search size={17} /><input aria-label="按员工或部门搜索月度考核" placeholder="按员工或部门搜索" value={filters.keyword} onChange={(event) => updateFilter("keyword", event.target.value)} /></label>
          <label className="filter-select"><span className="filter-label">部门 / 分组</span><select aria-label="按部门筛选月度考核" value={filters.department} onChange={(event) => updateFilter("department", event.target.value)}><option value="all">全部部门</option>{departments.map((department) => <option value={department} key={department}>{department}</option>)}</select></label>
          <label className="filter-select"><span className="filter-label">指标</span><select aria-label="按指标筛选月度考核" value={filters.metric} onChange={(event) => updateFilter("metric", event.target.value as MonthlyAssessmentFilters["metric"])}><option value="all">全部指标</option>{MONTHLY_METRICS.map((metric) => <option value={metric.value} key={metric.value}>{metric.label}</option>)}</select></label>
          <label className="filter-select"><span className="filter-label">状态</span><select aria-label="按状态筛选月度考核" value={filters.metricStatus} onChange={(event) => updateFilter("metricStatus", event.target.value as MonthlyAssessmentFilters["metricStatus"])}><option value="all">全部状态</option>{MONTHLY_STATUS_OPTIONS.map((status) => <option value={status.value} key={status.value}>{status.label}</option>)}</select></label>
          <div className="rail-divider" />
          {hasFilters ? <button className="clear-filter-button" type="button" onClick={clearFilters}><Filter size={14} />重置筛选条件</button> : null}
        </aside>

        <div className="monthly-assessment-list-panel">
          <div className="list-toolbar"><div><span className="eyebrow">{formatMonthLabel(filters.monthKey)} · {isLoading ? "正在统计" : `共 ${overview.total} 人`}</span><strong>考核对象明细</strong></div><span className="toolbar-meta">姓名可打开员工详情 <ArrowDownRight size={14} /></span></div>
          <MonthlyStats overview={overview} />
          {isLoading ? <div className="empty-list" aria-live="polite"><LoaderCircle size={34} /><h2>正在加载月度考核</h2><p>请稍候，正在读取考核记录。</p></div> : error ? <div className="empty-list" role="alert"><ShieldAlert size={34} /><h2>月度考核加载失败</h2><p>{error}</p><button className="secondary-button" type="button" onClick={() => setReloadToken((value) => value + 1)}>重试</button></div> : overview.items.length ? <div className="monthly-assessment-table-wrap"><table className="monthly-assessment-table"><thead><tr><th>员工</th><th>部门</th>{MONTHLY_METRICS.map((metric) => <th key={metric.value}>{metric.label}</th>)}<th>填写进度</th></tr></thead><tbody>{overview.items.map((item) => <tr key={item.employeeId}>
            <td data-label="员工"><button className="monthly-employee-button" type="button" onClick={() => openEmployee(item.employeeId)}><strong>{item.employeeName}</strong><small>{item.hasRecord ? "已填写" : "尚未填写"}</small></button></td>
            <td data-label="部门">{item.department || "未填写"}</td>
            {MONTHLY_METRICS.map((metric) => <td data-label={metric.label} key={metric.value}><span className={statusClass(item.results[metric.value])}>{statusLabel(item.results[metric.value])}</span></td>)}
            <td data-label="填写进度"><span className="monthly-progress">{item.filledCount} / 5</span></td>
          </tr>)}</tbody></table></div> : <div className="empty-list monthly-assessment-empty"><ClipboardCheck size={34} /><h2>暂无月度考核对象</h2><p>当前没有可展示的考核对象。</p><button className="secondary-button" type="button" onClick={clearFilters}>重置筛选</button></div>}
        </div>
      </section>
    </div>
  );
}

function MonthlyStats({ overview }: { overview: MonthlyAssessmentOverview }) {
  return (
    <>
      <section className="monthly-summary-strip" aria-label="月度考核统计摘要">
        <div className="monthly-summary-card"><span>在职考核对象</span><strong>{overview.stats.eligibleActiveCount}</strong><small>当前筛选结果</small></div>
        <div className="monthly-summary-card monthly-summary-card-green"><span>五项全部评价</span><strong>{overview.stats.fullyEvaluatedCount}</strong><small>已完成全部指标</small></div>
        <div className="monthly-summary-card monthly-summary-card-rust"><span>部分评价</span><strong>{overview.stats.partiallyEvaluatedCount}</strong><small>至少填写一项</small></div>
        <div className="monthly-summary-card monthly-summary-card-muted"><span>尚未评价</span><strong>{overview.stats.unassessedCount}</strong><small>五项均未填写</small></div>
      </section>
      <section className="monthly-metric-strip" aria-label="五项指标统计">
        {MONTHLY_METRICS.map((metric) => {
          const stats = overview.stats.metrics[metric.value];
          return <article className="monthly-metric-card" key={metric.value}>
            <div className="monthly-metric-heading"><span>{metric.label}</span><strong>{formatRate(stats.achievementRate)}</strong></div>
            <div className="monthly-metric-values"><span className="monthly-metric-value monthly-metric-value-achieved"><CheckCircle2 size={13} />达成 {stats.achieved}</span><span className="monthly-metric-value monthly-metric-value-not-achieved">未达成 {stats.not_achieved}</span><span className="monthly-metric-value monthly-metric-value-unassessed">未评价 {stats.unassessed}</span></div>
          </article>;
        })}
      </section>
    </>
  );
}
