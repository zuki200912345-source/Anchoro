import { NextResponse } from "next/server";
import { z } from "zod";
import { generatePuzzle, gradeAnswer, explainSolution, solutionFor } from "@/lib/puzzles";
import { PUZZLE_TYPES, PUZZLE_CATEGORIES } from "@/lib/types";

// Development-only harness endpoint: serve and grade a single puzzle without
// auth or a database. Returns 404 in production builds.

const paramsSchema = z.object({
  type: z.enum(PUZZLE_TYPES),
  seed: z.string().min(1).max(64),
  difficulty: z.coerce.number().int().min(1).max(10),
});

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not here." }, { status: 404 });
  }
  const url = new URL(request.url);
  const parsed = paramsSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad puzzle request." }, { status: 400 });
  }
  const { type, seed, difficulty } = parsed.data;
  const puzzle = generatePuzzle(type, PUZZLE_CATEGORIES[type][0], seed, difficulty);
  return NextResponse.json({ puzzle });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not here." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = paramsSchema
    .extend({ answer: z.unknown() })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad grade request." }, { status: 400 });
  }
  const { type, seed, difficulty, answer } = parsed.data;
  return NextResponse.json({
    correct: gradeAnswer(type, seed, difficulty, answer),
    explanation: explainSolution(type, seed, difficulty),
    solution: solutionFor(type, seed, difficulty),
  });
}
