import { ArrowRight, CheckCircle2, CircleAlert, Eye, EyeOff, KeyRound, LockKeyhole, UserPlus } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuthConfigStatus, RegistrationInput, SelfPasswordResetInput, ServiceResult, Session } from "../types";
import { TextField } from "../components/Field";
import { REGISTRATION_PASSWORD_RULE_MESSAGE, REGISTRATION_PROVIDER_PARAMETER_MESSAGE } from "../utils/registrationMessages";

function toFriendlyLoginMessage(input: unknown): string {
  const raw = input instanceof Error ? input.message : typeof input === "string" ? input : "";
  const normalized = raw.toLowerCase();

  if (/(未授权|无权限|没有权限|禁止访问|forbidden|unauthori[sz]ed|inactive|disabled)/i.test(raw)) {
    return "该账号暂未获得系统使用权限，请联系管理员。";
  }
  if (/(尝试次数|too many|rate.?limit)/i.test(raw)) {
    return "登录尝试次数过多，请稍后再试。";
  }
  if (/(账号|密码|凭证|invalid login|invalid credential|wrong password|incorrect password|user not found|not found)/i.test(raw)) {
    return "账号或密码不正确，请检查后重试。";
  }
  if (/(network|fetch|timeout|server|service|request|请求|服务)/i.test(normalized)) {
    return "登录服务暂时无法使用，请稍后再试；如持续失败，请联系管理员。";
  }
  return "登录失败，请检查账号和密码后重试。";
}

function toFriendlyRegistrationMessage(input: unknown, code = ""): string {
  const raw = input instanceof Error ? input.message : typeof input === "string" ? input : "";
  const reference = raw.match(/（排查编号：[A-Za-z0-9_-]{8}，可提供给开发者）$/)?.[0] ?? "";
  const message = toFriendlyRegistrationDetail(reference ? raw.slice(0, -reference.length) : input, code);
  return message + reference;
}

function toFriendlyRegistrationDetail(input: unknown, code = ""): string {
  const raw = input instanceof Error ? input.message : typeof input === "string" ? input : "";
  const normalized = raw.toLowerCase();
  const category = `${code} ${raw}`;
  if (raw === REGISTRATION_PASSWORD_RULE_MESSAGE || raw === REGISTRATION_PROVIDER_PARAMETER_MESSAGE) return raw;
  if (/(注册已成功.*自动登录|自动登录未完成|不要重复提交手机号)/i.test(raw)) {
    if (/注册已成功/.test(raw)) return "注册已成功，但自动登录未完成。请直接使用新账号和密码登录，不要重复提交手机号。";
    if (/注册结果尚未确认/.test(raw)) return "注册结果尚未确认，请勿再次提交手机号；请联系管理员核对账号状态后再继续。";
    return "注册已成功，但自动登录未完成。请直接使用新账号和密码登录，不要重复提交手机号。";
  }
  if (/(REGISTRATION_RECOVERY_REQUIRED|注册状态需管理员核对|注册结果.*管理员核对|账号创建结果.*管理员核对|账号可能已创建|请勿重复注册)/i.test(category)) {
    return "注册结果尚未确认，请勿再次提交手机号；请联系管理员核对账号状态后再继续。";
  }
  if (/(REGISTRATION_EMPLOYEE_MATCH_FAILED|REGISTRATION_IDENTITY_MATCH_AMBIGUOUS|未能完成(员工|档案)身份匹配|手机号无法唯一匹配到可注册档案)/i.test(raw)) {
    return "手机号无法唯一匹配到可注册档案。员工请填写员工档案中登记的个人手机号，学员请填写学员档案中登记的手机号；确认号码无误后仍失败，请联系管理员核对档案。";
  }
  if (/(REGISTRATION_EMPLOYEE_INVALID|REGISTRATION_IDENTITY_INVALID|匹配到的档案资料不完整)/i.test(raw)) {
    return "匹配到的档案资料不完整或当前状态不可注册，请联系管理员核对档案。";
  }
  if (/(REGISTRATION_IDENTITY_CLAIMED|当前身份已绑定账号或正在注册中)/i.test(raw)) {
    return "当前身份已绑定账号或正在注册中，暂不能重复注册；请联系管理员核对账号状态。";
  }
  if (/(REGISTRATION_UNAVAILABLE|注册服务暂时不可用)/i.test(raw)) {
    return "注册服务暂时不可用，请稍后重试；如持续失败，请联系管理员。";
  }
  if (/注册参数未通过(?:云端)?校验/i.test(raw)) {
    return REGISTRATION_PROVIDER_PARAMETER_MESSAGE;
  }
  if (/账号名须以字母或数字开头/.test(raw)) return raw;
  if (/密码不能以特殊字符开头|特殊字符只能使用/i.test(raw)) return REGISTRATION_PASSWORD_RULE_MESSAGE;
  if (/(REGISTRATION_PROVIDER_ERROR|注册服务未能确认账号创建结果)/i.test(raw)) {
    return "注册服务未能确认账号创建结果，请勿再次提交手机号，并联系管理员核对账号状态。";
  }
  if (/网络连接异常/.test(raw)) return "网络连接异常，请检查网络后重试；如仍无法完成，请联系管理员核对账号状态。";
  if (/请输入有效的(本人|员工)?手机号|请输入有效的手机号/.test(raw)) {
    return "请输入有效的手机号，并确保与员工或学员档案中登记的手机号一致。";
  }
  if (/(账号名|用户名).*(已被使用|已被占用)/i.test(raw)) return "该账号名已被使用，请换一个账号名。";
  if (/(taken|duplicate|already|exist|已注册|已存在|重名|占用)/i.test(raw)) return "该账号名已被注册，请换一个账号名。";
  if (/(manager|registration_unavailable|注册服务|未配置|provider|服务端)/i.test(`${raw} ${normalized}`)) return "注册服务暂时无法使用，请联系管理员。";
  if (/(password|密码)/i.test(raw)) return REGISTRATION_PASSWORD_RULE_MESSAGE;
  if (/(username|账号|用户名)/i.test(raw)) return "账号名不符合规则，请使用字母或数字开头的 1—64 位字符。";
  if (/(network|fetch|timeout|server|service|request|请求|服务)/i.test(normalized)) return "注册服务暂时无法使用，请稍后再试；如持续失败，请联系总管理员。";
  return "注册未能完成，请检查账号、手机号和密码后重试；如确认无误仍失败，请联系管理员核对。";
}

function toFriendlyPreviewMessage(input: unknown): string {
  const raw = input instanceof Error ? input.message : typeof input === "string" ? input : "";
  if (/(正式登录|已使用正式|不能进入)/i.test(raw)) return "当前已使用正式登录，不能进入体验模式。";
  return "当前无法进入体验模式，请稍后重试。";
}

type RegistrationValidationInput = Pick<RegistrationInput, "username" | "password" | "phoneNumber">;

export function validateRegistrationForm(input: RegistrationValidationInput, confirmPassword = input.password): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.username.trim())) return "账号名须以字母或数字开头，长度 1—64 位，只能包含字母、数字、点、下划线和短横线。";
  if (!input.phoneNumber.trim()) return "请填写手机号。";
  const password = input.password;
  if (password.length < 8 || password.length > 32) return "密码须为 8—32 位。";
  const cloudBasePasswordSpecialCharacters = new Set("()!@#$%^&*|?><_-");
  if (/^[^A-Za-z0-9]/.test(password)
    || [...password].some((character) => !/[A-Za-z0-9]/.test(character)
      && !cloudBasePasswordSpecialCharacters.has(character))) {
    return "密码不能以特殊字符开头；特殊字符只能使用 ()!@#$%^&*|?><_-。";
  }
  const passwordClasses = [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  if (passwordClasses < 3) return "密码须包含小写字母、大写字母、数字、特殊字符中的至少三类。";
  if (password !== confirmPassword) return "两次输入的密码不一致。";
  return null;
}

interface LoginPageProps {
  config: AuthConfigStatus;
  onPreview: () => Promise<ServiceResult<Session>>;
  onSignIn: (username: string, password: string) => Promise<ServiceResult<Session>>;
  onRegister: (input: RegistrationInput) => Promise<ServiceResult<Session>>;
  onResetPassword?: (input: SelfPasswordResetInput) => Promise<ServiceResult<{ accepted: true }>>;
  isInitializing?: boolean;
  initialError?: string | null;
}

export function LoginPage({ config, onPreview, onSignIn, onRegister, onResetPassword, isInitializing = false, initialError = null }: LoginPageProps) {
  const [mode, setMode] = useState<"sign-in" | "register" | "reset-password">("sign-in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(() => (initialError ? toFriendlyLoginMessage(initialError) : null));
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"preview" | "sign-in" | "register" | "reset-password" | null>(null);
  const isBusy = isInitializing || pendingAction !== null;

  useEffect(() => {
    setMessage(initialError ? toFriendlyLoginMessage(initialError) : null);
  }, [initialError]);

  async function handleSignIn(): Promise<void> {
    if (isBusy) return;
    setMessage(null);
    if (!username.trim() || !password) {
      setMessage("请填写账号和密码。");
      return;
    }
    setPendingAction("sign-in");
    try {
      const result = await onSignIn(username.trim(), password);
      if (!result.ok) {
        setMessage(toFriendlyLoginMessage(result.message));
      }
    } catch (error: unknown) {
      setMessage(toFriendlyLoginMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRegister(): Promise<void> {
    if (isBusy) return;
    setMessage(null);
    setSuccessMessage(null);
    const input = { username: username.trim(), password, phoneNumber: phoneNumber.trim() } satisfies RegistrationInput;
    const validationError = validateRegistrationForm(input, confirmPassword);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setPendingAction("register");
    try {
      const result = await onRegister(input);
      if (!result.ok) {
        setMessage(toFriendlyRegistrationMessage(result.message, result.code));
      } else {
        setSuccessMessage("注册成功，正在进入系统。");
      }
    } catch (error: unknown) {
      setMessage(toFriendlyRegistrationMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleResetPassword(): Promise<void> {
    if (isBusy || !onResetPassword) return;
    setMessage(null);
    setSuccessMessage(null);
    const credentials = { username: username.trim(), password, phoneNumber: phoneNumber.trim() } satisfies RegistrationInput;
    const validationError = validateRegistrationForm(credentials, confirmPassword);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setPendingAction("reset-password");
    try {
      const result = await onResetPassword({
        username: credentials.username,
        phoneNumber: credentials.phoneNumber,
        newPassword: credentials.password,
      });
      if (!result.ok) {
        setMessage(result.message);
      } else {
        setMode("sign-in");
        setPhoneNumber("");
        setPassword("");
        setConfirmPassword("");
        setSuccessMessage("重置请求已提交，请尝试使用新密码登录；若仍无法登录，请联系管理员。");
      }
    } catch {
      setMessage("暂时无法确认重置请求，请稍后重试；如仍无法登录，请联系管理员。");
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePreview(): Promise<void> {
    if (isBusy) return;
    setMessage(null);
    setPendingAction("preview");
    try {
      const result = await onPreview();
      if (!result.ok) setMessage(toFriendlyPreviewMessage(result.message));
    } catch (error: unknown) {
      setMessage(toFriendlyPreviewMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="login-page">
      <section className="login-slab">
        <div className="login-slab-grid" />
        <div className="login-slab-topline">
          <span>员工档案 / 内部使用</span>
          <span>登录入口</span>
        </div>
        <div className="login-slab-content">
          <div className="login-emblem" aria-hidden="true">
            <LockKeyhole size={31} strokeWidth={1.4} />
          </div>
          <p className="eyebrow">员工资料工作台</p>
          <h1>
            员工
            <br />
            档案系统
          </h1>
          <p className="login-intro">
            登录后即可查询、维护和查看员工档案，让日常资料管理更清晰、更有序。
          </p>
          <div className="login-side-note">
            <span>档案范围</span>
            <span>基础档案 · 合同 · 车辆 · 培训 · 事项</span>
          </div>
        </div>
        <div className="login-slab-footer">
          <span>员工档案管理</span>
          <span>请使用系统账号登录</span>
        </div>
      </section>

      <section className="login-workspace">
        <div className="workspace-corner">欢迎使用</div>
        <div className="login-form-wrap">
          <div className="login-form-heading">
            <h2>{mode === "sign-in" ? "登录系统" : mode === "register" ? "注册账号" : "重置密码"}</h2>
          </div>

          <div className="login-mode-tabs" role="tablist" aria-label="登录或注册">
            <button className={mode === "sign-in" || mode === "reset-password" ? "is-active" : ""} type="button" role="tab" aria-selected={mode === "sign-in" || mode === "reset-password"} onClick={() => { setMode("sign-in"); setMessage(null); setSuccessMessage(null); if (mode === "reset-password") { setPassword(""); setConfirmPassword(""); setPhoneNumber(""); } }} disabled={isBusy}>{mode === "reset-password" ? "返回登录" : "已有账号登录"}</button>
            <button className={mode === "register" ? "is-active" : ""} type="button" role="tab" aria-selected={mode === "register"} onClick={() => { setMode("register"); setMessage(null); setSuccessMessage(null); }} disabled={isBusy}>注册</button>
          </div>

          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              void (mode === "sign-in" ? handleSignIn() : mode === "register" ? handleRegister() : handleResetPassword());
            }}
          >
            <TextField
              label="账号"
              placeholder="请输入账号"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required={mode !== "sign-in"}
              disabled={isBusy}
            />
            {mode === "register" || mode === "reset-password" ? <>
              <label className="field">
                <span className="field-label">手机号 <em>*</em></span>
                <input
                  className="field-control"
                  type="tel"
                  placeholder={mode === "register" ? "请输入个人手机号" : "请输入账号绑定档案中的手机号"}
                  value={phoneNumber}
                  onChange={(event) => {
                    setPhoneNumber(event.target.value);
                    setSuccessMessage(null);
                  }}
                  autoComplete="tel"
                  disabled={isBusy}
                  required
                />
                <span className="field-hint">{mode === "register" ? "请输入员工或学员档案中登记的个人手机号；匹配成功后，账号会自动关联对应档案。" : "请输入该账号绑定的在职员工档案中当前登记的手机号；此方式不会发送短信。"}</span>
              </label>
            </> : null}
            <label className="field password-field">
              <span className="field-label">{mode === "reset-password" ? "新密码" : "密码"} {mode !== "sign-in" ? <em>*</em> : null}</span>
              <div className="password-control-wrap">
                <input
                  className="field-control"
                  type={showPassword ? "text" : "password"}
                  placeholder={mode === "reset-password" ? "请设置新密码" : "请输入密码"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  required={mode !== "sign-in"}
                  disabled={isBusy}
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((visible) => !visible)}
                  disabled={isBusy}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {mode !== "sign-in" ? <span className="field-hint">{REGISTRATION_PASSWORD_RULE_MESSAGE}</span> : null}
            </label>
            {mode === "sign-in" && onResetPassword ? <button className="login-forgot-password" type="button" onClick={() => { setMode("reset-password"); setMessage(null); setSuccessMessage(null); setPassword(""); setConfirmPassword(""); setPhoneNumber(""); }} disabled={isBusy}>忘记密码？</button> : null}
            {mode !== "sign-in" ? <label className="field password-field">
              <span className="field-label">确认密码 <em>*</em></span>
              <div className="password-control-wrap">
                <input
                  className="field-control"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="请再次输入密码"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  disabled={isBusy}
                />
                <button className="password-toggle" type="button" aria-label={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"} onClick={() => setShowConfirmPassword((visible) => !visible)} disabled={isBusy}>
                  {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label> : null}
            {isInitializing ? (
              <div className="form-message" role="status" aria-live="polite">
                <LoaderCircle size={16} />
                <span>正在确认登录状态…</span>
              </div>
            ) : null}
            {message ? (
              <div className="form-message form-message-error" role="alert">
                <CircleAlert size={16} />
                <span>{message}</span>
              </div>
            ) : null}
            {successMessage ? <div className="form-message form-message-success" role="status" aria-live="polite"><CheckCircle2 size={16} /><span>{successMessage}</span></div> : null}
            <button className="primary-button login-submit" type="submit" disabled={isBusy} aria-busy={pendingAction !== null}>
              {pendingAction !== null || isInitializing ? <LoaderCircle size={17} /> : mode === "sign-in" ? <KeyRound size={17} /> : mode === "register" ? <UserPlus size={17} /> : <KeyRound size={17} />}
              {isInitializing ? "正在确认登录状态…" : pendingAction === "sign-in" ? "正在登录…" : pendingAction === "register" ? "正在注册…" : pendingAction === "reset-password" ? "正在提交…" : mode === "sign-in" ? "登录" : mode === "register" ? "注册并登录" : "提交重置请求"}
              <ArrowRight size={17} />
            </button>
            {config.mode === "local-preview" ? <>
              <div className="form-message" role="note">{config.message || "当前为体验模式，登录不会连接正式系统，也不会保存真实会话。"}</div>
              <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void handlePreview()}>{pendingAction === "preview" ? "正在进入体验模式…" : "进入体验模式"}</button>
            </> : null}
          </form>
        </div>
        <div className="workspace-footnote">
          安全入口 / 员工档案管理
        </div>
      </section>
    </main>
  );
}
