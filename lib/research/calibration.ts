// Feature H — reflection and confidence calibration (H1–H6).
//
// The student states a confidence BEFORE submitting (H1). After deterministic
// grading we compare what they predicted with what happened (H2), bucket it into
// a curve that separates over- from under-confidence (H3), and report the mean
// calibration error (H4).
//
// Everything here is arithmetic. Confidence is student-supplied and correctness
// comes from key-based grading, so no model is involved in either input — the
// LLM never adjudicates correctness (I6).
//
// H6: the verdict text stays on the task and always carries an action prompt.
// It never describes the student, only what happened on which items.
//
// Units: confidence is 0–100, correctness is treated as 0 or 100, so every
// number this module returns is in percentage points. `independence_daily.
// calibration_error` stores the output of `calibrationError` unchanged.

/** One graded item with the confidence stated before the answer was submitted. */
export interface CalibrationPoint {
  /** 0–100, captured before submitting (H1). */
  confidence: number;
  correct: boolean;
}

export type CalibrationClass = "overconfident" | "underconfident" | "calibrated";

export interface CalibrationBin {
  /** Bucket index, 0 = lowest confidence band. */
  bin: number;
  /** Band this bucket covers, e.g. "80–100%". */
  rangeLabel: string;
  meanConfidence: number;
  actualAccuracy: number;
  n: number;
  /** meanConfidence − actualAccuracy, in percentage points. */
  gap: number;
  classification: CalibrationClass;
}

/**
 * A gap this size or smaller counts as calibrated. Confidence ratings are
 * coarse; calling a 6-point gap a miscalibration would be reading noise.
 */
export const CALIBRATION_TOLERANCE_PP = 10;

/** A bucket under this many items is too thin to draw a conclusion from. */
export const MIN_BIN_SAMPLE = 3;

const DEFAULT_BINS = 5;

/**
 * Mean absolute difference between stated confidence and outcome, in percentage
 * points (H4). 0 means every rating matched the result; 100 means every rating
 * was exactly backwards. Null when nothing was rated.
 *
 * This is an absolute-error measure, so it rewards being sure and being right.
 * Someone who says 70% and is right 70% of the time still scores 42 here.
 * Band-level calibration is what `calibrationCurve` shows; read the two together.
 */
export function calibrationError(points: CalibrationPoint[]): number | null {
  if (points.length === 0) return null;
  const total = points.reduce((sum, point) => {
    const stated = clamp(point.confidence, 0, 100);
    return sum + Math.abs(stated - (point.correct ? 100 : 0));
  }, 0);
  return round1(total / points.length);
}

/**
 * Confidence buckets with the accuracy actually achieved in each (H3).
 *
 * Buckets are equal-width across 0–100 and only non-empty buckets are returned,
 * so a chart can plot points rather than invent zeros. `bin` keeps the bucket
 * index, so gaps in the sequence stay visible.
 */
export function calibrationCurve(
  points: CalibrationPoint[],
  bins: number = DEFAULT_BINS,
): CalibrationBin[] {
  const count = Math.min(20, Math.max(2, Math.floor(bins) || DEFAULT_BINS));
  const width = 100 / count;

  const buckets: { confidence: number; correct: number; n: number }[] = Array.from(
    { length: count },
    () => ({ confidence: 0, correct: 0, n: 0 }),
  );

  for (const point of points) {
    const stated = clamp(point.confidence, 0, 100);
    const index = Math.min(count - 1, Math.floor(stated / width));
    const bucket = buckets[index];
    bucket.confidence += stated;
    bucket.correct += point.correct ? 1 : 0;
    bucket.n += 1;
  }

  return buckets.flatMap((bucket, index) => {
    if (bucket.n === 0) return [];
    const meanConfidence = round1(bucket.confidence / bucket.n);
    const actualAccuracy = round1((bucket.correct / bucket.n) * 100);
    const gap = round1(meanConfidence - actualAccuracy);
    return [
      {
        bin: index,
        rangeLabel: bandLabel(index, count, width),
        meanConfidence,
        actualAccuracy,
        n: bucket.n,
        gap,
        classification: classify(gap),
      },
    ];
  });
}

/**
 * One short sentence about the widest gap in the curve, with something to do
 * about it (H6). Task-focused: it names the band or the item type, never the
 * student. Pass `context` (e.g. "transfer") to name what the items were.
 */
export function calibrationVerdict(
  curve: CalibrationBin[],
  context?: string,
): string {
  const usable = curve.filter((bin) => bin.n >= MIN_BIN_SAMPLE);

  if (usable.length === 0) {
    return "Not enough confidence ratings yet. Rate how sure you are before each answer and the curve fills in.";
  }

  const widest = usable.reduce((worst, bin) =>
    Math.abs(bin.gap) > Math.abs(worst.gap) ? bin : worst,
  );

  if (widest.classification === "calibrated") {
    return `Your ratings match your results within ${CALIBRATION_TOLERANCE_PP} points in every band. Keep stating a number before you answer.`;
  }

  const where = context
    ? `on ${context} items`
    : `in the ${widest.rangeLabel} band`;
  const facts = `you rated ${widest.meanConfidence}% and got ${widest.actualAccuracy}% right`;

  if (widest.classification === "overconfident") {
    return `The widest gap is ${where}: ${facts}. Re-check one step of your working before you commit at that confidence.`;
  }
  return `The widest gap is ${where}: ${facts}. Your working is holding up better than your rating, so commit sooner there.`;
}

// ---------------------------------------------------------------------------

function classify(gap: number): CalibrationClass {
  if (gap > CALIBRATION_TOLERANCE_PP) return "overconfident";
  if (gap < -CALIBRATION_TOLERANCE_PP) return "underconfident";
  return "calibrated";
}

function bandLabel(index: number, count: number, width: number): string {
  const low = Math.round(index * width);
  const high = index === count - 1 ? 100 : Math.round((index + 1) * width) - 1;
  return `${low}–${high}%`;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
