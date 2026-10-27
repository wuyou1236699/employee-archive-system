import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudFunctionAccountService } from "./accountService";
import { REGISTRATION_PASSWORD_RULE_MESSAGE, REGISTRATION_PROVIDER_PARAMETER_MESSAGE } from "../utils/registrationMessages";

const { callFunctionMock } = vi.hoisted(() => ({ callFunctionMock: vi.fn() }));

vi.mock("./cloudbaseAdapter", () => ({ app: { callFunction: callFunctionMock } }));

afterEach(() => callFunctionMock.mockReset());

describe("registration error guidance", () => {
  it.each([
    ["密码需为 8-32 位。", "password", REGISTRATION_PASSWORD_RULE_MESSAGE],
    ["密码不能以特殊字符开头；特殊字符只能使用 ()!@#$%^&*|?><_-。", "password", REGISTRATION_PASSWORD_RULE_MESSAGE],
    ["密码至少包含三类字符。", "password", REGISTRATION_PASSWORD_RULE_MESSAGE],
    ["注册参数未通过校验。请检查账号名和密码规则；确认填写无误后仍失败，请联系管理员。", "registration", REGISTRATION_PROVIDER_PARAMETER_MESSAGE],
    ["注册参数未通过云端校验。", undefined, REGISTRATION_PROVIDER_PARAMETER_MESSAGE],
  ])("preserves actionable guidance for a server validation error", async (message, field, expected) => {
    callFunctionMock.mockResolvedValue({ result: { ok: false, error: { code: "VALIDATION_ERROR", message, ...(field ? { details: { field } } : {}) } } });
    const result = await new CloudFunctionAccountService().register({ username: "test-user", password: "GoodPass1!", phoneNumber: "13800001234" });
    expect(result).toEqual({ ok: false, code: "VALIDATION_ERROR", message: expected, outcome: "definite" });
  });
});

describe("administrator password reset", () => {
  it("sends only the new password with the stable account id and governance revision", async () => {
    callFunctionMock.mockResolvedValue({ result: { ok: true, data: { reset: true } } });
    const secret = "ResetOnlyPass1!";
    const result = await new CloudFunctionAccountService().resetPassword({
      accountId: "stable-account-document-id",
      newPassword: secret,
      expectedGovernanceRevision: 12,
    });

    expect(result).toEqual({ ok: true, data: { reset: true } });
    expect(callFunctionMock).toHaveBeenCalledWith({
      name: "employeeArchiveApi",
      data: {
        route: "accounts/reset-password",
        accountId: "stable-account-document-id",
        newPassword: secret,
        expectedGovernanceRevision: 12,
      },
    });
  });

  it("maps server errors to fixed messages and never returns provider details", async () => {
    const secret = "ResetOnlyPass1!";
    callFunctionMock.mockResolvedValue({
      result: { ok: false, error: { code: "PASSWORD_RESET_FAILED", message: `provider echoed ${secret}` } },
    });
    const result = await new CloudFunctionAccountService().resetPassword({
      accountId: "stable-account-document-id",
      newPassword: secret,
      expectedGovernanceRevision: 12,
    });

    expect(result).toEqual({
      ok: false,
      code: "PASSWORD_RESET_FAILED",
      message: "密码重置未成功，请稍后重试。",
      outcome: "definite",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("provider echoed");
  });

  it("returns an uncertain fixed message when transport fails", async () => {
    const secret = "ResetOnlyPass1!";
    callFunctionMock.mockRejectedValue(new Error(`transport detail ${secret}`));
    const result = await new CloudFunctionAccountService().resetPassword({
      accountId: "stable-account-document-id",
      newPassword: secret,
      expectedGovernanceRevision: 12,
    });

    expect(result).toMatchObject({ ok: false, outcome: "uncertain" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("transport detail");
  });
});
