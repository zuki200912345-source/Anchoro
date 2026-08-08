// MentalMath generator. Pure and deterministic: the same (seed, difficulty)
// always produces the same puzzle, so grading regenerates server-side.
//
// Four formats, picked per seed with difficulty-weighted odds:
//   target     — reach a target from four numbers, each usable at most once
//   missing_op — a ? b = result, exactly one operator fits
//   larger     — two expressions within 15% of each other, pick the bigger
//   backwards  — undo a chain of steps to find the hidden start value
//
// The target grader parses submitted expressions with a small recursive
// descent parser (digits, whitespace, + - * / × ÷ and parentheses only).
// Nothing is ever passed to eval or Function.

import { createRng, type Rng } from "@/lib/rng";
import type { MentalMathAnswer, MentalMathData } from "@/lib/types";

type Op = "+" | "-" | "×" | "÷";
type Format = MentalMathData["format"];

const OPS: readonly Op[] = ["+", "-", "×", "÷"];

interface Built {
  data: MentalMathData;
  solution: MentalMathAnswer;
  working: string;
}

function clampDifficulty(difficulty: number): number {
  return Math.min(10, Math.max(1, Math.round(difficulty)));
}

// 45s at difficulty 1 down to 20s at difficulty 10.
function timeLimitFor(d: number): number {
  return Math.round(45000 - ((d - 1) / 9) * 25000);
}

function pickFormat(rng: Rng, d: number): Format {
  const weights: [Format, number][] = [
    ["missing_op", d <= 3 ? 3 : d <= 6 ? 2 : 1],
    ["larger", 2],
    ["backwards", d <= 3 ? 1 : 2],
    ["target", d <= 3 ? 1 : d <= 6 ? 2 : 3],
  ];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [format, w] of weights) {
    roll -= w;
    if (roll < 0) return format;
  }
  return "target";
}

function build(seed: string, difficulty: number): Built {
  const d = clampDifficulty(difficulty);
  const rng = createRng(seed);
  const format = pickFormat(rng, d);
  const timeLimitMs = timeLimitFor(d);
  switch (format) {
    case "target":
      return buildTarget(rng, d, timeLimitMs);
    case "missing_op":
      return buildMissingOp(rng, d, timeLimitMs);
    case "larger":
      return buildLarger(rng, d, timeLimitMs);
    case "backwards":
      return buildBackwards(rng, d, timeLimitMs);
  }
}

// ---------------------------------------------------------------------------
// target
// ---------------------------------------------------------------------------

function targetOpPool(d: number): Op[] {
  if (d <= 2) return ["+", "+", "-"];
  if (d <= 5) return ["+", "-", "×"];
  return ["×", "+", "-", "÷", "×"];
}

// Apply an op while keeping every intermediate a positive integer <= 999.
function applyTargetOp(acc: number, op: Op, n: number): number | null {
  switch (op) {
    case "+":
      return acc + n <= 999 ? acc + n : null;
    case "-":
      return acc - n >= 1 ? acc - n : null;
    case "×":
      return acc * n <= 999 ? acc * n : null;
    case "÷":
      return n >= 2 && acc % n === 0 ? acc / n : null;
  }
}

function buildTarget(rng: Rng, d: number, timeLimitMs: number): Built {
  const hi = d <= 3 ? 9 : 13;
  let fallback: Built | null = null;

  for (let attempt = 0; attempt < 40; attempt++) {
    const numbers = [
      rng.int(1, hi),
      rng.int(1, hi),
      rng.int(1, hi),
      rng.int(1, hi),
    ];
    // Build a random expression from the numbers first, so a solution is
    // guaranteed to exist. Left fold with explicit parentheses.
    const order = rng.shuffle(numbers);
    let acc = order[0];
    let expression = String(order[0]);
    const steps: string[] = [];
    let dead = false;

    for (let i = 1; i < order.length; i++) {
      const n = order[i];
      let stepDone = false;
      for (const op of rng.shuffle(targetOpPool(d))) {
        const v = applyTargetOp(acc, op, n);
        if (v !== null) {
          steps.push(`${acc} ${op} ${n} = ${v}`);
          expression =
            i === 1 ? `${expression} ${op} ${n}` : `(${expression}) ${op} ${n}`;
          acc = v;
          stepDone = true;
          break;
        }
      }
      if (!stepDone) {
        dead = true;
        break;
      }
    }
    if (dead || acc < 1) continue;

    const built: Built = {
      data: {
        kind: "mentalmath",
        format: "target",
        numbers,
        target: acc,
        timeLimitMs,
      },
      solution: { format: "target", expression },
      working: `One way: ${steps.join(", then ")}.`,
    };
    // Prefer a target that is not one of the given numbers.
    if (numbers.includes(acc)) {
      fallback = fallback ?? built;
      continue;
    }
    return built;
  }

  return (
    fallback ?? {
      data: {
        kind: "mentalmath",
        format: "target",
        numbers: [3, 5, 7, 2],
        target: 54,
        timeLimitMs,
      },
      solution: { format: "target", expression: "((3 + 5) × 7) - 2" },
      working: "One way: 3 + 5 = 8, then 8 × 7 = 56, then 56 - 2 = 54.",
    }
  );
}

// ---------------------------------------------------------------------------
// missing_op
// ---------------------------------------------------------------------------

function opValue(a: number, op: Op, b: number): number | null {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b !== 0 && a % b === 0 ? a / b : null;
  }
}

function missingOpWorking(a: number, b: number, op: Op, result: number): string {
  const others = OPS.filter((o) => o !== op)
    .map((o) => {
      const v = opValue(a, o, b);
      return v === null
        ? `${a} ${o} ${b} is not a whole number`
        : `${a} ${o} ${b} = ${v}`;
    })
    .join("; ");
  return `${a} ${op} ${b} = ${result}. The rest miss: ${others}.`;
}

function buildMissingOp(rng: Rng, d: number, timeLimitMs: number): Built {
  for (let attempt = 0; attempt < 120; attempt++) {
    const op = rng.pick(OPS);
    let a: number;
    let b: number;
    if (op === "÷") {
      b = rng.int(2, 3 + Math.ceil(d / 2));
      a = b * rng.int(2, 3 + d);
    } else if (op === "×") {
      a = rng.int(2, 3 + d);
      b = rng.int(2, 3 + Math.ceil(d / 2));
    } else {
      a = rng.int(4, 10 + d * 6);
      b = rng.int(2, Math.min(a - 1, 6 + d * 3));
    }
    const result = opValue(a, op, b);
    if (result === null || result < 1) continue;
    // Exactly one operator may land on the result, or the puzzle is ambiguous.
    const fits = OPS.filter((o) => opValue(a, o, b) === result);
    if (fits.length !== 1) continue;
    return {
      data: { kind: "mentalmath", format: "missing_op", a, b, result, timeLimitMs },
      solution: { format: "missing_op", op },
      working: missingOpWorking(a, b, op, result),
    };
  }
  return {
    data: { kind: "mentalmath", format: "missing_op", a: 7, b: 3, result: 10, timeLimitMs },
    solution: { format: "missing_op", op: "+" },
    working: missingOpWorking(7, 3, "+", 10),
  };
}

// ---------------------------------------------------------------------------
// larger
// ---------------------------------------------------------------------------

function buildLarger(rng: Rng, d: number, timeLimitMs: number): Built {
  for (let attempt = 0; attempt < 200; attempt++) {
    const b1 = rng.int(3, 4 + d);
    const a1 = rng.int(6, 9 + d * 4);
    const v1 = a1 * b1;
    // Aim the second product close to the first so estimation is required.
    const b2 = rng.int(3, 4 + d);
    const factor = 0.87 + rng.next() * 0.26;
    const a2 = Math.round((v1 * factor) / b2);
    if (a2 < 3 || a2 > 15 + d * 5) continue;
    if (a2 === a1 && b2 === b1) continue;
    const v2 = a2 * b2;
    if (v2 === v1) continue;
    const gap = Math.abs(v1 - v2) / Math.max(v1, v2);
    if (gap > 0.15) continue;

    const left = `${a1} × ${b1}`;
    const right = `${a2} × ${b2}`;
    const choice: 0 | 1 = v1 > v2 ? 0 : 1;
    const winner = choice === 0 ? left : right;
    return {
      data: { kind: "mentalmath", format: "larger", left, right, timeLimitMs },
      solution: { format: "larger", choice },
      working: `${left} = ${v1} and ${right} = ${v2}. ${winner} wins by ${Math.abs(v1 - v2)}.`,
    };
  }
  return {
    data: { kind: "mentalmath", format: "larger", left: "17 × 4", right: "9 × 8", timeLimitMs },
    solution: { format: "larger", choice: 1 },
    working: "17 × 4 = 68 and 9 × 8 = 72. 9 × 8 wins by 4.",
  };
}

// ---------------------------------------------------------------------------
// backwards
// ---------------------------------------------------------------------------

type StepKind = "add" | "subtract" | "double" | "triple" | "halve";

function buildBackwards(rng: Rng, d: number, timeLimitMs: number): Built {
  const stepCount = d <= 3 ? 2 : d <= 7 ? 3 : 4;
  const start = rng.int(3, 6 + d * 3);
  let value = start;
  const steps: string[] = [];
  const trace: string[] = [];
  let prev: { kind: StepKind; k: number } | null = null;

  for (let i = 0; i < stepCount; i++) {
    const kinds = rng.shuffle([
      "add",
      "subtract",
      "double",
      "triple",
      "halve",
    ] as const);
    for (const kind of kinds) {
      // Keep every intermediate a positive integer, and never follow a step
      // with its exact inverse.
      if (kind === "double" && (value * 2 > 400 || prev?.kind === "halve")) continue;
      if (kind === "halve" && (value % 2 !== 0 || value < 6 || prev?.kind === "double")) continue;
      if (kind === "triple" && (d < 5 || value * 3 > 400)) continue;
      if (kind === "subtract" && value < 5) continue;

      if (kind === "add") {
        let k = rng.int(2, 4 + d * 2);
        if (prev?.kind === "subtract" && prev.k === k) k = k > 2 ? k - 1 : k + 1;
        value += k;
        steps.push(`add ${k}`);
        prev = { kind, k };
      } else if (kind === "subtract") {
        let k = rng.int(2, Math.min(value - 2, 4 + d * 2));
        if (prev?.kind === "add" && prev.k === k) k = k > 2 ? k - 1 : k + 1;
        value -= k;
        steps.push(`subtract ${k}`);
        prev = { kind, k };
      } else if (kind === "double") {
        value *= 2;
        steps.push("double it");
        prev = { kind, k: 0 };
      } else if (kind === "triple") {
        value *= 3;
        steps.push("triple it");
        prev = { kind, k: 0 };
      } else {
        value /= 2;
        steps.push("halve it");
        prev = { kind, k: 0 };
      }
      trace.push(`${steps[steps.length - 1]} makes ${value}`);
      break;
    }
  }

  return {
    data: { kind: "mentalmath", format: "backwards", steps, result: value, timeLimitMs },
    solution: { format: "backwards", value: start },
    working: `Start at ${start}: ${trace.join(", ")}. Undo each step in reverse order from ${value} and you land back on ${start}.`,
  };
}

// ---------------------------------------------------------------------------
// Expression parser for the target grader. Recursive descent over a strict
// token set; never eval, never Function.
// ---------------------------------------------------------------------------

const MAX_EXPRESSION_LENGTH = 120;
const MAX_MAGNITUDE = 1e12;

interface Fraction {
  num: number;
  den: number; // always > 0
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function makeFraction(num: number, den: number): Fraction | null {
  if (den === 0 || !Number.isFinite(num) || !Number.isFinite(den)) return null;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  if (Math.abs(num) > MAX_MAGNITUDE || den > MAX_MAGNITUDE) return null;
  const g = gcd(Math.abs(num), den) || 1;
  return { num: num / g, den: den / g };
}

type Token = { t: "num"; value: number } | { t: "+" | "-" | "*" | "/" | "(" | ")" };

function tokenize(raw: string): Token[] | null {
  if (raw.length === 0 || raw.length > MAX_EXPRESSION_LENGTH) return null;
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < raw.length && raw[j] >= "0" && raw[j] <= "9") j++;
      if (j - i > 4) return null;
      tokens.push({ t: "num", value: parseInt(raw.slice(i, j), 10) });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-") {
      tokens.push({ t: ch });
      i++;
      continue;
    }
    if (ch === "*" || ch === "×") {
      tokens.push({ t: "*" });
      i++;
      continue;
    }
    if (ch === "/" || ch === "÷") {
      tokens.push({ t: "/" });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ t: ch });
      i++;
      continue;
    }
    return null; // any other character invalidates the whole expression
  }
  return tokens.length > 0 ? tokens : null;
}

function evaluateExpression(
  raw: string,
): { value: Fraction; literals: number[] } | null {
  const parsed = tokenize(raw);
  if (!parsed) return null;
  const tokens: Token[] = parsed;
  const literals: number[] = [];
  let pos = 0;

  function parseFactor(depth: number): Fraction | null {
    if (depth > 64 || pos >= tokens.length) return null;
    const tok = tokens[pos];
    if (tok.t === "num") {
      pos++;
      literals.push(tok.value);
      return { num: tok.value, den: 1 };
    }
    if (tok.t === "(") {
      pos++;
      const inner = parseExpr(depth + 1);
      if (!inner) return null;
      if (pos >= tokens.length || tokens[pos].t !== ")") return null;
      pos++;
      return inner;
    }
    return null;
  }

  function parseTerm(depth: number): Fraction | null {
    let left = parseFactor(depth);
    if (!left) return null;
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.t !== "*" && tok.t !== "/") break;
      pos++;
      const right = parseFactor(depth);
      if (!right) return null;
      if (tok.t === "*") {
        left = makeFraction(left.num * right.num, left.den * right.den);
      } else {
        if (right.num === 0) return null; // division by zero
        left = makeFraction(left.num * right.den, left.den * right.num);
      }
      if (!left) return null;
    }
    return left;
  }

  function parseExpr(depth: number): Fraction | null {
    if (depth > 64) return null;
    let left = parseTerm(depth);
    if (!left) return null;
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.t !== "+" && tok.t !== "-") break;
      pos++;
      const right = parseTerm(depth);
      if (!right) return null;
      left =
        tok.t === "+"
          ? makeFraction(left.num * right.den + right.num * left.den, left.den * right.den)
          : makeFraction(left.num * right.den - right.num * left.den, left.den * right.den);
      if (!left) return null;
    }
    return left;
  }

  const value = parseExpr(0);
  if (!value || pos !== tokens.length) return null;
  return { value, literals };
}

function sameMultiset(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort((x, y) => x - y);
  const bs = [...b].sort((x, y) => x - y);
  return as.every((v, i) => v === bs[i]);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export function generate(
  seed: string,
  difficulty: number,
): { data: MentalMathData; solution: MentalMathAnswer } {
  const { data, solution } = build(seed, difficulty);
  return { data, solution };
}

export function grade(seed: string, difficulty: number, answer: unknown): boolean {
  const { data, solution } = build(seed, difficulty);
  if (typeof answer !== "object" || answer === null) return false;
  const a = answer as Record<string, unknown>;

  switch (data.format) {
    case "target": {
      if (typeof a.expression !== "string") return false;
      const parsed = evaluateExpression(a.expression);
      if (!parsed) return false;
      if (parsed.value.den !== 1 || parsed.value.num !== data.target) return false;
      // Must use exactly the given numbers, each exactly once.
      return sameMultiset(parsed.literals, data.numbers);
    }
    case "missing_op": {
      const sol = solution as Extract<MentalMathAnswer, { format: "missing_op" }>;
      if (typeof a.op !== "string") return false;
      const op = a.op === "*" ? "×" : a.op === "/" ? "÷" : a.op;
      return op === sol.op;
    }
    case "larger": {
      const sol = solution as Extract<MentalMathAnswer, { format: "larger" }>;
      return a.choice === sol.choice;
    }
    case "backwards": {
      const sol = solution as Extract<MentalMathAnswer, { format: "backwards" }>;
      return (
        typeof a.value === "number" &&
        Number.isFinite(a.value) &&
        a.value === sol.value
      );
    }
  }
}

export function explain(seed: string, difficulty: number): string {
  return build(seed, difficulty).working;
}
