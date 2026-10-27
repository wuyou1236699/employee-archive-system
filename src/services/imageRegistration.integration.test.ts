import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudFunctionDataService } from "./dataService";

const { call, upload, remove } = vi.hoisted(() => ({ call: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock("./cloudbaseAdapter", () => ({ app: { callFunction: call, uploadFile: upload, deleteFile: remove } }));

interface Fixture {
  faults: { audit: boolean; commitReply: boolean; rollbackReply: boolean };
  handler(event: Record<string, unknown>): Promise<unknown>;
  upload(input: { cloudPath: string; fileContent: File }): Promise<{ fileID: string }>;
  deleteFile(input: { fileList: string[] }): Promise<unknown>;
  fileBytes(id: string): Uint8Array;
  fileExists(id: string): boolean;
  employee(): { version: number; attachments: { storageKey: string }[]; events: { attachments: { storageKey: string }[] }[] };
  successAudits(): unknown[];
  dispose(): void;
}
const require = createRequire(import.meta.url);
const { createImageBackend } = require("../../backend/employeeArchiveApi/image-registration.fixture.cjs") as { createImageBackend: () => Fixture };
let fixture: Fixture;
afterEach(() => { fixture?.dispose(); vi.resetAllMocks(); vi.useRealTimers(); });

function setup(kind: "general" | "event") {
  fixture = createImageBackend();
  upload.mockImplementation(fixture.upload);
  remove.mockImplementation(fixture.deleteFile);
  call.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ result: await fixture.handler(data) }));
  const service = new CloudFunctionDataService();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const file = new File([bytes], "虚构图片.png", { type: "image/png" });
  const event = { eventDate: "2026-01-01", eventType: "虚构事件", summary: "虚构恢复验证", detail: "仅本地测试" };
  const submit = (version = 1) => kind === "general"
    ? service.uploadAttachment("fixture-employee", file, undefined, version)
    : service.addEventRecord("fixture-employee", event, file, undefined, version);
  const records = () => kind === "general" ? fixture.employee().attachments : fixture.employee().events.flatMap(item => item.attachments);
  const assertFile = async () => {
    const uploaded = await upload.mock.results[0].value as { fileID: string };
    expect(fixture.fileExists(uploaded.fileID)).toBe(true);
    expect([...fixture.fileBytes(uploaded.fileID)]).toEqual([...bytes]);
    expect(remove).not.toHaveBeenCalled();
  };
  return { service, file, event, submit, records, assertFile };
}

describe.each(["general", "event"] as const)("%s image full local call chain", kind => {
  it("keeps committed metadata and physical file after a lost response, then recovers without reupload", async () => {
    const f = setup(kind);
    call.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => {
      await fixture.handler(data);
      throw new Error("fixture successful response lost");
    });
    const unknown = await f.submit();
    expect(unknown).toMatchObject({ ok: false, outcome: "uncertain" });
    expect(f.records()).toHaveLength(1);
    await f.assertFile();
    const payload = structuredClone(call.mock.calls[0][0]);
    expect((await f.submit(2)).ok).toBe(true);
    expect(call.mock.calls[1][0]).toEqual(payload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(f.records()).toHaveLength(1);
    expect(fixture.successAudits()).toHaveLength(1);
    await f.assertFile();
  });

  it("keeps the original recovery payload after a later authorization rejection", async () => {
    const f = setup(kind);
    call.mockRejectedValueOnce(new Error("fixture transport unknown"));
    expect(await f.submit()).toMatchObject({ ok: false, outcome: "uncertain" });
    call.mockResolvedValueOnce({ result: { ok: false, error: { code: "AUTH_REQUIRED", message: "请重新登录", details: { submissionOutcome: "not_committed" } } } });
    expect(await f.submit()).toMatchObject({ ok: false, outcome: "uncertain" });
    expect((await f.submit()).ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(f.records()).toHaveLength(1);
    await f.assertFile();
  });

  it("distinguishes acknowledged rollback and retains the unreferenced physical file", async () => {
    const f = setup(kind);
    fixture.faults.audit = true;
    expect(await f.submit()).toMatchObject({ ok: false, outcome: "definite", code: "AUDIT_WRITE_FAILED" });
    expect(f.records()).toHaveLength(0);
    expect(fixture.employee().version).toBe(1);
    await f.assertFile();
    fixture.faults.audit = false;
    expect((await f.submit()).ok).toBe(true);
    expect(f.records()).toHaveLength(1);
  });

  it("recovers a lost COMMIT acknowledgement using the existing record and file", async () => {
    const f = setup(kind);
    fixture.faults.commitReply = true;
    expect(await f.submit()).toMatchObject({ ok: false, outcome: "uncertain" });
    expect(f.records()).toHaveLength(1);
    await f.assertFile();
    expect((await f.submit()).ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(f.records()).toHaveLength(1);
    await f.assertFile();
  });

  it("retains files after stale-version rejection", async () => {
    const f = setup(kind);
    expect(await f.submit(99)).toMatchObject({ ok: false, outcome: "definite", code: "EMPLOYEE_CONFLICT" });
    expect(f.records()).toHaveLength(0);
    await f.assertFile();
  });

  it("retains the original operation after malformed replies and blocks changed recovery inputs", async () => {
    const f = setup(kind);
    call.mockResolvedValueOnce({ result: { ok: true, data: {} } });
    expect(await f.submit()).toMatchObject({ ok: false, outcome: "uncertain" });
    const other = new File(["fiction"], "另一张虚构图片.png", { type: "image/png" });
    const changed = kind === "general" ? await f.service.uploadAttachment("fixture-employee", other, undefined, 1)
      : await f.service.addEventRecord("fixture-employee", { ...f.event, summary: "不同事件" }, f.file, undefined, 1);
    expect(changed).toMatchObject({ ok: false, outcome: "uncertain" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect((await f.submit()).ok).toBe(true);
    await f.assertFile();
  });

  it("expires an unanswered request while retaining its committed file and recovery key", async () => {
    vi.useFakeTimers();
    const f = setup(kind);
    call.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => {
      await fixture.handler(data);
      return new Promise(() => {});
    });
    const pending = f.submit();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await pending).toMatchObject({ ok: false, outcome: "uncertain" });
    expect(f.records()).toHaveLength(1);
    await f.assertFile();
    expect((await f.submit()).ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("reports validation before submission as definite without contacting the backend", async () => {
    const f = setup(kind);
    const invalid = new File(["fiction"], "虚构文本.txt", { type: "text/plain" });
    const result = kind === "general" ? await f.service.uploadAttachment("fixture-employee", invalid, undefined, 1)
      : await f.service.addEventRecord("fixture-employee", f.event, invalid, undefined, 1);
    expect(result).toMatchObject({ ok: false, outcome: "definite" });
    expect(call).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(f.records()).toHaveLength(0);
  });
});
