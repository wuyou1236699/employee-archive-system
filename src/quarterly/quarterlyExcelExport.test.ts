// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workbook } from "exceljs";
import { downloadQuarterlyEvaluationWorkbook } from "./quarterlyExcelExport";
import { LocalPreviewQuarterlyReviewService } from "../services/quarterlyReviewService";
import type { QuarterlyRecord } from "./types";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("quarterly workbook export", () => {
  it("exports three ordered sheets with scores and reasons, excluding drafts and other quarters", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const original = service.listRecordsAll({ periodKey: "2026-Q3", type: "all", status: "submitted", keyword: "" })[0];
    expect(original).toBeDefined();
    const records: QuarterlyRecord[] = (["self", "first", "second"] as const).map((type) => ({ ...original, id: `sample-${type}`, type, evaluatorNameSnapshot: "测试评价人", evaluateeNameSnapshot: `测试对象-${type}`, reasons: { ...original.reasons, 任务完成: "测试文字理由" } }));
    records.push({ ...records[0], id: "draft", status: "draft", evaluateeNameSnapshot: "不应导出的草稿" });
    records.push({ ...records[0], id: "other-quarter", periodKey: "2026-Q2" });
    let captured: NodeBlob | undefined;
    vi.stubGlobal("Blob", NodeBlob);
    const create = vi.fn((blob: NodeBlob) => { captured = blob; return "blob:test-export"; });
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const count = await downloadQuarterlyEvaluationWorkbook(records, "2026-Q3", "测试季度", "all");
    expect(count).toBe(3);
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    if (!captured) throw new Error("Workbook download missing");
    const book = new Workbook();
    const buffer = Buffer.from(await captured.arrayBuffer());
    await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["自评", "一次评价", "二次评价"]);
    for (const sheet of book.worksheets) {
      expect(sheet.rowCount).toBe(3);
      expect(sheet.getCell("D3").value).toBe("测试评价人");
      expect(sheet.getCell("J3").value).toBe("测试文字理由");
      expect(sheet.getCell("C3").value).toMatchObject({ result: original.total });
    }
  });

  it("retains empty sheets when one review type has no submitted records", async () => {
    const service = new LocalPreviewQuarterlyReviewService();
    const records = service.listRecordsAll({ periodKey: "2026-Q3", type: "all", status: "submitted", keyword: "" });
    let captured: NodeBlob | undefined;
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("URL", { createObjectURL: (blob: NodeBlob) => { captured = blob; return "blob:test-empty"; }, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await downloadQuarterlyEvaluationWorkbook(records, "2026-Q3", "测试季度", "all");
    if (!captured) throw new Error("Workbook download missing");
    const book = new Workbook();
    await book.xlsx.load(Buffer.from(await captured.arrayBuffer()) as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets).toHaveLength(3);
    expect(book.getWorksheet("自评")?.rowCount).toBe(2);
    expect(book.getWorksheet("二次评价")?.rowCount).toBe(3);
  });
});
