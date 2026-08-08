// Feature F — independence profile (F1–F6) and Feature G — dependency
// dashboard data (G1–G4). Measurement framework M1–M5.
//
// Everything here is deterministic arithmetic over the `independence_daily`
// counters (F6: no generative scoring). Nothing in this module talks to a model,
// a database, or the network — pass it rows, get facts back.
//
// ---------------------------------------------------------------------------
// R1 — THERE IS NO COMPOSITE SCORE, AND THERE MUST NEVER BE ONE.
//
// The research document rejects a single "Cognitive Independence / Brain Score"
// as "scientifically indefensible as one number". These dimensions measure
// different behaviours over different denominators with different sample sizes;
// averaging them would invent a quantity no evidence supports and would hide the
// sample size that makes each figure readable.
//
// So: this module exports no mean, no weighted sum, no index, no rank, and no
// helper that reduces `Dimension[]` to a scalar. If you are about to add one,
// the answer is no — show the dimensions side by side instead (F1, F5).
// ---------------------------------------------------------------------------
//
// F4 / M5: every figure produced here is a behavioural proxy measured inside
// Anchor, not a validated psychological construct. The UI must render
// PROXY_DISCLAIMER (lib/research/types.ts) next to any of these numbers, and no
// caller may describe them as intelligence, ability, or IQ (A8, G4).

import type { Dimension, IndependenceProfile } from "./types";
import { daysBetween } from "../streak";

/** One row of `independence_daily`. Column names match the migration exactly. */
export interface IndependenceDailyRow {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;

  // Primary outcomes (M1)
  unaided_attempts: number;
  unaided_correct: number;
  delayed_retention_due: number;
  delayed_retention_correct: number;
  transfer_attempts: number;
  transfer_correct: number;

  // Secondary (M2)
  total_attempts: number;
  hints_requested: number;
  solutions_revealed: number;
  skipped: number;
  median_think_ms: number | null;
  /**
   * Mean |stated confidence − outcome| for that day, in percentage points
   * (0–100), as produced by `calibrationError` in ./calibration. Null on days
   * where no confidence rating was recorded.
   */
  calibration_error: number | null;
  self_explanations: number;

  // Dependence signal (M4)
  assisted_correct: number;
  assisted_attempts: number;
}

export type DimensionKey = Dimension["key"];

/**
 * Below this many observations a dimension reports `value: null`. A figure
 * computed from three attempts is noise with a decimal point on it, and F3/F4
 * require that uncertainty be shown rather than papered over.
 */
export const MIN_SAMPLE = 5;

/** z for a two-sided 95% interval. */
export const Z_95 = 1.959963985;

export const DIMENSION_ORDER: DimensionKey[] = [
  "unaided_accuracy",
  "hint_reliance",
  "persistence",
  "delayed_retention",
  "transfer",
  "calibration",
];

interface DimensionMeta {
  label: string;
  lowerIsBetter: boolean;
  /** Plain-language sentence stating exactly what is counted (G1, F4). */
  what: string;
}

const META: Record<DimensionKey, DimensionMeta> = {
  unaided_accuracy: {
    label: "Unaided accuracy",
    lowerIsBetter: false,
    what:
      "Items you answered correctly with no hint and no worked solution, out of every item you attempted unaided.",
  },
  hint_reliance: {
    label: "Hint reliance",
    lowerIsBetter: true,
    what:
      "Items where you asked for at least one hint, out of every item you attempted.",
  },
  persistence: {
    label: "Persistence",
    lowerIsBetter: false,
    what:
      "Items you stayed with, out of every item you attempted. Skipping is the only thing counted against this.",
  },
  delayed_retention: {
    label: "Delayed retention",
    lowerIsBetter: false,
    what:
      "Review items you got right when they came back a day or more later, out of every review that fell due.",
  },
  transfer: {
    label: "Transfer",
    lowerIsBetter: false,
    what:
      "Items set in a new context that you got right, out of every transfer item you attempted.",
  },
  calibration: {
    label: "Calibration error",
    lowerIsBetter: true,
    what:
      "The average distance between the confidence you stated before answering and whether you turned out to be right. Zero means your rating matched the outcome every time.",
  },
};

// ---------------------------------------------------------------------------
// Wilson score interval (F3)
// ---------------------------------------------------------------------------

/**
 * 95% Wilson score interval half-width, in percentage points.
 *
 * The interval is centred on the Wilson centre, not on the raw proportion, so
 * `value ± ci` is a close approximation rather than the exact interval — it is
 * the standard way to attach a single uncertainty number to a displayed rate.
 *
 * Known values (95%): 5/10 → ±26.34, 0/10 → ±13.88, 10/10 → ±13.88,
 * 50/100 → ±9.62, 80/100 → ±7.77.
 *
 * With no observations the honest answer is "anywhere in 0–100", so this
 * returns 50 rather than a falsely tight 0.
 */
export function wilsonInterval(successes: number, n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 50;
  const k = Math.min(Math.max(successes, 0), n);
  const p = k / n;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / n;
  const half =
    (Z_95 / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return half * 100;
}

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

function sortByDay(rows: IndependenceDailyRow[]): IndependenceDailyRow[] {
  return [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Rows falling in the `length`-day window that ends `offsetBack` days before
 * `anchor`. offsetBack = 0 gives the most recent window; offsetBack = length
 * gives the previous equivalent window.
 */
function windowOf(
  sorted: IndependenceDailyRow[],
  anchor: string,
  length: number,
  offsetBack: number,
): IndependenceDailyRow[] {
  const span = Math.max(1, Math.floor(length));
  return sorted.filter((row) => {
    const age = daysBetween(row.day, anchor);
    return age >= offsetBack && age <= offsetBack + span - 1;
  });
}

// ---------------------------------------------------------------------------
// Per-dimension arithmetic
// ---------------------------------------------------------------------------

interface Ratio {
  /** Numerator. For calibration this is a derived quantity, not a head count. */
  successes: number;
  /** Denominator, and the sample size shown to the student. */
  n: number;
}

function sum(rows: IndependenceDailyRow[], pick: (r: IndependenceDailyRow) => number): number {
  return rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
}

/**
 * Attempt-weighted mean of the daily calibration error, in percentage points.
 * Days with no recorded rating contribute nothing. `n` is the number of
 * attempts on the days that did record one — the closest honest denominator the
 * daily rollup carries.
 */
function calibrationMean(rows: IndependenceDailyRow[]): { mean: number; n: number } {
  let weighted = 0;
  let n = 0;
  for (const row of rows) {
    if (row.calibration_error === null || !Number.isFinite(row.calibration_error)) continue;
    const weight = Math.max(1, row.total_attempts || 0);
    weighted += clamp(row.calibration_error, 0, 100) * weight;
    n += weight;
  }
  return { mean: n > 0 ? weighted / n : 0, n };
}

function ratioFor(key: DimensionKey, rows: IndependenceDailyRow[]): Ratio {
  switch (key) {
    case "unaided_accuracy":
      return {
        successes: sum(rows, (r) => r.unaided_correct),
        n: sum(rows, (r) => r.unaided_attempts),
      };
    case "hint_reliance":
      return {
        successes: sum(rows, (r) => r.hints_requested),
        n: sum(rows, (r) => r.total_attempts),
      };
    case "persistence": {
      const n = sum(rows, (r) => r.total_attempts);
      const skipped = sum(rows, (r) => r.skipped);
      return { successes: Math.max(0, n - skipped), n };
    }
    case "delayed_retention":
      return {
        successes: sum(rows, (r) => r.delayed_retention_correct),
        n: sum(rows, (r) => r.delayed_retention_due),
      };
    case "transfer":
      return {
        successes: sum(rows, (r) => r.transfer_correct),
        n: sum(rows, (r) => r.transfer_attempts),
      };
    case "calibration": {
      // Calibration error is a mean of values bounded in [0, 1] rather than a
      // count, so it is expressed as an equivalent proportion. A Bernoulli
      // variable has the largest variance of any [0, 1] variable with the same
      // mean, so the Wilson width computed from it is conservative — it
      // overstates the uncertainty, which is the safe direction.
      const { mean, n } = calibrationMean(rows);
      return { successes: (mean / 100) * n, n };
    }
  }
}

/** Rate for a dimension in percentage points, or null below the sample floor. */
function rateFor(key: DimensionKey, rows: IndependenceDailyRow[]): number | null {
  const { successes, n } = ratioFor(key, rows);
  if (n < MIN_SAMPLE) return null;
  return (successes / n) * 100;
}

function definitionFor(
  key: DimensionKey,
  ratio: Ratio,
  days: number,
): string {
  const { what } = META[key];
  const window = `the last ${days} ${days === 1 ? "day" : "days"}`;

  if (ratio.n === 0) return `${what} Nothing counted in ${window} yet.`;

  const counted =
    key === "calibration"
      ? `Counted across ${ratio.n} ${ratio.n === 1 ? "attempt" : "attempts"} on the days you rated your confidence, in ${window}.`
      : `Counted ${Math.round(ratio.successes)} of ${ratio.n} in ${window}.`;

  if (ratio.n < MIN_SAMPLE) {
    return `${what} ${counted} That is under the ${MIN_SAMPLE}-item floor, so no figure is shown.`;
  }
  return `${what} ${counted}`;
}

function buildDimension(
  key: DimensionKey,
  current: IndependenceDailyRow[],
  previous: IndependenceDailyRow[],
  days: number,
): Dimension {
  const ratio = ratioFor(key, current);
  const enough = ratio.n >= MIN_SAMPLE;
  return {
    key,
    label: META[key].label,
    value: enough ? round1((ratio.successes / ratio.n) * 100) : null,
    ci: enough ? round1(wilsonInterval(ratio.successes, ratio.n)) : null,
    sample: ratio.n,
    lowerIsBetter: META[key].lowerIsBetter,
    definition: definitionFor(key, ratio, days),
    trend: trendBetween(key, current, previous),
  };
}

// ---------------------------------------------------------------------------
// Trend (G1) — "hint reliance down 14 points this week"
// ---------------------------------------------------------------------------

function trendBetween(
  key: DimensionKey,
  current: IndependenceDailyRow[],
  previous: IndependenceDailyRow[],
): number | null {
  const now = rateFor(key, current);
  const before = rateFor(key, previous);
  if (now === null || before === null) return null;
  return round1(now - before);
}

/**
 * Change in a dimension against the previous equivalent window, in percentage
 * points. Positive means the figure went up; whether up is good depends on
 * `Dimension.lowerIsBetter`, which the caller already has.
 *
 * `windowDays` defaults to half the span the rows cover, so passing two weeks of
 * rows compares this week with last week. Returns null when either window is
 * under the sample floor — no trend claim without the data to support it.
 */
export function trend(
  rows: IndependenceDailyRow[],
  key: DimensionKey,
  windowDays?: number,
): number | null {
  const sorted = sortByDay(rows);
  if (sorted.length === 0) return null;

  const anchor = sorted[sorted.length - 1].day;
  const span = daysBetween(sorted[0].day, anchor) + 1;
  const window = Math.max(1, Math.floor(windowDays ?? Math.ceil(span / 2)));

  return trendBetween(
    key,
    windowOf(sorted, anchor, window, 0),
    windowOf(sorted, anchor, window, window),
  );
}

// ---------------------------------------------------------------------------
// Assisted − unaided gap (M4, E4) — the dependence signal
// ---------------------------------------------------------------------------

function gapDetail(rows: IndependenceDailyRow[]): { gap: number | null; sample: number } {
  const assistedAttempts = sum(rows, (r) => r.assisted_attempts);
  const assistedCorrect = sum(rows, (r) => r.assisted_correct);
  const unaidedAttempts = sum(rows, (r) => r.unaided_attempts);
  const unaidedCorrect = sum(rows, (r) => r.unaided_correct);

  // The smaller arm is what limits the comparison, so that is the sample size
  // worth showing — quoting the total would flatter a lopsided split.
  const sample = Math.min(assistedAttempts, unaidedAttempts);
  if (assistedAttempts < MIN_SAMPLE || unaidedAttempts < MIN_SAMPLE) {
    return { gap: null, sample };
  }

  const assisted = (assistedCorrect / assistedAttempts) * 100;
  const unaided = (unaidedCorrect / unaidedAttempts) * 100;
  return { gap: round1(assisted - unaided), sample };
}

/**
 * Assisted accuracy minus unaided accuracy, in percentage points (M4).
 *
 * A large positive number means performance leans on the assistance rather than
 * on what the student can do alone. It is a dependence signal, not a verdict on
 * the student (G3 — never shame). Null until both arms clear the sample floor.
 */
export function assistedUnaidedGap(rows: IndependenceDailyRow[]): number | null {
  return gapDetail(rows).gap;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Builds the independence profile for the `days`-long window ending on the most
 * recent day present in `rows` (F1, F2).
 *
 * Pass more than `days` of rows — ideally 2 × `days` — and each dimension also
 * gets its change against the previous equivalent window (G1). Rows outside
 * both windows are ignored, and rows may arrive in any order.
 *
 * Returns dimensions only. There is no overall figure, by design (R1).
 */
export function buildProfile(
  rows: IndependenceDailyRow[],
  days: number,
): IndependenceProfile {
  const window = Math.max(1, Math.floor(days));
  const sorted = sortByDay(rows);
  const anchor = sorted.length > 0 ? sorted[sorted.length - 1].day : null;

  const current = anchor === null ? [] : windowOf(sorted, anchor, window, 0);
  const previous = anchor === null ? [] : windowOf(sorted, anchor, window, window);

  const { gap, sample } = gapDetail(current);

  return {
    dimensions: DIMENSION_ORDER.map((key) =>
      buildDimension(key, current, previous, window),
    ),
    assistedUnaidedGap: gap,
    gapSample: sample,
    daysCovered: window,
  };
}

// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
