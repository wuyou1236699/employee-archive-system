import { quarterlyGradeForScore } from "./quarterlyValidation";
import {
  QUARTERLY_DIMENSIONS,
  QUARTERLY_TYPE_LABELS,
  type QuarterlyGrade,
  type QuarterlyRecord,
  type QuarterlyReviewType,
} from "./types";

const COLOR = {
  graphite: "FF344145",
  warmWhite: "FFFAF8F3",
  sage: "FFDDE9E0",
  straw: "FFF0E3C4",
  clay: "FFEAD7D4",
} as const;

const GRADE_LABELS: Record<QuarterlyGrade, string> = {
  A: "A优秀",
  B: "B良好",
  C: "C合格",
  D: "D不合格",
};

const GRADE_COLORS: Record<QuarterlyGrade, string> = {
  A: COLOR.sage,
  B: COLOR.warmWhite,
  C: COLOR.straw,
  D: COLOR.clay,
};

const DIMENSION_TINTS = [
  COLOR.warmWhite,
  COLOR.sage,
  COLOR.warmWhite,
  COLOR.straw,
  COLOR.warmWhite,
  COLOR.clay,
] as const;

const GRADE_BUCKET_OFFSETS: Record<QuarterlyGrade, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
};

const MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function exportHeaders(): string[] {
  return [
    "评价层次/类型",
    "自评姓名/被评价人姓名",
    "总分",
    "评价人",
    ...QUARTERLY_DIMENSIONS.flatMap((dimension) => [
      `${dimension}档次`,
      `${dimension} A优秀分值`,
      `${dimension} B良好分值`,
      `${dimension} C合格分值`,
      `${dimension} D不合格分值`,
      `${dimension}评价文字`,
    ]),
  ];
}

function scoreFormula(rowNumber: number): string {
  const ranges = QUARTERLY_DIMENSIONS.map((_, index) => {
    const startColumnNumber = 6 + index * 6;
    const start = columnName(startColumnNumber);
    const end = columnName(startColumnNumber + 3);
    return `${start}${rowNumber}:${end}${rowNumber}`;
  });
  return `SUM(${ranges.join(",")})`;
}

function columnName(columnNumber: number): string {
  let number = columnNumber;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function safeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "季度评价";
}

function safeSheetName(value: string): string {
  return safeFilePart(value).slice(0, 31) || "季度评价";
}

function commentLineCount(value: string, approximateWidth = 42): number {
  return value.split(/\r\n|\r|\n/).reduce((lineCount, line) => (
    lineCount + Math.max(1, Math.ceil([...line].length / approximateWidth))
  ), 0);
}

function rowHeightForReasons(records: QuarterlyRecord): number {
  const maxLines = Math.max(...QUARTERLY_DIMENSIONS.map((dimension) => commentLineCount(records.reasons[dimension] ?? "")));
  return Math.min(409, Math.max(48, maxLines * 15 + 12));
}

function fill(color: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: color } };
}

export async function downloadQuarterlyEvaluationWorkbook(
  records: QuarterlyRecord[],
  periodKey: string,
  periodName: string,
  type: QuarterlyReviewType | "all",
): Promise<number> {
  const exportLabel = type === "all" ? "所有评价" : QUARTERLY_TYPE_LABELS[type];
  const allRecords = records
    .filter((record) => record.periodKey === periodKey && (type === "all" || record.type === type) && record.status === "submitted")
    .slice()
    .sort((left, right) => left.evaluateeNameSnapshot.localeCompare(right.evaluateeNameSnapshot, "zh-CN")
      || left.evaluatorNameSnapshot.localeCompare(right.evaluatorNameSnapshot, "zh-CN")
      || left.id.localeCompare(right.id));

  if (!allRecords.length) return 0;

  // Load the styled XLSX writer only after an administrator requests an export.
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "员工档案";
  workbook.title = `${periodName}（${periodKey}）· ${exportLabel}季度评价`;
  workbook.subject = "季度评价记录";

  const types: QuarterlyReviewType[] = type === "all" ? ["self", "first", "second"] : [type];
  for (const sheetType of types) {
    const typeLabel = QUARTERLY_TYPE_LABELS[sheetType];
    const exportRecords = allRecords.filter((record) => record.type === sheetType);
    const worksheet = workbook.addWorksheet(safeSheetName(typeLabel));
    worksheet.views = [{ state: "frozen", xSplit: 4, ySplit: 2, topLeftCell: "E3", showGridLines: false }];
    worksheet.properties.defaultRowHeight = 42;
    worksheet.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 4,
      fitToHeight: 0,
      printTitlesRow: "1:2",
      margins: { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
    };
    worksheet.columns = [
      { key: "type", width: 15 },
      { key: "evaluatee", width: 21 },
      { key: "total", width: 10 },
      { key: "evaluator", width: 20 },
      ...QUARTERLY_DIMENSIONS.flatMap((dimension) => [
        { key: `${dimension}-grade`, width: 12 },
        { key: `${dimension}-a`, width: 10 },
        { key: `${dimension}-b`, width: 10 },
        { key: `${dimension}-c`, width: 10 },
        { key: `${dimension}-d`, width: 12 },
        { key: `${dimension}-reason`, width: 42 },
      ]),
    ];

    worksheet.mergeCells("A1:AN1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `${periodName}（${periodKey}） · ${typeLabel}季度评价`;
    titleCell.fill = fill(COLOR.graphite);
    titleCell.font = { name: "微软雅黑", size: 14, bold: true, color: { argb: COLOR.warmWhite } };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    worksheet.getRow(1).height = 30;

    const header = worksheet.addRow(exportHeaders());
    header.height = 34;
    header.eachCell((cell) => {
      cell.font = { name: "微软雅黑", size: 10, bold: true, color: { argb: COLOR.graphite } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: COLOR.graphite } } };
    });
    for (let columnNumber = 1; columnNumber <= 4; columnNumber += 1) {
      const cell = header.getCell(columnNumber);
      cell.fill = fill(COLOR.graphite);
      cell.font = { name: "微软雅黑", size: 10, bold: true, color: { argb: COLOR.warmWhite } };
    }
    QUARTERLY_DIMENSIONS.forEach((_, dimensionIndex) => {
      const firstColumn = 5 + dimensionIndex * 6;
      const tint = DIMENSION_TINTS[dimensionIndex] ?? COLOR.warmWhite;
      for (let offset = 0; offset < 6; offset += 1) {
        const cell = header.getCell(firstColumn + offset);
        cell.fill = fill(tint);
        cell.font = { name: "微软雅黑", size: 10, bold: true, color: { argb: COLOR.graphite } };
      }
    });

    for (const record of exportRecords) {
      const values: Array<string | number | null> = [
        typeLabel,
        record.evaluateeNameSnapshot,
        record.total,
        record.evaluatorNameSnapshot,
      ];
      for (const dimension of QUARTERLY_DIMENSIONS) {
        const score = record.scores[dimension];
        const grade = quarterlyGradeForScore(score);
        const buckets: Array<number | null> = [null, null, null, null];
        if (grade && score !== null) buckets[GRADE_BUCKET_OFFSETS[grade] - 1] = score;
        values.push(grade ? GRADE_LABELS[grade] : "", ...buckets, record.reasons[dimension]);
      }

      const row = worksheet.addRow(values);
      const rowNumber = row.number;
      row.height = rowHeightForReasons(record);
      row.getCell(3).value = {
        formula: scoreFormula(rowNumber),
        result: record.total ?? 0,
      };
      row.getCell(3).numFmt = "0";

      for (let columnNumber = 1; columnNumber <= 4; columnNumber += 1) {
        const cell = row.getCell(columnNumber);
        cell.fill = fill(COLOR.warmWhite);
        cell.font = { name: "微软雅黑", size: 10, color: { argb: COLOR.graphite } };
        cell.alignment = { vertical: "middle", horizontal: columnNumber === 2 || columnNumber === 4 ? "left" : "center", wrapText: true };
      }

      QUARTERLY_DIMENSIONS.forEach((dimension, dimensionIndex) => {
        const firstColumn = 5 + dimensionIndex * 6;
        const groupTint = DIMENSION_TINTS[dimensionIndex] ?? COLOR.warmWhite;
        for (let offset = 0; offset < 6; offset += 1) {
          const cell = row.getCell(firstColumn + offset);
          cell.fill = fill(groupTint);
          cell.font = { name: offset === 5 ? "宋体" : "微软雅黑", size: 10, color: { argb: COLOR.graphite } };
          cell.alignment = {
            vertical: offset === 5 ? "top" : "middle",
            horizontal: offset === 5 ? "left" : "center",
            wrapText: true,
          };
        }

        const score = record.scores[dimension];
        const grade = quarterlyGradeForScore(score);
        const gradeCell = row.getCell(firstColumn);
        if (grade) {
          gradeCell.value = GRADE_LABELS[grade];
          gradeCell.fill = fill(GRADE_COLORS[grade]);
          gradeCell.font = { name: "微软雅黑", size: 10, bold: true, color: { argb: COLOR.graphite } };
          const scoreCell = row.getCell(firstColumn + GRADE_BUCKET_OFFSETS[grade]);
          scoreCell.value = score;
          scoreCell.fill = fill(GRADE_COLORS[grade]);
          scoreCell.font = { name: "微软雅黑", size: 10, bold: true, color: { argb: COLOR.graphite } };
          scoreCell.numFmt = "0";
        }
      });
    }

    worksheet.autoFilter = { from: "A2", to: `AN${worksheet.rowCount}` };
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "hair", color: { argb: "FFD2D2CE" } },
          bottom: { style: "hair", color: { argb: "FFD2D2CE" } },
          left: { style: "hair", color: { argb: "FFD2D2CE" } },
          right: { style: "hair", color: { argb: "FFD2D2CE" } },
        };
      });
    });
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      for (let dimensionIndex = 0; dimensionIndex < QUARTERLY_DIMENSIONS.length; dimensionIndex += 1) {
        const boundary = worksheet.getRow(rowNumber).getCell(10 + dimensionIndex * 6);
        boundary.border = {
          ...boundary.border,
          right: { style: "medium", color: { argb: COLOR.graphite } },
        };
      }
    }

  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilePart(periodKey)}_季度评价_${safeFilePart(exportLabel)}.xlsx`;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return allRecords.length;
}
