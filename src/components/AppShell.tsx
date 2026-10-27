import { useState, type ReactNode } from "react";
import { Activity, ArrowRightLeft, BookOpenText, ClipboardCheck, ClipboardPenLine, LogOut, Menu, ShieldCheck, UserCog, UsersRound, X } from "lucide-react";
import type { Session } from "../types";
import { getBusinessPermissionSummary } from "../utils/permissionGroups";

export type AppPage = "employees" | "monthly-assessments" | "quarterly" | "audit" | "accounts";

function getRoleLabel(role: Session["role"]): string {
  if (role === "super_admin") return "总管理员";
  if (role === "admin") return "管理员";
  return "普通用户";
}

interface AppShellProps {
  page: AppPage;
  session: Session;
  onNavigate: (page: AppPage) => void;
  onSwitchAccount: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  children: ReactNode;
}

export function AppShell({ page, session, onNavigate, onSwitchAccount, onSignOut, children }: AppShellProps) {
  const [isAccountPanelOpen, setIsAccountPanelOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const accountId = session.accountId.trim();
  const visibleDisplayName = session.displayName.trim() && session.displayName.trim() !== accountId ? session.displayName.trim() : "已登录用户";
  const visibleUsername = session.username.trim() && session.username.trim() !== accountId ? session.username.trim() : "已登录账号";

  function runAccountAction(action: () => void | Promise<void>): void {
    setIsAccountPanelOpen(false);
    setIsMobileNavOpen(false);
    void action();
  }

  function navigateFromMobile(nextPage: AppPage): void {
    setIsMobileNavOpen(false);
    onNavigate(nextPage);
  }

  return (
    <div className="app-shell">
      <header className="mobile-topbar">
        <button
          className="mobile-topbar-button"
          type="button"
          aria-label="打开主导航"
          aria-expanded={isMobileNavOpen}
          onClick={() => setIsMobileNavOpen(true)}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="mobile-topbar-title">
           <span className="brand-kicker">员工管理系统</span>
          <strong>员工档案</strong>
        </div>
        <button
          className="mobile-topbar-button"
          type="button"
          aria-label={`查看当前登录账号：${visibleDisplayName}`}
          onClick={() => setIsAccountPanelOpen(true)}
        >
          <ShieldCheck size={18} aria-hidden="true" />
        </button>
      </header>

      <aside className="app-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <BookOpenText size={22} strokeWidth={1.8} />
          </div>
          <div>
             <span className="brand-kicker">员工管理系统</span>
            <strong>员工档案</strong>
          </div>
        </div>

        <div className="sidebar-rule" />

        <nav className="primary-nav" aria-label="主导航">
          {session.role === "user" ? <button
            className={`nav-item ${page === "quarterly" ? "is-active" : ""}`}
            type="button"
            onClick={() => onNavigate("quarterly")}
          >
            <ClipboardPenLine size={17} />
            <span>我的评价</span>
          </button> : <>
          <button
            className={`nav-item ${page === "employees" ? "is-active" : ""}`}
            type="button"
            onClick={() => onNavigate("employees")}
          >
            <UsersRound size={17} />
            <span>员工档案</span>
          </button>
          <button
            className={`nav-item ${page === "audit" ? "is-active" : ""}`}
            type="button"
            onClick={() => onNavigate("audit")}
          >
            <Activity size={17} />
            <span>操作日志</span>
          </button>
          <button
            className={`nav-item ${page === "monthly-assessments" ? "is-active" : ""}`}
            type="button"
            onClick={() => onNavigate("monthly-assessments")}
          >
            <ClipboardCheck size={17} />
            <span>月度考核总览</span>
          </button>
          <button
            className={`nav-item ${page === "quarterly" ? "is-active" : ""}`}
            type="button"
            onClick={() => onNavigate("quarterly")}
          >
            <ClipboardPenLine size={17} />
            <span>季度评价</span>
          </button>
          {session.role === "super_admin" ? <button
            className={`nav-item ${page === "accounts" ? "is-active" : ""}`}
            type="button"
            onClick={() => onNavigate("accounts")}
          >
            <UserCog size={17} />
            <span>账号与权限</span>
          </button> : null}
          </>}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="account-chip account-chip-button"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isAccountPanelOpen}
            aria-label={`查看当前登录账号：${visibleDisplayName}`}
            onClick={() => setIsAccountPanelOpen(true)}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <span>当前登录账号</span>
              <strong>{visibleDisplayName}</strong>
              <small>登录账号：{visibleUsername}</small>
            </div>
          </button>
        </div>
      </aside>

      {isMobileNavOpen ? (
        <div className="mobile-nav-backdrop" role="presentation" onMouseDown={() => setIsMobileNavOpen(false)}>
          <aside className="mobile-nav-drawer" aria-label="移动端主导航" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mobile-nav-header">
              <div className="brand-lockup">
                <div className="brand-mark" aria-hidden="true">
                  <BookOpenText size={22} strokeWidth={1.8} />
                </div>
                <div>
                 <span className="brand-kicker">员工管理系统</span>
                  <strong>员工档案</strong>
                </div>
              </div>
              <button className="icon-button" type="button" aria-label="关闭主导航" onClick={() => setIsMobileNavOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <nav className="primary-nav" aria-label="移动端主导航">
              {session.role === "user" ? <button className={`nav-item ${page === "quarterly" ? "is-active" : ""}`} type="button" onClick={() => navigateFromMobile("quarterly")}>
                <ClipboardPenLine size={17} />
                <span>我的评价</span>
              </button> : <>
              <button className={`nav-item ${page === "employees" ? "is-active" : ""}`} type="button" onClick={() => navigateFromMobile("employees")}>
                <UsersRound size={17} />
                <span>员工档案</span>
              </button>
              <button className={`nav-item ${page === "audit" ? "is-active" : ""}`} type="button" onClick={() => navigateFromMobile("audit")}>
                <Activity size={17} />
                <span>操作日志</span>
              </button>
              <button className={`nav-item ${page === "monthly-assessments" ? "is-active" : ""}`} type="button" onClick={() => navigateFromMobile("monthly-assessments")}>
                <ClipboardCheck size={17} />
                <span>月度考核总览</span>
              </button>
              <button className={`nav-item ${page === "quarterly" ? "is-active" : ""}`} type="button" onClick={() => navigateFromMobile("quarterly")}>
                <ClipboardPenLine size={17} />
                <span>季度评价</span>
              </button>
              {session.role === "super_admin" ? <button className={`nav-item ${page === "accounts" ? "is-active" : ""}`} type="button" onClick={() => navigateFromMobile("accounts")}>
                <UserCog size={17} />
                <span>账号与权限</span>
              </button> : null}
              </>}
            </nav>

            <button
              className="account-chip account-chip-button mobile-nav-account"
              type="button"
              aria-label={`查看当前登录账号：${visibleDisplayName}`}
              onClick={() => {
                setIsMobileNavOpen(false);
                setIsAccountPanelOpen(true);
              }}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              <div>
                <span>当前登录账号</span>
                <strong>{visibleDisplayName}</strong>
                <small>登录账号：{visibleUsername}</small>
              </div>
            </button>
          </aside>
        </div>
      ) : null}

      {isAccountPanelOpen ? (
        <div className="account-panel-backdrop" role="presentation" onMouseDown={() => setIsAccountPanelOpen(false)}>
          <section
            className="account-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-panel-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="account-panel-header">
              <div>
                <span className="eyebrow">当前登录</span>
                <h2 id="account-panel-title">账号信息</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭账号信息"
                onClick={() => setIsAccountPanelOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="account-panel-body">
              <div className="account-panel-identity">
                <div className="account-panel-avatar" aria-hidden="true">
                  <ShieldCheck size={22} strokeWidth={1.8} />
                </div>
                <div>
                  <span className="eyebrow">当前账号</span>
                  <strong>{visibleDisplayName}</strong>
                  <small>{getRoleLabel(session.role)}</small>
                </div>
              </div>

              <div className="account-panel-details">
                <div>
                  <span>显示名称</span>
                  <strong>{visibleDisplayName}</strong>
                </div>
                <div>
                  <span>登录账号</span>
                  <strong className="mono-value">{visibleUsername}</strong>
                </div>
                <div>
                  <span>账号角色</span>
                  <strong>{getRoleLabel(session.role)}</strong>
                  <small>{session.status === "active" ? "账号正常" : "账号已停用"}</small>
                </div>
                <div>
                  <span>可用权限</span>
                  <strong>{getBusinessPermissionSummary(session.role, session.permissions)}</strong>
                </div>
              </div>

              <div className="account-panel-actions">
                <button
                  className="secondary-button full-button"
                  type="button"
                  onClick={() => runAccountAction(onSwitchAccount)}
                >
                  <ArrowRightLeft size={16} aria-hidden="true" />
                  切换账号
                </button>
                <button
                  className="primary-button full-button"
                  type="button"
                  onClick={() => runAccountAction(onSignOut)}
                >
                  <LogOut size={16} aria-hidden="true" />
                  退出账号
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <main className="app-main">{children}</main>
    </div>
  );
}
