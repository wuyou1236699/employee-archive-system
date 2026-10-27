import { QUARTERLY_DIMENSIONS, type QuarterlyDimension, type QuarterlyGrade, type QuarterlyReasons, type QuarterlyScores } from "./types";

export const QUARTERLY_SCORE_MIN = 0;
export const QUARTERLY_SCORE_MAX = 25;

export type QuarterlyValidationMode = "draft" | "submit";

export interface QuarterlyValidationReport {
  ok: boolean;
  total: number | null;
  errors: Partial<Record<QuarterlyDimension, string>>;
  message: string;
}

export function quarterlyGradeForScore(score: number | null): QuarterlyGrade | null {
  if (score === null || !Number.isInteger(score) || score < QUARTERLY_SCORE_MIN || score > QUARTERLY_SCORE_MAX) {
    return null;
  }
  if (score >= 21) return "A";
  if (score >= 16) return "B";
  if (score >= 10) return "C";
  return "D";
}

export function calculateQuarterlyTotal(scores: QuarterlyScores): number | null {
  let total = 0;
  for (const dimension of QUARTERLY_DIMENSIONS) {
    const score = scores[dimension];
    if (!Number.isInteger(score) || score === null || score < QUARTERLY_SCORE_MIN || score > QUARTERLY_SCORE_MAX) {
      return null;
    }
    total += score;
  }
  return total;
}

export function getQuarterlyValidationReport(
  scores: QuarterlyScores,
  reasons: QuarterlyReasons,
  mode: QuarterlyValidationMode,
): QuarterlyValidationReport {
  const errors: Partial<Record<QuarterlyDimension, string>> = {};

  for (const dimension of QUARTERLY_DIMENSIONS) {
    const score = scores[dimension];
    if (score === null) {
      if (mode === "submit") errors[dimension] = "请填写这一维度的分数。";
      continue;
    }
    if (!Number.isInteger(score) || score < QUARTERLY_SCORE_MIN || score > QUARTERLY_SCORE_MAX) {
      errors[dimension] = "分数必须是 0—25 的整数。";
      continue;
    }

    const grade = quarterlyGradeForScore(score);
    const reason = reasons[dimension];
    if (mode === "submit" && (grade === "A" || grade === "D") && (!reason || !reason.trim())) {
      errors[dimension] = `${grade} 档需要填写评价理由。`;
    }
  }

  const errorMessages = QUARTERLY_DIMENSIONS
    .map((dimension) => errors[dimension])
    .filter((message): message is string => Boolean(message));

  return {
    ok: errorMessages.length === 0,
    total: calculateQuarterlyTotal(scores),
    errors,
    message: errorMessages.join(" "),
  };
}

export function isQuarterlyDimension(value: unknown): value is QuarterlyDimension {
  return typeof value === "string" && (QUARTERLY_DIMENSIONS as readonly string[]).includes(value);
}

export function isQuarterlyGrade(value: unknown): value is QuarterlyGrade {
  return value === "A" || value === "B" || value === "C" || value === "D";
}
