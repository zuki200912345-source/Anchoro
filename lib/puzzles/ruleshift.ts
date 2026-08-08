// RuleShift generator. Server-side, pure, deterministic.
//
// Picks a transformation (or a composition of two at difficulty 5+), shows it
// applied to worked example grids, then asks which of four candidate outputs
// follows the same rule for a fresh test input. Distractors are near-misses:
// the wrong rotation direction, a reflection instead of a rotation, the rule
// applied to the wrong colour, or the correct output with one cell changed.
// Never random grids.

import { createRng, type Rng } from "@/lib/rng";
import type { ColorGrid, RuleShiftAnswer, RuleShiftData } from "@/lib/types";

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

type GeoKind = "rotate_cw" | "rotate_ccw" | "rotate_180" | "reflect_h" | "reflect_v";
type ShiftDir = "up" | "down" | "left" | "right";

type Op =
  | { kind: GeoKind }
  | { kind: "shift"; dir: ShiftDir }
  | { kind: "recolor"; from: number; to: number }
  | { kind: "count_replace" };

const clone = (g: ColorGrid): ColorGrid => g.map((row) => [...row]);

function applyOp(g: ColorGrid, op: Op): ColorGrid {
  const n = g.length;
  const out: ColorGrid = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  switch (op.kind) {
    case "rotate_cw":
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) out[r][c] = g[n - 1 - c][r];
      return out;
    case "rotate_ccw":
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) out[r][c] = g[c][n - 1 - r];
      return out;
    case "rotate_180":
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) out[r][c] = g[n - 1 - r][n - 1 - c];
      return out;
    case "reflect_h": // mirror left to right
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) out[r][c] = g[r][n - 1 - c];
      return out;
    case "reflect_v": // flip top to bottom
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) out[r][c] = g[n - 1 - r][c];
      return out;
    case "shift": {
      const [dr, dc] =
        op.dir === "up" ? [-1, 0] : op.dir === "down" ? [1, 0] : op.dir === "left" ? [0, -1] : [0, 1];
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
          out[(r + dr + n) % n][(c + dc + n) % n] = g[r][c];
      return out;
    }
    case "recolor":
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
          out[r][c] = g[r][c] === op.from ? op.to : g[r][c];
      return out;
    case "count_replace": {
      // The colour that appears most often is removed.
      const top = mostFrequentColor(g);
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) out[r][c] = g[r][c] === top ? 0 : g[r][c];
      return out;
    }
  }
}

const applyRule = (g: ColorGrid, rule: Op[]): ColorGrid =>
  rule.reduce((acc, op) => applyOp(acc, op), clone(g));

function colorCounts(g: ColorGrid): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of g)
    for (const v of row)
      if (v !== 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

function mostFrequentColor(g: ColorGrid): number {
  let best = 0;
  let bestCount = -1;
  for (const [color, count] of [...colorCounts(g).entries()].sort((a, b) => a[0] - b[0]))
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  return best;
}

const gridsEqual = (a: ColorGrid, b: ColorGrid): boolean =>
  a.length === b.length &&
  a.every((row, r) => row.length === b[r].length && row.every((v, c) => v === b[r][c]));

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

function randomGrid(rng: Rng, n: number, colorSet: number[]): ColorGrid {
  const g: ColorGrid = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => (rng.chance(0.55) ? rng.pick(colorSet) : 0)),
  );
  // Keep at least n coloured cells so there is something to transform.
  let nonzero = g.flat().filter((v) => v !== 0).length;
  let guard = 0;
  while (nonzero < n && guard++ < 50) {
    const r = rng.int(0, n - 1);
    const c = rng.int(0, n - 1);
    if (g[r][c] === 0) {
      g[r][c] = rng.pick(colorSet);
      nonzero++;
    }
  }
  return g;
}

// A grid the rule visibly changes, with rule-specific requirements met.
function inputGrid(rng: Rng, n: number, colorSet: number[], rule: Op[]): ColorGrid {
  for (let attempt = 0; attempt < 60; attempt++) {
    const g = randomGrid(rng, n, colorSet);

    for (const op of rule) {
      if (op.kind === "recolor") {
        // The source colour has to show up for the rule to be readable.
        let present = g.flat().filter((v) => v === op.from).length;
        let guard = 0;
        while (present < 2 && guard++ < 50) {
          const r = rng.int(0, n - 1);
          const c = rng.int(0, n - 1);
          if (g[r][c] !== op.from) {
            g[r][c] = op.from;
            present++;
          }
        }
      }
      if (op.kind === "count_replace") {
        // Needs a single clear winner for "appears most often".
        let guard = 0;
        while (guard++ < 60) {
          const counts = [...colorCounts(g).entries()].sort((a, b) => b[1] - a[1]);
          if (counts.length >= 2 && counts[0][1] > counts[1][1]) break;
          const target = counts.length > 0 ? counts[0][0] : colorSet[0];
          const r = rng.int(0, n - 1);
          const c = rng.int(0, n - 1);
          if (g[r][c] !== target) g[r][c] = target;
        }
      }
    }

    if (!gridsEqual(applyRule(g, rule), g)) return g;
  }
  // Symmetric grids at this density are vanishingly rare; if the retries
  // somehow run out, the last grid still grades correctly because duplicate
  // candidates get replaced below.
  return randomGrid(rng, n, colorSet);
}

// ---------------------------------------------------------------------------
// Near-miss distractors
// ---------------------------------------------------------------------------

const GEO_VARIANTS: Record<GeoKind, GeoKind[]> = {
  rotate_cw: ["rotate_ccw", "rotate_180", "reflect_h"],
  rotate_ccw: ["rotate_cw", "rotate_180", "reflect_v"],
  rotate_180: ["rotate_cw", "rotate_ccw", "reflect_h"],
  reflect_h: ["reflect_v", "rotate_180", "rotate_cw"],
  reflect_v: ["reflect_h", "rotate_180", "rotate_ccw"],
};

const OTHER_DIRS: Record<ShiftDir, ShiftDir[]> = {
  up: ["down", "left", "right"],
  down: ["up", "left", "right"],
  left: ["right", "up", "down"],
  right: ["left", "up", "down"],
};

// The correct output with a single cell changed. Sweeps deterministically if
// random tries collide, so it always lands on a fresh grid.
function oneCellOff(rng: Rng, correct: ColorGrid, taken: ColorGrid[]): ColorGrid {
  const n = correct.length;
  for (let t = 0; t < 40; t++) {
    const g = clone(correct);
    const r = rng.int(0, n - 1);
    const c = rng.int(0, n - 1);
    const v = rng.int(0, 6);
    if (v === g[r][c]) continue;
    g[r][c] = v;
    if (!taken.some((x) => gridsEqual(x, g))) return g;
  }
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      for (let v = 0; v <= 6; v++) {
        if (v === correct[r][c]) continue;
        const g = clone(correct);
        g[r][c] = v;
        if (!taken.some((x) => gridsEqual(x, g))) return g;
      }
  return clone(correct); // unreachable: the sweep space dwarfs 4 candidates
}

function nearMisses(rng: Rng, test: ColorGrid, rule: Op[]): ColorGrid[] {
  const out: ColorGrid[] = [];
  const main = rule.length === 2 ? rule[1] : rule[0];

  if (rule.length === 2) {
    const [geo, recolor] = rule;
    out.push(applyRule(test, [recolor])); // forgot the movement
    out.push(applyRule(test, [geo])); // forgot the recolour
    if (geo.kind === "shift")
      out.push(applyRule(test, [{ kind: "shift", dir: OTHER_DIRS[geo.dir][0] }, recolor]));
    else
      out.push(applyRule(test, [{ kind: GEO_VARIANTS[geo.kind as GeoKind][0] }, recolor]));
    return out;
  }

  switch (main.kind) {
    case "rotate_cw":
    case "rotate_ccw":
    case "rotate_180":
    case "reflect_h":
    case "reflect_v":
      for (const variant of GEO_VARIANTS[main.kind])
        out.push(applyOp(test, { kind: variant }));
      return out;
    case "shift":
      for (const dir of OTHER_DIRS[main.dir])
        out.push(applyOp(test, { kind: "shift", dir }));
      return out;
    case "recolor": {
      const others = [1, 2, 3, 4, 5, 6].filter((v) => v !== main.from && v !== main.to);
      out.push(applyOp(test, { kind: "recolor", from: main.from, to: rng.pick(others) }));
      const wrongSource = [...colorCounts(test).keys()]
        .filter((v) => v !== main.from)
        .sort((a, b) => a - b);
      if (wrongSource.length > 0)
        out.push(applyOp(test, { kind: "recolor", from: rng.pick(wrongSource), to: main.to }));
      return out;
    }
    case "count_replace": {
      const ranked = [...colorCounts(test).entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([color]) => color);
      if (ranked.length >= 2) {
        const least = ranked[ranked.length - 1];
        out.push(applyOp(test, { kind: "recolor", from: least, to: 0 }));
      }
      if (ranked.length >= 3)
        out.push(applyOp(test, { kind: "recolor", from: ranked[1], to: 0 }));
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Rule selection by difficulty
// ---------------------------------------------------------------------------

function pickRule(rng: Rng, d: number, colorSet: number[]): Op[] {
  const geoPool: Op[] = [
    { kind: "rotate_cw" },
    { kind: "rotate_180" },
    { kind: "reflect_h" },
    { kind: "reflect_v" },
  ];
  if (d >= 3) {
    geoPool.push({ kind: "rotate_ccw" });
    geoPool.push({ kind: "shift", dir: rng.pick(["up", "down", "left", "right"] as const) });
  }

  const makeRecolor = (): Op => {
    const from = rng.pick(colorSet);
    const to = rng.pick([1, 2, 3, 4, 5, 6].filter((v) => !colorSet.includes(v)));
    return { kind: "recolor", from, to };
  };

  const composed = d >= 5 && rng.chance(Math.min(1, 0.5 + (d - 5) * 0.1));
  if (composed) return [rng.pick(geoPool), makeRecolor()];

  const singlePool: Op[] = [...geoPool];
  if (d >= 3) singlePool.push(makeRecolor());
  if (d >= 5) singlePool.push({ kind: "count_replace" });
  return [rng.pick(singlePool)];
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

function buildAll(seed: string, difficulty: number) {
  const rng = createRng(`ruleshift:${seed}:${difficulty}`);
  const d = Math.max(1, Math.min(10, Math.floor(difficulty)));
  const n = d <= 3 ? 3 : d <= 6 ? 4 : 5;
  const numColors = d <= 3 ? 2 : d <= 6 ? 3 : 4;
  const exampleCount = d <= 6 ? 3 : 2;

  const colorSet = rng.shuffle([1, 2, 3, 4, 5, 6]).slice(0, numColors);
  const rule = pickRule(rng, d, colorSet);

  const examples = Array.from({ length: exampleCount }, () => {
    const input = inputGrid(rng, n, colorSet, rule);
    return { input, output: applyRule(input, rule) };
  });

  const test = inputGrid(rng, n, colorSet, rule);
  const correct = applyRule(test, rule);

  const pool: ColorGrid[] = [correct];
  for (const miss of nearMisses(rng, test, rule)) {
    if (pool.length >= 4) break;
    if (!pool.some((g) => gridsEqual(g, miss))) pool.push(miss);
  }
  while (pool.length < 4) pool.push(oneCellOff(rng, correct, pool));

  const order = rng.shuffle([0, 1, 2, 3]);
  const candidates = order.map((i) => pool[i]);
  const choice = order.indexOf(0);

  const data: RuleShiftData = { kind: "ruleshift", examples, test, candidates };
  return { data, solution: { choice } as RuleShiftAnswer, rule };
}

export function generate(
  seed: string,
  difficulty: number,
): { data: RuleShiftData; solution: RuleShiftAnswer } {
  const { data, solution } = buildAll(seed, difficulty);
  return { data, solution };
}

export function grade(seed: string, difficulty: number, answer: unknown): boolean {
  const { solution } = generate(seed, difficulty);
  if (typeof answer !== "object" || answer === null) return false;
  const choice = (answer as Record<string, unknown>).choice;
  if (typeof choice !== "number" || !Number.isInteger(choice)) return false;
  if (choice < 0 || choice > 3) return false;
  return choice === solution.choice;
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

function describeOp(op: Op): string {
  switch (op.kind) {
    case "rotate_cw":
      return "the grid turns a quarter turn clockwise";
    case "rotate_ccw":
      return "the grid turns a quarter turn anticlockwise";
    case "rotate_180":
      return "the grid makes a half turn, so it ends up upside down";
    case "reflect_h":
      return "the grid is mirrored left to right";
    case "reflect_v":
      return "the grid is flipped top to bottom";
    case "shift":
      return `every cell moves one step ${op.dir}, wrapping round to the far side`;
    case "recolor":
      return `every cell of colour ${op.from} becomes colour ${op.to}`;
    case "count_replace":
      return "the colour that appears most often is wiped from the grid";
  }
}

function checkHint(op: Op): string {
  switch (op.kind) {
    case "rotate_cw":
    case "rotate_ccw":
    case "rotate_180":
    case "reflect_h":
    case "reflect_v":
      return "Track one corner cell between input and output and the movement gives itself away.";
    case "shift":
      return "Watch the edge: whatever falls off one side reappears on the other.";
    case "recolor":
      return "The cell positions never move; only one colour changes.";
    case "count_replace":
      return "Count each colour in the input before deciding what disappeared.";
  }
}

export function explain(seed: string, difficulty: number): string {
  const { solution, rule } = buildAll(seed, difficulty);
  const ruleText =
    rule.length === 2
      ? `two things happen in order: first ${describeOp(rule[0])}, then ${describeOp(rule[1])}`
      : describeOp(rule[0]);
  return (
    `In every example the same rule applies: ${ruleText}. ` +
    `${checkHint(rule[0])} ` +
    `Apply the rule to the test grid and it matches option ${solution.choice + 1}, counting options from 1. ` +
    `The wrong options are close on purpose: same idea, wrong direction, wrong colour, or one cell out.`
  );
}
