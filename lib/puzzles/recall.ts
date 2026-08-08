// Recall generator. Pure and deterministic: the same (seed, difficulty)
// always produces the same puzzle, so grading regenerates server-side.
//
// Difficulty 1-4: a grid flashes a sequence of lit cells, the user
// reproduces the order. Difficulty 5-10: an n-back letter stream, the
// user flags every step that repeats the letter from n steps earlier.

import { createRng, type Rng } from "@/lib/rng";
import type { RecallAnswer, RecallData } from "@/lib/types";

const SYMBOLS = ["B", "K", "M", "R", "T", "Z"] as const;

function clampDifficulty(difficulty: number): number {
  return Math.min(10, Math.max(1, Math.round(difficulty)));
}

export function generate(
  seed: string,
  difficulty: number,
): { data: RecallData; solution: RecallAnswer } {
  const d = clampDifficulty(difficulty);
  const rng = createRng(seed);
  return d <= 4 ? generateSequence(rng, d) : generateNback(rng, d);
}

function generateSequence(
  rng: Rng,
  d: number,
): { data: RecallData; solution: RecallAnswer } {
  const gridSize = d <= 2 ? 3 : 4;
  const length = 3 + d; // 4..7 distinct cells
  const cells: [number, number][] = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) cells.push([r, c]);
  }
  const sequence = rng.shuffle(cells).slice(0, length);
  // 900ms per flash at difficulty 1 down to 500ms at difficulty 4.
  const flashMs = Math.round(900 - ((d - 1) / 3) * 400);
  return {
    data: { kind: "recall", mode: "sequence", gridSize, sequence, flashMs },
    solution: {
      mode: "sequence",
      cells: sequence.map(([r, c]) => [r, c] as [number, number]),
    },
  };
}

function generateNback(
  rng: Rng,
  d: number,
): { data: RecallData; solution: RecallAnswer } {
  const n = d <= 7 ? 2 : 3;
  const t = (d - 5) / 5;
  const length = Math.round(12 + t * 12); // 12 at d5 up to 24 at d10
  const stepMs = Math.round(2000 - t * 800); // 2000 down to 1200

  const stream: string[] = [];
  for (let i = 0; i < n; i++) stream.push(rng.pick(SYMBOLS));

  // Plant matches deliberately so 25-35% of flaggable positions repeat the
  // letter from n back, and every other position deliberately avoids it.
  const flaggable: number[] = [];
  for (let i = n; i < length; i++) flaggable.push(i);
  const share = 0.25 + rng.next() * 0.1;
  const matchCount = Math.max(2, Math.round(flaggable.length * share));
  const matchAt = new Set(rng.shuffle(flaggable).slice(0, matchCount));

  for (let i = n; i < length; i++) {
    if (matchAt.has(i)) {
      stream.push(stream[i - n]);
    } else {
      stream.push(rng.pick(SYMBOLS.filter((s) => s !== stream[i - n])));
    }
  }

  const flagged: number[] = [];
  for (let i = n; i < stream.length; i++) {
    if (stream[i] === stream[i - n]) flagged.push(i);
  }

  return {
    data: { kind: "recall", mode: "nback", n, stream, stepMs },
    solution: { mode: "nback", flagged },
  };
}

export function grade(seed: string, difficulty: number, answer: unknown): boolean {
  const { solution } = generate(seed, difficulty);
  if (typeof answer !== "object" || answer === null) return false;
  const a = answer as Record<string, unknown>;

  if (solution.mode === "sequence") {
    const cells = a.cells;
    if (!Array.isArray(cells) || cells.length !== solution.cells.length) {
      return false;
    }
    return solution.cells.every((want, i) => {
      const got: unknown = cells[i];
      return (
        Array.isArray(got) &&
        got.length === 2 &&
        got[0] === want[0] &&
        got[1] === want[1]
      );
    });
  }

  const raw = a.flagged;
  if (!Array.isArray(raw)) return false;
  if (!raw.every((v) => typeof v === "number" && Number.isInteger(v))) {
    return false;
  }
  const got = [...new Set(raw as number[])].sort((x, y) => x - y);
  const want = [...solution.flagged].sort((x, y) => x - y);
  return got.length === want.length && got.every((v, i) => v === want[i]);
}

export function explain(seed: string, difficulty: number): string {
  const { data, solution } = generate(seed, difficulty);

  if (data.mode === "sequence") {
    const order = data.sequence
      .map(([r, c]) => `row ${r + 1} col ${c + 1}`)
      .join(", then ");
    return `The lit order: ${order}. Rows and columns count from the top left, starting at 1.`;
  }

  const flagged =
    solution.mode === "nback" ? solution.flagged : ([] as number[]);
  if (flagged.length === 0) {
    return `No letter repeated from ${data.n} steps back in this stream.`;
  }
  const matches = flagged
    .map((i) => `step ${i + 1} (${data.stream[i]})`)
    .join(", ");
  return `Matches with n = ${data.n}: ${matches}. Each of those repeats the letter shown ${data.n} steps earlier. Steps count from 1.`;
}
