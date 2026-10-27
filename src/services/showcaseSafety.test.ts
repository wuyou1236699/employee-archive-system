import { afterEach, describe, expect, it, vi } from "vitest";

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn(() => ({ auth: {} })) }));
vi.mock("@cloudbase/js-sdk", () => ({ default: { init: initMock } }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); initMock.mockClear(); });

describe("public showcase connection boundary", () => {
  it.each([undefined, "false", "TRUE", "1"])("ignores inherited cloud configuration unless explicitly enabled: %s", async (flag) => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_ENABLE_CLOUDBASE", flag);
    vi.stubEnv("VITE_CLOUDBASE_ENV_ID", "fictional-environment");
    vi.stubEnv("VITE_CLOUDBASE_PUBLISHABLE_KEY", "fictional-browser-key");
    const adapter = await import("./cloudbaseAdapter");
    const { createAppServices } = await import("./serviceFactory");
    const services = createAppServices();
    expect(adapter.app).toBeNull();
    expect(initMock).not.toHaveBeenCalled();
    expect(services.auth.config.mode).toBe("local-preview");
    expect(services.data.mode).toBe("local-preview");
    expect((await services.auth.enterDevelopmentPreviewAsync()).ok).toBe(true);
    expect(initMock).not.toHaveBeenCalled();
  });

  it("requires both credentials after explicit opt-in", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUDBASE", "true");
    vi.stubEnv("VITE_CLOUDBASE_ENV_ID", "");
    vi.stubEnv("VITE_CLOUDBASE_PUBLISHABLE_KEY", "");
    const { app } = await import("./cloudbaseAdapter");
    expect(app).toBeNull();
    expect(initMock).not.toHaveBeenCalled();
  });

  it("initializes only the operator-provided fictional test environment after explicit opt-in", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUDBASE", "true");
    vi.stubEnv("VITE_CLOUDBASE_ENV_ID", "fictional-environment");
    vi.stubEnv("VITE_CLOUDBASE_PUBLISHABLE_KEY", "fictional-browser-key");
    await import("./cloudbaseAdapter");
    expect(initMock).toHaveBeenCalledOnce();
    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({ env: "fictional-environment", accessKey: "fictional-browser-key" }));
  });
});
