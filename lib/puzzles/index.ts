// Registry over the four generator modules. Server-side only — solutions
// never cross this boundary except through grade/explain.

import type { Category, PuzzleAnswer, PuzzleInstance, PuzzleType } from "@/lib/types";
import * as blockfit from "./blockfit";
import * as ruleshift from "./ruleshift";
import * as recall from "./recall";
import * as mentalmath from "./mentalmath";

interface GeneratorModule {
  generate(seed: string, difficulty: number): { data: unknown; solution: unknown };
  grade(seed: string, difficulty: number, answer: unknown): boolean;
  explain(seed: string, difficulty: number): string;
}

const modules: Record<PuzzleType, GeneratorModule> = {
  blockfit,
  ruleshift,
  recall,
  mentalmath,
};

export function generatePuzzle(
  type: PuzzleType,
  category: Category,
  seed: string,
  difficulty: number,
): PuzzleInstance {
  const { data } = modules[type].generate(seed, difficulty);
  return { type, category, seed, difficulty, data: data as PuzzleInstance["data"] };
}

export function gradeAnswer(
  type: PuzzleType,
  seed: string,
  difficulty: number,
  answer: unknown,
): boolean {
  return modules[type].grade(seed, difficulty, answer);
}

export function explainSolution(
  type: PuzzleType,
  seed: string,
  difficulty: number,
): string {
  return modules[type].explain(seed, difficulty);
}

export function solutionFor(
  type: PuzzleType,
  seed: string,
  difficulty: number,
): PuzzleAnswer {
  return modules[type].generate(seed, difficulty).solution as PuzzleAnswer;
}

// Full structure (public data + solution) for building hint prompts.
export function puzzleStructure(type: PuzzleType, seed: string, difficulty: number) {
  return modules[type].generate(seed, difficulty);
}
