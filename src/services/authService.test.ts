import { describe, expect, it } from "vitest";
import { LocalPreviewAuthService, mapCloudBaseSession } from "./authService";
import type { AuthConfigStatus } from "../types";

const localConfig: AuthConfigStatus = {
  mode: "local-preview",
  environmentConfigured: false,
  publishableKeyConfigured: false,
  region: "ap-shanghai",
  message: "本地开发预览",
};

describe("LocalPreviewAuthService", () => {
  it("clears the current session through the AuthService sign-out flow", async () => {
    const service = new LocalPreviewAuthService(localConfig);
    const events: string[] = [];
    service.onAuthStateChange((event, nextSession) => {
      events.push(`${event}:${nextSession?.username ?? "none"}`);
    });

    const signedIn = await service.enterDevelopmentPreviewAsync();
    expect(signedIn.ok).toBe(true);
    expect(service.getSession()?.username).toBe("development-preview");

    await service.signOutAsync();

    expect(service.getSession()).toBeNull();
    expect(events).toEqual(["SIGNED_IN:development-preview", "SIGNED_OUT:none"]);
  });
});

describe("mapCloudBaseSession", () => {
  it("maps the CloudBase Web SDK v3 user_metadata fields to readable session values", () => {
    const session = mapCloudBaseSession({
      user: {
        id: "cloudbase-uid-001",
        email: "archive@example.com",
        user_metadata: {
          username: "archive-admin",
          nickName: "档案管理员",
        },
      },
    });

    expect(session).toEqual({
      accountId: "cloudbase-uid-001",
      username: "archive-admin",
      displayName: "档案管理员",
      mode: "cloudbase",
      role: "user",
      permissions: [],
      status: "active",
    });
  });

  it("uses email when no username is returned", () => {
    const session = mapCloudBaseSession({
      user: {
        id: "cloudbase-uid-002",
        email: "archive@example.com",
        user_metadata: {},
      },
    });

    expect(session?.username).toBe("archive@example.com");
    expect(session?.displayName).toBe("archive@example.com");
  });

  it("does not expose a technical id when it is the only identity field", () => {
    const session = mapCloudBaseSession({
      user: {
        id: "cloudbase-uid-only",
        user_metadata: {
          uid: "cloudbase-uid-only",
        },
      },
    });

    expect(session).toMatchObject({
      accountId: "cloudbase-uid-only",
      username: "已登录账号",
      displayName: "已登录用户",
    });
    expect(session?.username).not.toContain("cloudbase-uid-only");
    expect(session?.displayName).not.toContain("cloudbase-uid-only");
  });

  it("rejects anonymous sessions", () => {
    expect(mapCloudBaseSession({ user: { id: "anonymous-uid", is_anonymous: true } })).toBeNull();
  });
});
