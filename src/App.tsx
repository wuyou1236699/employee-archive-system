import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, type AppPage } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { AuditPage } from "./pages/AuditPage";
import { MonthlyAssessmentsPage } from "./pages/MonthlyAssessmentsPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { PendingSuperAdminTransferNotice } from "./components/PendingSuperAdminTransferNotice";
import { QuarterlyAssessmentsPage } from "./pages/QuarterlyAssessmentsPage";
import { createAppServices } from "./services/serviceFactory";
import type { AccountProfile, RegistrationInput, SelfPasswordResetInput, ServiceResult, Session } from "./types";

function getPageFromHash(): AppPage {
  if (window.location.hash.includes("/accounts")) return "accounts";
  if (window.location.hash.includes("/quarterly")) return "quarterly";
  if (window.location.hash.includes("/monthly-assessments")) return "monthly-assessments";
  return window.location.hash.includes("/audit") ? "audit" : "employees";
}

function getHashParameter(name: string): string | undefined {
  const queryIndex = window.location.hash.indexOf("?");
  if (queryIndex < 0) return undefined;
  const value = new URLSearchParams(window.location.hash.slice(queryIndex + 1)).get(name);
  return value?.trim() || undefined;
}

function mergeAccountProfile(session: Session, profile: AccountProfile): Session {
  return {
    ...session,
    username: profile.username || session.username,
    displayName: profile.displayName || session.displayName,
    role: profile.role,
    permissions: profile.permissions,
    status: profile.status,
    identityType: profile.identityType,
    employeeId: profile.employeeId ?? null,
    employeeNameSnapshot: profile.employeeNameSnapshot ?? null,
    studentId: profile.studentId ?? null,
    studentNameSnapshot: profile.studentNameSnapshot ?? null,
  };
}

function isInactiveAccountError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /未授权|已停用|停用|ACCOUNT_INACTIVE|disabled|inactive/i.test(message);
}

export default function App() {
  const services = useMemo(() => createAppServices(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [page, setPage] = useState<AppPage>(() => getPageFromHash());
  const accountProfileRequestRef = useRef<{ accountId: string; promise: Promise<AccountProfile> } | null>(null);

  const loadAccountProfile = useCallback((accountId: string): Promise<AccountProfile> => {
    const pending = accountProfileRequestRef.current;
    if (pending?.accountId === accountId) return pending.promise;

    const promise = Promise.resolve().then(() => services.data.getCurrentAccount());
    const entry = { accountId, promise };
    accountProfileRequestRef.current = entry;
    void promise.then(
      () => {
        if (accountProfileRequestRef.current === entry) accountProfileRequestRef.current = null;
      },
      () => {
        if (accountProfileRequestRef.current === entry) accountProfileRequestRef.current = null;
      },
    );
    return promise;
  }, [services]);

  useEffect(() => {
    let isMounted = true;
    const applyAccountProfile = (nextSession: Session | null) => {
      if (!nextSession) {
        setSession(null);
        return;
      }
      void loadAccountProfile(nextSession.accountId)
        .then((profile) => {
          if (!isMounted) return;
          if (profile.status === "disabled") {
            setSession(null);
            setAuthError("当前账号已停用，请联系总管理员。");
            void services.auth.signOutAsync();
            return;
          }
          setSession((current) => current ? mergeAccountProfile(current, profile) : mergeAccountProfile(nextSession, profile));
          if (profile.role === "user" && window.location.hash !== "#/quarterly") {
            window.location.hash = "#/quarterly";
            setPage("quarterly");
          }
        })
        .catch((error: unknown) => {
          if (isMounted && isInactiveAccountError(error)) {
            setSession(null);
            setAuthError("当前账号已停用或未授权，请联系总管理员。");
            void services.auth.signOutAsync();
          }
        });
      setSession(nextSession);
    };
    const unsubscribe = services.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;
      applyAccountProfile(nextSession);
      setIsAuthLoading(false);
      if (nextSession) setAuthError(null);
    });

    void services.auth
      .getSessionAsync()
      .then((nextSession) => {
        if (!isMounted) return;
        applyAccountProfile(nextSession);
        if (nextSession) setAuthError(null);
      })
      .catch(() => {
        if (!isMounted) return;
        setSession(null);
        setAuthError("登录状态暂时无法读取，请重新登录或联系管理员。");
      })
      .finally(() => {
        if (isMounted) setIsAuthLoading(false);
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [loadAccountProfile, services]);

  useEffect(() => {
    const handleHashChange = () => setPage(getPageFromHash());
    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash) {
      window.location.hash = "#/login";
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigate(nextPage: AppPage) {
    const allowedPage = session?.role === "user" && nextPage !== "quarterly" ? "quarterly" : nextPage;
    window.location.hash = `#/${allowedPage}`;
    setPage(allowedPage);
  }

  function defaultPageForSession(nextSession: Session): AppPage {
    return nextSession.role === "user" ? "quarterly" : "employees";
  }

  async function handleGovernanceTransferComplete(): Promise<void> {
    const accountId = session?.accountId;
    if (!accountId) return;
    try {
      const profile = await Promise.resolve(services.data.getCurrentAccount());
      if (profile.status !== "active") {
        try {
          await services.auth.signOutAsync();
        } catch {
          // The local permission projection must be cleared even if Auth cleanup fails.
        }
        setSession(null);
        setAuthError("身份转让已完成，但当前账号不可用，请重新登录。");
        window.location.hash = "#/login";
        throw new Error("Current account is not active after transfer.");
      }
      const refreshedSession = session ? mergeAccountProfile(session, profile) : null;
      setSession((current) => current?.accountId === accountId && refreshedSession ? refreshedSession : current);
      if (refreshedSession) {
        const allowedPage = defaultPageForSession(refreshedSession);
        window.location.hash = "#/" + allowedPage;
        setPage(allowedPage);
      }
    } catch {
      try {
        await services.auth.signOutAsync();
      } catch {
        // The session is cleared locally even if Auth cleanup cannot be confirmed.
      }
      setSession(null);
      setAuthError("身份转让已完成，但当前权限无法刷新。为避免继续使用旧权限，请重新登录。");
      window.location.hash = "#/login";
      throw new Error("Current account permission refresh failed after transfer.");
    }
  }

  async function handlePreview(): Promise<ServiceResult<Session>> {
    const result = await services.auth.enterDevelopmentPreviewAsync();
    if (result.ok) {
      services.data.recordAudit({
        action: "preview_login",
        detail: "进入体验模式。",
      });
      setSession(result.data);
      void loadAccountProfile(result.data.accountId).then((profile) => setSession((current) => current ? mergeAccountProfile(current, profile) : current)).catch(() => undefined);
      navigate(defaultPageForSession(result.data));
    }
    return result;
  }

  async function handleSignIn(username: string, password: string): Promise<ServiceResult<Session>> {
    const result = await services.auth.signInAsync(username, password);
    if (result.ok) {
      setAuthError(null);
      setSession(result.data);
      void loadAccountProfile(result.data.accountId).then((profile) => setSession((current) => current ? mergeAccountProfile(current, profile) : current)).catch(() => undefined);
      navigate(defaultPageForSession(result.data));
    }
    return result;
  }

  async function handleRegister(input: RegistrationInput): Promise<ServiceResult<Session>> {
    const registration = await services.accounts.register(input);
    if (!registration.ok) return registration;
    let signIn: ServiceResult<Session>;
    try {
      signIn = await services.auth.signInAsync(input.username, input.password);
    } catch {
      return { ok: false, message: "注册已成功，但自动登录未完成。请直接使用新账号和密码登录，不要重复提交手机号。" };
    }
    if (!signIn.ok) {
      return { ok: false, message: "注册已成功，但自动登录未完成。请直接使用新账号和密码登录，不要重复提交手机号。" };
    }
    const nextSession = mergeAccountProfile(signIn.data, registration.data);
    setAuthError(null);
    setSession(nextSession);
    navigate(defaultPageForSession(nextSession));
    return { ok: true, data: nextSession };
  }

  async function handleSelfPasswordReset(input: SelfPasswordResetInput) {
    return services.accounts.selfResetPassword(input);
  }

  async function clearSessionAndReturnToLogin(action: "switch" | "sign-out"): Promise<void> {
    if (session?.mode === "local-preview") {
      services.data.recordAudit({
        action: "preview_logout",
        detail: action === "switch" ? "切换账号，退出当前体验模式。" : "退出体验模式。",
      });
    }
    await services.auth.signOutAsync();
    setSession(null);
    setAuthError(null);
    window.location.hash = "#/login";
  }

  async function handleSwitchAccount(): Promise<void> {
    await clearSessionAndReturnToLogin("switch");
  }

  async function handleSignOut(): Promise<void> {
    await clearSessionAndReturnToLogin("sign-out");
  }

  if (isAuthLoading) {
    return (
      <LoginPage
        config={services.auth.config}
        onPreview={handlePreview}
        onSignIn={handleSignIn}
        onRegister={handleRegister}
        onResetPassword={handleSelfPasswordReset}
        isInitializing
        initialError={authError}
      />
    );
  }

  if (!session) {
    return (
      <LoginPage
        config={services.auth.config}
        onPreview={handlePreview}
        onSignIn={handleSignIn}
        onRegister={handleRegister}
        onResetPassword={handleSelfPasswordReset}
        initialError={authError}
      />
    );
  }

  return (
    <AppShell
      page={page}
      session={session}
      onNavigate={navigate}
      onSwitchAccount={handleSwitchAccount}
      onSignOut={handleSignOut}
    >
      <PendingSuperAdminTransferNotice accountId={session.accountId} accounts={services.accounts} onTransferComplete={handleGovernanceTransferComplete} />
      {page === "quarterly" ? <QuarterlyAssessmentsPage data={services.quarterly} role={session.role} displayName={session.displayName} employeeId={session.employeeId ?? null} studentId={session.studentId ?? null} /> : page === "audit" && session.role !== "user" ? <AuditPage data={services.data} /> : page === "monthly-assessments" && session.role !== "user" ? <MonthlyAssessmentsPage data={services.data} canEdit={session.role === "super_admin" || session.permissions.includes("monthly_assessment_edit")} /> : page === "accounts" && session.role === "super_admin" ? <AdminSettingsPage accounts={services.accounts} data={services.data} actorAccountId={session.accountId} actorAccountUsername={session.username} onTransferComplete={handleGovernanceTransferComplete} showRecoveryNotice={false} /> : <EmployeesPage data={services.data} role={session.role} permissions={session.permissions} initialEmployeeId={getHashParameter("employeeId")} initialMonthlyMonthKey={getHashParameter("monthKey")} />}
    </AppShell>
  );
}
