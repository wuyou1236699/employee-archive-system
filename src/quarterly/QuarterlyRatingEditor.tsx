import { useEffect, useState } from "react";
import {
  calculateQuarterlyTotal,
  getQuarterlyValidationReport,
  quarterlyGradeForScore,
} from "./quarterlyValidation";
import { QUARTERLY_SCORING_STANDARD } from "./scoringStandards";
import {
  QUARTERLY_DIMENSIONS,
  type QuarterlyDimension,
  type QuarterlyGrade,
  type QuarterlyReasons,
  type QuarterlyScores,
} from "./types";

const GRADE_ORDER: readonly QuarterlyGrade[] = ["A", "B", "C", "D"];
const GRADE_LABELS: Record<QuarterlyGrade, string> = {
  A: "优秀",
  B: "良好",
  C: "合格",
  D: "不合格",
};

interface QuarterlyRatingEditorProps {
  scores: QuarterlyScores;
  reasons: QuarterlyReasons;
  onScoreChange: (dimension: QuarterlyDimension, value: string) => void;
  onReasonChange: (dimension: QuarterlyDimension, value: string) => void;
  disabled: boolean;
  errors?: Partial<Record<QuarterlyDimension, string>>;
  showSummary?: boolean;
  showErrors?: boolean;
  inputLabelPrefix?: string;
}

export function QuarterlyRatingEditor({
  scores,
  reasons,
  onScoreChange,
  onReasonChange,
  disabled,
  errors = {},
  showSummary = true,
  showErrors = false,
  inputLabelPrefix = "",
}: QuarterlyRatingEditorProps) {
  const total = calculateQuarterlyTotal(scores);
  const validation = getQuarterlyValidationReport(scores, reasons, "submit");
  const completedCount = QUARTERLY_DIMENSIONS.filter((dimension) => quarterlyGradeForScore(scores[dimension]) !== null).length;
  const missingReasonCount = QUARTERLY_DIMENSIONS.filter((dimension) => {
    const grade = quarterlyGradeForScore(scores[dimension]);
    return (grade === "A" || grade === "D") && !reasons[dimension].trim();
  }).length;
  const scoreProgressText = completedCount < QUARTERLY_DIMENSIONS.length
    ? "还有 " + (QUARTERLY_DIMENSIONS.length - completedCount) + " 个维度未评分"
    : "六个维度均已评分";
  const submitProgressText = validation.ok
    ? "六维评分与理由要求均已满足"
    : missingReasonCount > 0
      ? "还需补充 " + missingReasonCount + " 项 A / D 档理由"
      : "完成六个维度的评分后即可提交";

  return (
    <div className="quarterly-rating-area">
      {showSummary ? (
        <>
          <div className="quarterly-rating-instructions">
            <strong>请按行为标准逐维评分</strong>
            <span>先选择 A / B / C / D 档，再从对应范围中选择整数分数；A、D 档需填写评价理由。</span>
          </div>
          <div className="quarterly-score-summary" aria-live="polite">
            <div className="quarterly-score-summary-item quarterly-score-total">
              <span>当前总分</span>
              <strong>{total === null ? "—" : total}</strong>
              <small>六个维度满分 150 分</small>
            </div>
            <div className="quarterly-score-summary-item quarterly-score-progress">
              <span>评分进度</span>
              <strong>{completedCount} / {QUARTERLY_DIMENSIONS.length} 个维度</strong>
              <progress max={QUARTERLY_DIMENSIONS.length} value={completedCount} aria-label={"已完成 " + completedCount + " 个维度"} />
              <small>{scoreProgressText}</small>
            </div>
            <div className="quarterly-score-summary-item quarterly-score-readiness">
              <span>提交状态</span>
              <strong>{validation.ok ? "可提交" : "待完善"}</strong>
              <small>{submitProgressText}</small>
            </div>
          </div>
        </>
      ) : null}
      <div className="quarterly-rating-surface">
        {QUARTERLY_DIMENSIONS.map((dimension, index) => (
          <QuarterlyDimensionCard
            key={dimension}
            dimension={dimension}
            number={index + 1}
            score={scores[dimension]}
            reason={reasons[dimension]}
            error={errors[dimension] ?? null}
            disabled={disabled}
            showErrors={showErrors}
            inputLabelPrefix={inputLabelPrefix}
            onScoreChange={(value) => onScoreChange(dimension, value)}
            onReasonChange={(value) => onReasonChange(dimension, value)}
          />
        ))}
      </div>
    </div>
  );
}

interface QuarterlyDimensionCardProps {
  dimension: QuarterlyDimension;
  number: number;
  score: number | null;
  reason: string;
  error: string | null;
  disabled: boolean;
  showErrors: boolean;
  inputLabelPrefix: string;
  onScoreChange: (value: string) => void;
  onReasonChange: (value: string) => void;
}

function QuarterlyDimensionCard({
  dimension,
  number,
  score,
  reason,
  error,
  disabled,
  showErrors,
  inputLabelPrefix,
  onScoreChange,
  onReasonChange,
}: QuarterlyDimensionCardProps) {
  const standard = QUARTERLY_SCORING_STANDARD.dimensions.find((item) => item.name === dimension);
  const gradeStandards = standard?.grades;
  const dimensionWeight = standard?.weight ?? 25;
  const initialGrade = quarterlyGradeForScore(score);
  const [selectedGrade, setSelectedGrade] = useState<QuarterlyGrade | null>(initialGrade);
  const [expandedGrades, setExpandedGrades] = useState<Set<QuarterlyGrade>>(
    () => initialGrade === null ? new Set() : new Set([initialGrade]),
  );

  useEffect(() => {
    const scoreGrade = quarterlyGradeForScore(score);
    if (scoreGrade !== null) setSelectedGrade(scoreGrade);
  }, [score]);

  useEffect(() => {
    if (selectedGrade === null) return;
    setExpandedGrades((current) => current.size === 1 && current.has(selectedGrade) ? current : new Set([selectedGrade]));
  }, [selectedGrade]);

  if (!gradeStandards) return null;

  const selectedStandard = selectedGrade === null ? null : gradeStandards[selectedGrade];
  const scoreOptions = selectedStandard
    ? Array.from(
      { length: selectedStandard.max - selectedStandard.min + 1 },
      (_, index) => selectedStandard.min + index,
    )
    : [];
  const scoreIsInSelectedRange = selectedStandard !== null
    && score !== null
    && Number.isInteger(score)
    && score >= selectedStandard.min
    && score <= selectedStandard.max;
  const isAllExpanded = GRADE_ORDER.every((grade) => expandedGrades.has(grade));
  const requiresReason = selectedGrade === "A" || selectedGrade === "D";
  const showReason = requiresReason || reason.trim().length > 0;
  const visibleError = (showErrors || selectedGrade !== null || score !== null || reason.trim().length > 0) ? error : null;
  const displayedError = visibleError && score === null
    ? selectedGrade === null
      ? "请先选择评分档位，再选择该档的具体分数；档位选择不等于具体分数。"
      : "请选择所选档位内的具体分数；档位选择不等于具体分数。"
    : visibleError;

  function selectGrade(grade: QuarterlyGrade): void {
    const range = QUARTERLY_SCORING_STANDARD.dimensions.find((item) => item.name === dimension)?.grades[grade];
    if (!range) return;
    setSelectedGrade(grade);
    setExpandedGrades(new Set([grade]));
    if (score !== null && (!Number.isInteger(score) || score < range.min || score > range.max)) onScoreChange("");
  }

  function toggleGradeDetails(grade: QuarterlyGrade): void {
    setExpandedGrades((current) => {
      const next = new Set(current);
      if (next.has(grade)) next.delete(grade);
      else next.add(grade);
      return next;
    });
  }

  function toggleAllDetails(): void {
    setExpandedGrades(isAllExpanded ? new Set() : new Set(GRADE_ORDER));
  }

  return (
    <article data-quarterly-dimension={dimension} className={"quarterly-dimension-card" + (selectedGrade === null ? "" : " has-selected-grade")}>
      <header className="quarterly-dimension-card-heading">
        <span className="quarterly-dimension-number">{number}</span>
        <div className="quarterly-dimension-title">
          <h3>{dimension}</h3>
          <span>{dimensionWeight} 分</span>
        </div>
        <span className={"quarterly-dimension-selection" + (selectedGrade === null ? " is-pending" : "")}>
          {selectedGrade === null ? "待评分" : "已选 " + selectedGrade + " 档"}
        </span>
        <button className="quarterly-expand-all" type="button" aria-expanded={isAllExpanded} onClick={toggleAllDetails}>
          {isAllExpanded ? "收起全部" : "展开全部"}
        </button>
      </header>

      <fieldset data-quarterly-grade-picker="" className="quarterly-grade-fieldset" disabled={disabled} aria-invalid={selectedGrade === null && Boolean(displayedError)}>
        <legend>选择评分档位<em>*</em></legend>
        <div className="quarterly-grade-list">
          {GRADE_ORDER.map((grade) => {
            const gradeStandard = gradeStandards[grade];
            const expanded = expandedGrades.has(grade);
            const selected = selectedGrade === grade;
            const inputId = "quarterly-grade-" + number + "-" + grade;
            return (
              <div className={"quarterly-grade-choice quarterly-grade-" + grade.toLowerCase() + (selected ? " is-selected" : "")} key={grade}>
                <input
                  id={inputId}
                  className="quarterly-grade-radio"
                  type="radio"
                  name={"quarterly-grade-" + number}
                  value={grade}
                  checked={selected}
                  disabled={disabled}
                  aria-label={grade + " · " + GRADE_LABELS[grade]}
                  aria-invalid={selectedGrade === null && Boolean(displayedError)}
                  onChange={() => selectGrade(grade)}
                />
                <label className="quarterly-grade-label" htmlFor={inputId}>
                  <span className={"quarterly-grade-tag quarterly-grade-tag-" + grade.toLowerCase()}>{grade} · {GRADE_LABELS[grade]}</span>
                  <span className="quarterly-grade-range">{gradeStandard.score} 分</span>
                </label>
                <button
                  className="quarterly-grade-toggle"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={"quarterly-grade-details-" + number + "-" + grade}
                  onClick={() => toggleGradeDetails(grade)}
                >
                  {expanded ? "收起" : "查看评分标准"} <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
                </button>
                <div
                  id={"quarterly-grade-details-" + number + "-" + grade}
                  className="quarterly-grade-details"
                  hidden={!expanded}
                >
                  <ul>
                    {gradeStandard.items.map((item) => (
                      <li key={grade + "-" + item.label}>
                        <strong>{item.label}：</strong>
                        <span>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>

      {selectedGrade !== null && selectedStandard ? (
        <div className="quarterly-score-entry">
          <label className="field">
            <span className="field-label">该维度得分<em>*</em></span>
            <span className="field-hint">请选择 {selectedStandard.min}–{selectedStandard.max} 之间的整数</span>
            <select
              data-quarterly-score-select=""
              className="field-control quarterly-score-input"
              aria-label={inputLabelPrefix + dimension + "分数"}
              aria-invalid={Boolean(displayedError)}
              value={scoreIsInSelectedRange ? score : ""}
              disabled={disabled}
              onChange={(event) => onScoreChange(event.target.value)}
            >
              <option value="">请选择分数</option>
              {scoreOptions.map((value) => <option value={value} key={value}>{value} 分</option>)}
            </select>
          </label>
          <span className="quarterly-score-range-note">{selectedStandard.score} 分</span>
        </div>
      ) : (
        <p className="quarterly-score-prompt">先选择 A、B、C 或 D 档，再选择该档对应范围内的分数。</p>
      )}

      {showReason ? (
        <label className="field quarterly-reason-field">
          <span className="field-label">
            {selectedGrade === "A" ? "优秀理由" : selectedGrade === "D" ? "不合格理由" : "补充说明"}
            {requiresReason ? <em>*（必填）</em> : <span className="quarterly-optional-label">（选填）</span>}
          </span>
          <textarea
            className="field-control field-textarea"
            aria-label={inputLabelPrefix + dimension + "评价理由"}
            rows={3}
            value={reason}
            disabled={disabled}
            placeholder={selectedGrade === "A"
              ? "请说明评为优秀的依据和具体表现。"
              : selectedGrade === "D"
                ? "请说明评为不合格的原因和具体问题。"
                : "补充本维度的具体事实和反馈。"}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </label>
      ) : null}
      {displayedError ? <p className="quarterly-dimension-error" role="alert">{displayedError}</p> : null}
    </article>
  );
}
