// Shared contract for puzzles, sessions, and scoring.
// Every generator, UI component, and API route builds against this file.

export const CATEGORIES = [
  "spatial",
  "problem_solving",
  "pattern",
  "logic",
  "memory",
  "mental_math",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  spatial: "spatial",
  problem_solving: "problem solving",
  pattern: "patterns",
  logic: "logic",
  memory: "memory",
  mental_math: "mental maths",
};

export const PUZZLE_TYPES = [
  "blockfit",
  "ruleshift",
  "recall",
  "mentalmath",
] as const;
export type PuzzleType = (typeof PUZZLE_TYPES)[number];

// Which rating buckets a puzzle type can score against. When the engine
// serves a puzzle it picks one of the two as the instance's category.
export const PUZZLE_CATEGORIES: Record<PuzzleType, [Category, Category]> = {
  blockfit: ["spatial", "problem_solving"],
  ruleshift: ["pattern", "logic"],
  recall: ["memory", "memory"],
  mentalmath: ["mental_math", "logic"],
};

export const PUZZLE_LABELS: Record<PuzzleType, string> = {
  blockfit: "BlockFit",
  ruleshift: "RuleShift",
  recall: "Recall",
  mentalmath: "MentalMath",
};

// ---------------------------------------------------------------------------
// Puzzle payloads. `data` is safe to send to the client; solutions never
// leave the server until the user has submitted an answer.
// ---------------------------------------------------------------------------

export interface PuzzleInstance {
  type: PuzzleType;
  category: Category;
  seed: string;
  difficulty: number; // 1-10
  data: BlockFitData | RuleShiftData | RecallData | MentalMathData;
}

// Grid cell colours are 0 (empty) or 1..6 (block palette index).
export type ColorGrid = number[][];

export interface BlockFitPiece {
  id: number;
  cells: [number, number][]; // [row, col] offsets from the piece origin
  color: number; // 1..6
}

export interface BlockFitData {
  kind: "blockfit";
  gridSize: number; // 6..10
  filled: [number, number][]; // pre-filled cells
  pieces: BlockFitPiece[]; // exactly 3
  targetLines: number;
  rotatable: boolean; // difficulty >= 4
}

export interface BlockFitPlacement {
  pieceId: number;
  rotation: 0 | 1 | 2 | 3; // quarter turns clockwise
  row: number;
  col: number;
}

export type BlockFitAnswer = { placements: BlockFitPlacement[] };

export interface RuleShiftData {
  kind: "ruleshift";
  examples: { input: ColorGrid; output: ColorGrid }[]; // 2-3
  test: ColorGrid;
  candidates: ColorGrid[]; // exactly 4
}

export type RuleShiftAnswer = { choice: number }; // 0..3

export type RecallData =
  | {
      kind: "recall";
      mode: "sequence";
      gridSize: number;
      sequence: [number, number][];
      flashMs: number; // per-cell flash duration
    }
  | {
      kind: "recall";
      mode: "nback";
      n: number;
      stream: string[]; // symbols shown one at a time
      stepMs: number;
    };

export type RecallAnswer =
  | { mode: "sequence"; cells: [number, number][] }
  | { mode: "nback"; flagged: number[] }; // indices the user flagged

export type MentalMathData =
  | {
      kind: "mentalmath";
      format: "target";
      numbers: number[]; // four numbers, each usable once
      target: number;
      timeLimitMs: number;
    }
  | {
      kind: "mentalmath";
      format: "missing_op";
      a: number;
      b: number;
      result: number;
      timeLimitMs: number;
    }
  | {
      kind: "mentalmath";
      format: "larger";
      left: string; // expression, e.g. "17 × 4"
      right: string;
      timeLimitMs: number;
    }
  | {
      kind: "mentalmath";
      format: "backwards";
      steps: string[]; // e.g. ["double it", "add 6"]
      result: number;
      timeLimitMs: number;
    };

export type MentalMathAnswer =
  | { format: "target"; expression: string } // e.g. "(7 + 3) * 5 - 2"
  | { format: "missing_op"; op: "+" | "-" | "×" | "÷" }
  | { format: "larger"; choice: 0 | 1 }
  | { format: "backwards"; value: number };

export type PuzzleAnswer =
  | BlockFitAnswer
  | RuleShiftAnswer
  | RecallAnswer
  | MentalMathAnswer;

// ---------------------------------------------------------------------------
// The component contract (§4 of the spec).
// ---------------------------------------------------------------------------

export interface SolveResult {
  correct: boolean;
  timeMs: number;
  hintsUsed: number;
  attempts: number;
  answer: unknown;
}

export interface GradeResult {
  correct: boolean;
  // Written explanation of the solution; only returned after an answer.
  explanation: string;
  solution: unknown;
}

export interface PuzzleProps {
  puzzle: PuzzleInstance;
  onSolve: (result: SolveResult) => void;
  onHintRequest: (tier: 1 | 2 | 3) => Promise<string>;
  // Server round-trip: grades the answer and releases the solution.
  // Components call this on submit, show feedback, then call onSolve.
  onGrade: (answer: unknown) => Promise<GradeResult>;
}

// ---------------------------------------------------------------------------
// Scoring constants (§5, §6).
// ---------------------------------------------------------------------------

export const ELO_K = 32;
export const RATING_START = 1000;
export const HINT_LOCK_MS = 45_000;
export const HINT_SCORE_COST: Record<1 | 2 | 3, number> = {
  1: 0.15,
  2: 0.3,
  3: 0.5,
};
export const HINT_XP_COST: Record<1 | 2 | 3, number> = { 1: 5, 2: 10, 3: 20 };
export const SPEED_BONUS = 0.1;

export const puzzleRating = (difficulty: number) => 800 + difficulty * 60;

export const xpForPuzzle = (difficulty: number, correct: boolean) =>
  correct ? 20 + difficulty * 4 : 5;

export const levelForXp = (xp: number) => Math.floor(Math.sqrt(xp / 100));

export type SessionType = "daily" | "practice" | "challenge";
export type SessionStatus = "not_started" | "in_progress" | "complete";

// One entry per puzzle slot, stored on sessions.puzzle_seeds so a refresh
// never rerolls the session.
export interface SessionSlot {
  type: PuzzleType;
  category: Category;
  seed: string;
  difficulty: number;
}
