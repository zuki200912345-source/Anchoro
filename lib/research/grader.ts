// Deterministic grading against the verified answer key.
//
// There is no model call in this file and there must never be one. The LLM
// phrases hints and diagnoses attempts; it never adjudicates correctness (I6).
// Every outcome below is a pure function of (item, answer), which is what makes
// key grounding the primary anti-hallucination technique (A4, I3).
//
// The key itself is server-only. Nothing here should be imported into a client
// component — items reach the browser through `items_public`, which omits
// `answer_key`, `rubric` and `worked_solution`.

import type { AttemptOutcome } from "./types";

// ---------------------------------------------------------------------------
// Key shapes
// ---------------------------------------------------------------------------

/** A single accepted string. `alternates` covers accepted synonyms and symbols. */
export interface ExactKey {
  type: "exact";
  value: string;
  alternates?: string[];
  caseSensitive?: boolean;
}

/** A number. `tolerance` is absolute; 0 means an exact match. */
export interface NumericKey {
  type: "numeric";
  value: number;
  tolerance?: number;
  /** Recorded for feedback copy only. Units are not required from the student. */
  unit?: string;
}

/** Several values at once. Unordered by default; set `ordered` when order matters. */
export interface SetKey {
  type: "set";
  values: string[];
  ordered?: boolean;
}

/**
 * Multiple choice. `index` is the 0-based position in the item's `distractors`
 * array, which holds every option in display order.
 */
export interface ChoiceKey {
  type: "choice";
  index: number;
}

/** An algebraic form. Compared after normalisation, not evaluated. */
export interface ExpressionKey {
  type: "expression";
  canonical: string;
}

export interface RubricCriterion {
  id: string;
  /** Any one keyword satisfies the criterion. Matched on word boundaries. */
  keywords: string[];
  weight: number;
}

/** Open response. `passMark` is the credit fraction needed for 'correct'. */
export interface RubricKey {
  type: "rubric";
  criteria: RubricCriterion[];
  passMark?: number;
}

export type AnswerKey =
  | ExactKey
  | NumericKey
  | SetKey
  | ChoiceKey
  | ExpressionKey
  | RubricKey;

/** The minimum an item needs to be gradeable. */
export interface GradableItem {
  stem: string;
  answer_key: AnswerKey;
  /** All options in display order, for `choice` keys. */
  distractors?: string[] | null;
}

export interface GradeResult {
  outcome: AttemptOutcome;
  /** True only when the answer matched the verified key outright. */
  matchedKey: boolean;
  /** 0–1. Whole marks for set elements, weighted marks for rubric criteria. */
  partialCredit: number;
}

/** Credit at or above this counts as 'partial' rather than 'incorrect'. */
export const PARTIAL_THRESHOLD = 0.3;
/** Rubric credit needed for 'correct' when the key does not set its own. */
export const DEFAULT_PASS_MARK = 0.8;
/** Absolute slack allowed on every numeric comparison, for float noise. */
export const FLOAT_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const DASHES = /[−‒–—―]/g;
const QUOTES = /["'‘’“”]/g;

/**
 * Text normalisation for `exact`, `set` and `choice` comparisons. NFKC folds
 * subscripts and superscripts, so a student typing MgCl₂ matches MgCl2.
 */
export function normaliseExact(raw: string, caseSensitive = false): string {
  let s = (raw ?? "").normalize("NFKC").replace(DASHES, "-").replace(QUOTES, "");
  if (!caseSensitive) s = s.toLowerCase();
  s = s
    .replace(/[;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,]+$/, "")
    .trim();
  return s;
}

/** Words, lowercased, for stem-echo detection and rubric keyword matching. */
export function tokenise(raw: string): string[] {
  return (raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Word-boundary phrase match on a normalised haystack. */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = tokenise(phrase).join(" ");
  if (!needle) return false;
  return ` ${tokenise(haystack).join(" ")} `.includes(` ${needle} `);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function stripThousands(s: string): string {
  let out = s;
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  }
  return out;
}

function preNumeric(raw: string): string {
  let s = (raw ?? "")
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(QUOTES, "")
    .toLowerCase()
    .trim();
  s = s.replace(/^[a-z]\s*=\s*/, ""); // "x = 6"
  s = s.replace(/^(?:approx\.?|approximately|about|~|≈)\s*/, "");
  s = s.replace(/^[£$€]\s*/, "");
  s = stripThousands(s);
  return s.trim();
}

/**
 * Parses a student-typed number. Handles decimals, negatives with a unicode
 * minus, fractions ("3/4"), mixed numbers ("2 1/2"), standard form
 * ("4.2 x 10^-4", "4.2e-4") and trailing units ("0.2 mol", "12 cm").
 * Returns null when the string cannot be read as a single number — refusing is
 * better than guessing (I4).
 */
export function parseNumber(raw: string): number | null {
  let s = preNumeric(raw);
  if (!s) return null;

  const mixed = s.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const den = Number(mixed[3]);
    if (den === 0) return null;
    const magnitude = Math.abs(whole) + Number(mixed[2]) / den;
    return whole < 0 ? -magnitude : magnitude;
  }

  s = s.replace(/\s+/g, "");

  const sciE = s.match(/^(-?\d*\.?\d+)e([+-]?\d+)$/);
  if (sciE) return Number(sciE[1]) * Math.pow(10, Number(sciE[2]));

  const sciPower = s.match(/^(-?\d*\.?\d+)[*x×·]10\^?\(?([+-]?\d+)\)?$/);
  if (sciPower) return Number(sciPower[1]) * Math.pow(10, Number(sciPower[2]));

  // An exponent we did not recognise: refuse rather than read the mantissa.
  if (s.includes("^")) return null;

  const frac = s.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }
  if (s.includes("/")) {
    // A value with a compound unit ("12m/s") is readable; "1/2/3" is not.
    const withUnit = s.match(/^(-?\d*\.?\d+)[a-zµΩ°%][a-zµΩ°%\d/·]*$/);
    if (!withUnit) return null;
    const value = Number(withUnit[1]);
    return Number.isFinite(value) ? value : null;
  }

  const lead = s.match(/^(-?\d*\.?\d+)/);
  if (!lead) return null;
  const value = Number(lead[1]);
  return Number.isFinite(value) ? value : null;
}

function numbersMatch(a: number, b: number, tolerance = 0): boolean {
  return Math.abs(a - b) <= Math.abs(tolerance) + FLOAT_EPSILON;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

/**
 * Normalises an algebraic answer: whitespace, the several ways students write
 * multiply (×, ·, * and " x " between numbers) and divide (÷, /), unicode
 * minus, sqrt spellings, and the order of terms in a sum.
 *
 * A lone `x` next to letters is left alone — it is the variable, not an
 * operator, so "2x + 3" survives intact.
 */
export function normaliseExpression(raw: string): string {
  let s = (raw ?? "").normalize("NFKC").replace(DASHES, "-").replace(QUOTES, "").toLowerCase().trim();

  s = s.replace(/\bthe answer is\b/g, "").replace(/\banswer\s*:/g, "");
  s = s.replace(/[·∙×]/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^");
  s = s.replace(/sqrt/g, "√").replace(/\b(?:square root of|root of|root)\b/g, "√");
  s = s.replace(/√\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g, "√$1");

  // " x " used as multiply, only between things that can be multiplied.
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(/([0-9)])\s*x\s*([0-9(√])/g, "$1*$2");
  }

  s = s.replace(/\s+/g, "").replace(/[.,]+$/, "");

  // "y = 2x+3" or "dy/dx = ..." when the key is just the right-hand side.
  const parts = s.split("=");
  if (parts.length === 2 && /^[a-z/()]{1,8}$/.test(parts[0])) s = parts[1];

  return canonicalSum(s);
}

/** Splits a top-level sum, leaving unary signs (as in 10^-4) attached. */
function splitTerms(expr: string): string[] | null {
  const terms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if ((c === "+" || c === "-") && depth === 0 && i > 0) {
      const prev = expr[i - 1];
      if (!"+-*/^(".includes(prev)) {
        terms.push(expr.slice(start, i));
        start = i;
      }
    }
  }
  if (depth !== 0) return null;
  terms.push(expr.slice(start));
  return terms;
}

/** Addition commutes, so "3+2x" and "2x+3" must land on the same string. */
function canonicalSum(expr: string): string {
  const terms = splitTerms(expr);
  if (!terms || terms.length < 2) return expr;
  const signed = terms.map((t) => (t.startsWith("+") || t.startsWith("-") ? t : `+${t}`));
  signed.sort();
  return signed.join("").replace(/^\+/, "");
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** Splits a student's list answer on commas, semicolons, "and"/"or", newlines. */
export function splitList(raw: string): string[] {
  return (raw ?? "")
    .split(/[,;\n]|\band\b|\bor\b/i)
    .map((part) => normaliseExact(part).replace(/^[a-z]\s*=\s*/, "").trim())
    .filter(Boolean);
}

function elementMatches(student: string, expected: string): boolean {
  if (student === normaliseExact(expected)) return true;
  const a = parseNumber(student);
  const b = parseNumber(expected);
  return a !== null && b !== null && numbersMatch(a, b);
}

// ---------------------------------------------------------------------------
// Low-effort detection (B7, B14)
// ---------------------------------------------------------------------------

export type LowEffortReason = "empty" | "too_short" | "stem_echo" | "duplicate";

interface LowEffortOptions {
  /** Set for numeric and choice keys, where "7" or "b" is a real answer. */
  allowShort?: boolean;
}

/**
 * Why an attempt looks like filler rather than a try. Returns null when the
 * attempt looks genuine. This gates nothing on its own — it feeds the outcome
 * so the engine can ask for a real attempt instead of handing out a hint.
 */
export function lowEffortReason(
  answer: string,
  previousAnswers: string[] = [],
  stem = "",
  options: LowEffortOptions = {},
): LowEffortReason | null {
  const norm = normaliseExact(answer ?? "");
  if (!norm) return "empty";
  if (!options.allowShort && norm.length < 2) return "too_short";

  for (const prior of previousAnswers) {
    if (normaliseExact(prior ?? "") === norm) return "duplicate";
  }

  const answerTokens = tokenise(answer);
  const stemTokens = tokenise(stem);
  if (stemTokens.length) {
    const stemJoined = stemTokens.join(" ");
    const answerJoined = answerTokens.join(" ");
    if (answerJoined.length >= 12 && stemJoined.includes(answerJoined)) return "stem_echo";
    if (stemJoined.length >= 12 && answerJoined.includes(stemJoined)) return "stem_echo";
    if (answerTokens.length >= 6) {
      const stemSet = new Set(stemTokens);
      const shared = answerTokens.filter((t) => stemSet.has(t)).length;
      if (shared / answerTokens.length >= 0.9) return "stem_echo";
    }
  }

  return null;
}

/** True when the attempt is empty, too short, a stem echo, or a repeat (B7, B14). */
export function isLowEffort(answer: string, previousAnswers: string[] = [], stem = ""): boolean {
  return lowEffortReason(answer, previousAnswers, stem) !== null;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

const MISS: GradeResult = { outcome: "incorrect", matchedKey: false, partialCredit: 0 };
const HIT: GradeResult = { outcome: "correct", matchedKey: true, partialCredit: 1 };

function gradeExact(key: ExactKey, answer: string): GradeResult {
  const cs = key.caseSensitive === true;
  const given = normaliseExact(answer, cs);
  if (!given) return MISS;
  const accepted = [key.value, ...(key.alternates ?? [])].map((v) => normaliseExact(v, cs));
  return accepted.includes(given) ? HIT : MISS;
}

function gradeNumeric(key: NumericKey, answer: string): GradeResult {
  const given = parseNumber(answer);
  if (given === null) return MISS;
  return numbersMatch(given, key.value, key.tolerance) ? HIT : MISS;
}

function gradeExpression(key: ExpressionKey, answer: string): GradeResult {
  const given = normaliseExpression(answer);
  if (!given) return MISS;
  if (given === normaliseExpression(key.canonical)) return HIT;
  // A key that is only a number stays gradeable as a number, so "0.5" matches
  // "1/2". A key with symbols in it does not: 8 is not 8√2.
  if (/^-?\d*\.?\d+$/.test(normaliseExpression(key.canonical))) {
    const a = parseNumber(answer);
    const b = parseNumber(key.canonical);
    if (a !== null && b !== null && numbersMatch(a, b)) return HIT;
  }
  return MISS;
}

function gradeSet(key: SetKey, answer: string): GradeResult {
  const given = splitList(answer);
  if (!given.length) return MISS;
  const total = key.values.length;
  let matched = 0;

  if (key.ordered) {
    for (let i = 0; i < total; i++) {
      const student = given[i];
      if (student !== undefined && elementMatches(student, key.values[i])) matched++;
    }
  } else {
    const pool = [...given];
    for (const expected of key.values) {
      const at = pool.findIndex((student) => elementMatches(student, expected));
      if (at >= 0) {
        matched++;
        pool.splice(at, 1);
      }
    }
  }

  const credit = total === 0 ? 0 : matched / total;
  if (matched === total && given.length === total) return HIT;
  if (credit >= PARTIAL_THRESHOLD) {
    return { outcome: "partial", matchedKey: false, partialCredit: credit };
  }
  return { outcome: "incorrect", matchedKey: false, partialCredit: credit };
}

function gradeChoice(key: ChoiceKey, answer: string, options?: string[] | null): GradeResult {
  const given = normaliseExact(answer);
  if (!given) return MISS;

  let chosen: number | null = null;
  const letter = given.match(/^\(?([a-z])\)?$/);
  if (letter) chosen = letter[1].charCodeAt(0) - 97;
  else if (/^\d+$/.test(given)) chosen = Number(given) - 1;

  if (chosen === null && options) {
    const labelled = given.match(/^\(?([a-z])[).:]\s*(.+)$/);
    const body = labelled ? normaliseExact(labelled[2]) : given;
    const at = options.findIndex((option) => normaliseExact(option) === body);
    if (at >= 0) chosen = at;
    else if (labelled) chosen = labelled[1].charCodeAt(0) - 97;
  }

  if (chosen === null) return MISS;
  return chosen === key.index ? HIT : MISS;
}

function gradeRubric(key: RubricKey, answer: string): GradeResult {
  const text = (answer ?? "").trim();
  if (!text) return MISS;
  const totalWeight = key.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) return MISS;

  let earned = 0;
  for (const criterion of key.criteria) {
    if (criterion.keywords.some((keyword) => containsPhrase(text, keyword))) {
      earned += criterion.weight;
    }
  }

  const credit = earned / totalWeight;
  const passMark = key.passMark ?? DEFAULT_PASS_MARK;
  if (credit >= passMark - FLOAT_EPSILON) {
    return { outcome: "correct", matchedKey: true, partialCredit: credit };
  }
  if (credit >= PARTIAL_THRESHOLD) {
    return { outcome: "partial", matchedKey: false, partialCredit: credit };
  }
  return { outcome: "incorrect", matchedKey: false, partialCredit: credit };
}

/** Which criteria an open response hit. Feeds grounded feedback, not a score. */
export function rubricBreakdown(key: RubricKey, answer: string): { id: string; met: boolean }[] {
  return key.criteria.map((criterion) => ({
    id: criterion.id,
    met: criterion.keywords.some((keyword) => containsPhrase(answer ?? "", keyword)),
  }));
}

function gradeAgainstKey(item: GradableItem, answer: string): GradeResult {
  const key = item.answer_key;
  switch (key.type) {
    case "exact":
      return gradeExact(key, answer);
    case "numeric":
      return gradeNumeric(key, answer);
    case "set":
      return gradeSet(key, answer);
    case "choice":
      return gradeChoice(key, answer, item.distractors);
    case "expression":
      return gradeExpression(key, answer);
    case "rubric":
      return gradeRubric(key, answer);
  }
}

/**
 * The only correctness authority in the product.
 *
 * A correct answer is never called low effort. Otherwise an empty, repeated or
 * stem-echoing attempt returns 'low_effort' so the engine can ask for a real
 * attempt rather than release a hint (B7, B14).
 */
export function gradeAnswer(
  item: GradableItem,
  answer: string,
  previousAnswers: string[] = [],
): GradeResult {
  const graded = gradeAgainstKey(item, answer);
  if (graded.outcome === "correct") return graded;

  // A single numeral, or a single letter on a multiple-choice item, is a real
  // attempt even when it is wrong. Everything else short is filler.
  const allowShort = item.answer_key.type === "choice" || parseNumber(answer) !== null;

  const reason = lowEffortReason(answer, previousAnswers, item.stem, { allowShort });
  if (reason) {
    return { outcome: "low_effort", matchedKey: false, partialCredit: graded.partialCredit };
  }
  return graded;
}
