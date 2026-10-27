import type { ServiceResult } from "../types";

type SubmissionOutcome = "not_committed" | "uncertain";

export class ImageRegistrationError extends Error {
  constructor(message: string, readonly outcome: SubmissionOutcome, readonly code?: string) {
    super(message);
  }
}

interface PendingImage {
  file: File;
  fingerprint: string;
  payload: Record<string, unknown>;
  uncertain: boolean;
}

// Recovery retains the exact uploaded key and original payload for this page
// session. No branch deletes files, including a rejection of a later retry.
export class ImageRegistration {
  private readonly pending = new Map<string, PendingImage>();
  private readonly busy = new Set<string>();

  async submit<T>(
    key: string,
    file: File,
    fingerprint: string,
    upload: () => Promise<Record<string, unknown>>,
    register: (payload: Record<string, unknown>) => Promise<T>,
  ): Promise<ServiceResult<T>> {
    if (this.busy.has(key)) return { ok: false, message: "图片正在登记，请稍候。", outcome: "uncertain" };
    this.busy.add(key);
    try {
      let pending = this.pending.get(key);
      if (pending && (pending.file !== file || pending.fingerprint !== fingerprint)) {
        return { ok: false, outcome: "uncertain", message: "上一次图片登记结果尚未确认，请保留当前页面、原图片和原内容，使用原保存按钮重试。" };
      }
      if (!pending) {
        let payload: Record<string, unknown>;
        try { payload = await upload(); }
        catch (error) {
          return { ok: false, outcome: "definite", message: error instanceof Error ? error.message : "图片上传未完成，尚未提交登记。" };
        }
        pending = { file, fingerprint, payload, uncertain: false };
        this.pending.set(key, pending);
      }
      try {
        const data = await register(pending.payload);
        this.pending.delete(key);
        return { ok: true, data };
      } catch (error) {
        const definite = error instanceof ImageRegistrationError && error.outcome === "not_committed" && !pending.uncertain;
        if (definite) {
          this.pending.delete(key);
          return { ok: false, outcome: "definite", code: error.code, message: error.message };
        }
        // A denial of this retry does not establish the result of its predecessor.
        pending.uncertain = true;
        return {
          ok: false, outcome: "uncertain", code: error instanceof ImageRegistrationError ? error.code : undefined,
          message: "图片登记结果尚未确认，文件已保留。请勿重复上传或更改内容，请保留当前页面、原图片并使用原保存按钮重试。",
        };
      }
    } finally {
      this.busy.delete(key);
    }
  }
}
