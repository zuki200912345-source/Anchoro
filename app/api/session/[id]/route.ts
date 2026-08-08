import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generatePuzzle } from "@/lib/puzzles";
import type { SessionSlot } from "@/lib/types";

const idSchema = z.string().uuid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Bad session id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // RLS scopes this select to the owner already; the eq is belt and braces.
  const { data: session } = await supabase
    .from("sessions")
    .select("id, type, status, date, started_at, puzzle_seeds, xp_earned")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "No such session." }, { status: 404 });
  }

  const slots = session.puzzle_seeds as SessionSlot[];
  const puzzles = slots.map((s) =>
    generatePuzzle(s.type, s.category, s.seed, s.difficulty),
  );

  const { data: attempts } = await supabase
    .from("attempts")
    .select("seed, correct, time_ms, hints_used")
    .eq("session_id", session.id);

  const seedToIndex = new Map(slots.map((s, i) => [s.seed, i]));
  const attemptRows = (attempts ?? [])
    .map((a) => ({
      slotIndex: seedToIndex.get(a.seed) ?? -1,
      correct: a.correct,
      timeMs: a.time_ms,
      hintsUsed: a.hints_used,
    }))
    .filter((a) => a.slotIndex >= 0)
    .sort((a, b) => a.slotIndex - b.slotIndex);

  return NextResponse.json({
    session: {
      id: session.id,
      type: session.type,
      status: session.status,
      date: session.date,
      startedAt: session.started_at,
    },
    slots,
    puzzles,
    attempts: attemptRows,
  });
}
