import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Category, SessionSlot } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Bad session id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "No such session." }, { status: 404 });
  }
  if (session.status !== "complete") {
    return NextResponse.json(
      { error: "Finish the session first." },
      { status: 409 },
    );
  }

  const slots = session.puzzle_seeds as SessionSlot[];
  const seedToIndex = new Map(slots.map((s, i) => [s.seed, i]));

  const { data: attempts } = await supabase
    .from("attempts")
    .select("seed, puzzle_type, category, difficulty, correct, time_ms, hints_used, rating_delta")
    .eq("session_id", session.id);

  const perPuzzle = (attempts ?? [])
    .map((a) => ({
      slotIndex: seedToIndex.get(a.seed) ?? 0,
      type: a.puzzle_type,
      category: a.category,
      difficulty: a.difficulty,
      correct: a.correct,
      timeMs: a.time_ms,
      hintsUsed: a.hints_used,
      ratingDelta: a.rating_delta,
    }))
    .sort((a, b) => a.slotIndex - b.slotIndex);

  const ratingMoves = Object.entries(
    perPuzzle.reduce<Record<string, number>>((acc, p) => {
      acc[p.category] = (acc[p.category] ?? 0) + p.ratingDelta;
      return acc;
    }, {}),
  ).map(([category, delta]) => ({ category: category as Category, delta }));

  const { data: profile } = await supabase
    .from("profiles")
    .select("streak_current, streak_freezes, last_session_date, xp, level, cognitive_score")
    .eq("id", user.id)
    .single();

  const { data: newAchievements } = await supabase
    .from("achievements")
    .select("achievement_key")
    .eq("user_id", user.id)
    .gte("unlocked_at", session.started_at);

  return NextResponse.json({
    perPuzzle,
    xpEarned: session.xp_earned,
    accuracy: session.accuracy,
    score: session.score,
    cognitiveScoreAfter: session.cognitive_score_after,
    ratingMoves,
    streak: {
      current: profile?.streak_current ?? 0,
      freezes: profile?.streak_freezes ?? 0,
      extendedToday:
        session.type === "daily" &&
        profile?.last_session_date === session.date,
    },
    sessionType: session.type,
    feedback: session.feedback ?? "",
    newAchievements: (newAchievements ?? []).map((a) => a.achievement_key),
  });
}
