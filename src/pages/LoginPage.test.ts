// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthConfigStatus, RegistrationInput, ServiceResult, Session } from "../types";
import { LoginPage, validateRegistrationForm } from "./LoginPage";
import { REGISTRATION_PASSWORD_RULE_MESSAGE, REGISTRATION_PROVIDER_PARAMETER_MESSAGE } from "../utils/registrationMessages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authConfig: AuthConfigStatus = {
  mode: "local-preview",
  environmentConfigured: false,
  publishableKeyConfigured: false,
  region: "",
  message: "",
};

const session: Session = {
  accountId: "test-account",
  username: "test-user",
  displayName: "测试用户",
  mode: "local-preview",
  role: "user",
  permissions: [],
  status: "active",
};

const failedResult: ServiceResult<Session> = { ok: false, message: "测试未调用" };

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function changeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(label: string): HTMLButtonElement | null {
  return [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((button) => button.textContent?.includes(label)) ?? null;
}

function renderLoginPage(
  onRegister: (input: RegistrationInput) => Promise<ServiceResult<Session>> = async () => ({ ok: true, data: session }),
): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(createElement(LoginPage, { config: authConfig, onPreview: async () => failedResult, onSignIn: async () => failedResult, onRegister }));
  });
}

async function openRegistration(): Promise<void> {
  await act(async () => {
    findButton("注册")?.click();
  });
}

async function fillCredentials(password = "GoodPass1!"): Promise<void> {
  const username = container?.querySelector<HTMLInputElement>("input[autocomplete='username']");
  const passwordFields = container?.querySelectorAll<HTMLInputElement>("input[autocomplete='new-password']");
  if (!username || !passwordFields || passwordFields.length < 2) throw new Error("注册页账号或密码输入框未显示。");
  await act(async () => {
    changeInputValue(username, "test-user");
    changeInputValue(passwordFields[0], password);
    changeInputValue(passwordFields[1], password);
  });
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

describe("registration form validation", () => {
  it("requires a username, phone number, strong password, and matching confirmation", () => {
    expect(validateRegistrationForm({ username: "archive.user", password: "GoodPass1!", phoneNumber: "13800001234" }, "GoodPass1!")).toBeNull();
    expect(validateRegistrationForm({ username: "bad name", password: "GoodPass1!", phoneNumber: "13800001234" }, "GoodPass1!")).toContain("账号名");
    expect(validateRegistrationForm({ username: "valid-user", password: "weakpass", phoneNumber: "13800001234" }, "weakpass")).toContain("密码");
    expect(validateRegistrationForm({ username: "valid-user", password: "GoodPass1!", phoneNumber: "13800001234" }, "OtherPass1!")).toContain("不一致");
    expect(validateRegistrationForm({ username: "valid-user", password: "GoodPass1!", phoneNumber: "  " }, "GoodPass1!")).toContain("手机号");
  });

  it("accepts exactly the CloudBase password character set and length boundaries", () => {
    const validate = (password: string) => validateRegistrationForm({ username: "valid-user", password, phoneNumber: "13800001234" });
    for (const character of "()!@#$%^&*|?><_-") expect(validate(`GoodPass1${character}`)).toBeNull();
    expect(validate("GoodPass1")).toBeNull();
    expect(validate("Aa1".repeat(10) + "Aa")).toBeNull();
    for (const password of ["!GoodPass1", "GoodPass1.", "GoodPass1+", "GoodPass1=", "GoodPass1 ", "GoodPass1中", "GoodPass1\n", "GoodPa1", "GoodPass1".repeat(4) + "!"]) {
      expect(validate(password)).toContain("密码");
    }
  });
});

describe("phone-based registration", () => {
  it("shows the password rules and prevents invalid passwords from reaching registration", async () => {
    let registerCalls = 0;
    renderLoginPage(async () => { registerCalls += 1; return { ok: true, data: session }; });
    await openRegistration();
    expect(container?.textContent).toContain(REGISTRATION_PASSWORD_RULE_MESSAGE);
    await fillCredentials("GoodPass1.");
    await act(async () => {
      const phoneInput = container?.querySelector<HTMLInputElement>("input[autocomplete='tel']");
      if (phoneInput) changeInputValue(phoneInput, "13800001234");
      findButton("注册并登录")?.click();
    });
    expect(registerCalls).toBe(0);
    expect(container?.querySelector("[role='alert']")?.textContent).toContain("特殊字符只能使用");
  });

  it("preserves cloud parameter validation guidance after service error normalization", async () => {
    renderLoginPage(async () => ({ ok: false, message: REGISTRATION_PROVIDER_PARAMETER_MESSAGE, code: "VALIDATION_ERROR" }));
    await openRegistration();
    await fillCredentials();
    await act(async () => {
      const phoneInput = container?.querySelector<HTMLInputElement>("input[autocomplete='tel']");
      if (phoneInput) changeInputValue(phoneInput, "13800001234");
      findButton("注册并登录")?.click();
    });
    expect(container?.querySelector("[role='alert']")?.textContent).toContain(REGISTRATION_PROVIDER_PARAMETER_MESSAGE);
  });

  it("uses a recovery code to keep the user from retrying an uncertain registration", async () => {
    renderLoginPage(async () => ({ ok: false, message: "暂时无法完成注册。", code: "REGISTRATION_RECOVERY_REQUIRED" }));
    await openRegistration();
    await fillCredentials();
    await act(async () => {
      const phoneInput = container?.querySelector<HTMLInputElement>("input[autocomplete='tel']");
      if (phoneInput) changeInputValue(phoneInput, "13800001234");
      findButton("注册并登录")?.click();
    });
    expect(container?.querySelector("[role='alert']")?.textContent).toContain("请勿再次提交手机号");
  });
  it("collects a phone number and submits it without previewing or disclosing an employee match", async () => {
    const registeredInputs: RegistrationInput[] = [];
    renderLoginPage(
      async (input) => {
        registeredInputs.push(input);
        return { ok: true, data: session };
      },
    );
    await openRegistration();

    const phoneInput = container?.querySelector<HTMLInputElement>("input[autocomplete='tel']");
    expect(phoneInput).not.toBeNull();
    expect(phoneInput?.type).toBe("tel");
    expect(container?.querySelector("input[autocomplete='name']")).toBeNull();
    expect(container?.textContent).toContain("匹配成功后，账号会自动关联对应档案");
    expect(container?.textContent).not.toContain("核验邀请码");

    await fillCredentials();
    await act(async () => {
      if (phoneInput) changeInputValue(phoneInput, "＋８６ １３８-００００-１２３４");
      findButton("注册并登录")?.click();
    });

    expect(registeredInputs).toEqual([{ username: "test-user", password: "GoodPass1!", phoneNumber: "＋８６ １３８-００００-１２３４" }]);
    expect(container?.textContent).toContain("注册成功，正在进入系统。");
  });

  it("marks the phone field as required and validates it", async () => {
    expect(validateRegistrationForm({ username: "valid-user", password: "GoodPass1!", phoneNumber: "" }, "GoodPass1!")).toContain("手机号");
    renderLoginPage();
    await openRegistration();
    const phoneInput = container?.querySelector<HTMLInputElement>("input[autocomplete='tel']");
    expect(phoneInput?.required).toBe(true);
  });

  it("warns against resubmitting a phone when registration succeeded but automatic sign-in failed", async () => {
    renderLoginPage(async () => ({ ok: false, message: "注册已成功，但自动登录未完成。请直接使用新账号和密码登录，不要重复提交手机号。" }));
    await openRegistration();
    const phoneInput = container?.querySelector<HTMLInputElement>("input[autocomplete='tel']");
    await act(async () => { if (phoneInput) changeInputValue(phoneInput, "13800001234"); });
    await fillCredentials();

    await act(async () => {
      findButton("注册并登录")?.click();
    });

    expect(container?.textContent).toContain("注册已成功，但自动登录未完成。请直接使用新账号和密码登录，不要重复提交手机号。");
    expect(container?.textContent).not.toContain("注册失败，请检查填写内容后重试。");
  });

  it("explains which archive phone number is required when registration cannot match an identity", async () => {
    const message = "手机号无法唯一匹配到可注册档案。员工请填写员工档案中登记的个人手机号，学员请填写学员档案中登记的手机号；确认号码无误后仍失败，请联系管理员核对档案。";
    renderLoginPage(async () => ({ ok: false, message: "未能完成档案身份匹配，请核对档案中登记的手机号后重试，或联系管理员。" }));
    await openRegistration();
    const phoneInput = container?.querySelector<HTMLInputElement>("input[autocomplete='tel']");
    await act(async () => { if (phoneInput) changeInputValue(phoneInput, "13800001234"); });
    await fillCredentials();

    await act(async () => {
      findButton("注册并登录")?.click();
    });

    expect(container?.textContent).toContain(message);
    expect(container?.textContent).not.toContain("注册未能完成，请检查账号、手机号和密码后重试；如确认无误仍失败，请联系管理员核对。");
  });
});
