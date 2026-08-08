import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainSolution, gradeAnswer, solutionFor } from "@/lib/puzzles";
import { eloUpdate, cognitiveScore, nudgeMedian, loadRatings } from "@/lib/engine";
import { advanceStreak, localDate } from "@/lib/streak";
import { evaluateAchievements } from "@/lib/achievements";
import { generateRecapFeedback, type RecapPuzzleSummary } from "@/lib/ai";
import { scoreAttempt } from "@/lib/research/xp";
import type { HelpLevel } from "@/lib/research/types";
import { levelForXp, type PuzzleType, type SessionSlot } from "@/lib/types";

const bodySchema = z.object({
  slotIndex: z.number().int().min(0).max(4),
  answer: z.unknown(),
  timeMs: z.number().int().min(1).max(1_800_000),
  // Advisory only; the server-side hint_log is authoritative.
  hintTiersUsed: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).max(3).optional(),
  attempts: z.number().int().min(1).max(50).optional(),
});

export async function POST(
  request: Request,
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad attempt." }, { status: 400 });
  }
  const { slotIndex, answer, timeMs: clientTimeMs } = parsed.data;

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("sessions")
    .select("*")
    .eq("id", id)
    .single();
  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "No such session." }, { status: 404 });
  }
  if (session.status !== "in_progress") {
    return NextResponse.json(
      { error: "This session is already finished." },
      { status: 409 },
    );
  }

  const slots = session.puzzle_seeds as SessionSlot[];
  const slot = slots[slotIndex];
  if (!slot) {
    return NextResponse.json({ error: "No such puzzle slot." }, { status: 400 });
  }

  const { data: existing } = await admin
    .from("attempts")
    .select("id")
    .eq("session_id", session.id)
    .eq("seed", slot.seed)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "That puzzle was already answered." },
      { status: 409 },
    );
  }

  // Clamp the reported time to what the server can actually account for:
  // the slot cannot have started before the session began or before the
  // previous answer landed. A forged low timeMs would otherwise buy the
  // Elo speed bonus and drag the category median down.
  const { data: lastAttempt } = await admin
    .from("attempts")
    .select("created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const slotStart = Math.max(
    new Date(session.started_at).getTime(),
    lastAttempt ? new Date(lastAttempt.created_at).getTime() : 0,
  );
  const serverElapsed = Math.max(1, Date.now() - slotStart);
  const timeMs = Math.min(clientTimeMs, serverElapsed);

  // Grade server-side; the solution only leaves here after this point.
  const correct = gradeAnswer(slot.type, slot.seed, slot.difficulty, answer);
  const explanation = explainSolution(slot.type, slot.seed, slot.difficulty);
  const solution = solutionFor(slot.type, slot.seed, slot.difficulty);

  // Hints actually served for this seed (recorded by /api/hint).
  const hintLog = (session.hint_log ?? {}) as Record<string, number[]>;
  const tiersUsed = (hintLog[slot.seed] ?? []) as (1 | 2 | 3)[];

  // Elo update on the slot's category.
  const ratings = await loadRatings(admin, user.id);
  const ratingRow = ratings.find((r) => r.category === slot.category);
  const oldRating = ratingRow?.rating ?? 1000;
  const fasterThanMedian =
    correct &&
    ratingRow?.median_time_ms != null &&
    timeMs < ratingRow.median_time_ms;
  const newRating = eloUpdate({
    rating: oldRating,
    difficulty: slot.difficulty,
    correct,
    hintTiersUsed: tiersUsed,
    fasterThanMedian,
  });
  const ratingDelta = newRating - oldRating;

  // XP is independence-weighted, not completion-weighted (RESEARCH-SPEC R4,
  // §10). Map the puzzle-session signals onto the research scheme: a solve
  // with no hints is independent (+10); a solve after a wrong attempt is
  // persistence (+5) and self-correction (+5); a hint taken after a genuine
  // attempt and then solved is strategic help-seeking (+2), never punished as
  // avoidance. Completion alone earns nothing.
  const puzzleAttempts = parsed.data.attempts ?? 1;
  const hadEarlierError = puzzleAttempts > 1 && correct;
  // Hint tiers 1/2/3 map onto the graduated help ladder.
  const TIER_HELP: Record<1 | 2 | 3, HelpLevel> = {
    1: "question",
    2: "narrow",
    3: "next_step",
  };
  const maxHelpLevel: HelpLevel =
    tiersUsed.length === 0
      ? "none"
      : TIER_HELP[Math.max(...tiersUsed) as 1 | 2 | 3];
  const xpResult = scoreAttempt({
    unaided: tiersUsed.length === 0,
    outcome: correct ? "correct" : "incorrect",
    attemptsCount: puzzleAttempts,
    maxHelpLevel,
    selfCorrected: hadEarlierError,
    persistedAfterError: hadEarlierError,
    selfExplanation: false, // puzzle sessions do not collect one
    itemKind: "practice",
    strategicHintUse: tiersUsed.length > 0 && correct,
  });
  // Practice keeps its half-weight product rule (§4): it moves ratings but is
  // a lighter commitment than the daily.
  const xp =
    session.type === "practice"
      ? Math.round(xpResult.total / 2)
      : xpResult.total;

  // The insert is the dedup gate: the unique index on (session_id, seed)
  // rejects a concurrent duplicate BEFORE any score/xp write happens. The
  // earlier select is just a fast path for a clean error message.
  const { error: insertError } = await admin.from("attempts").insert({
    session_id: session.id,
    user_id: user.id,
    puzzle_type: slot.type,
    category: slot.category,
    difficulty: slot.difficulty,
    seed: slot.seed,
    correct,
    time_ms: timeMs,
    hints_used: tiersUsed.length,
    attempts: parsed.data.attempts ?? 1,
    answer: answer ?? null,
    rating_delta: ratingDelta,
  });
  if (insertError) {
    return NextResponse.json(
      { error: "That puzzle was already answered." },
      { status: 409 },
    );
  }

  // XP, rating and completion in one SQL call: increments happen in the
  // database so two slots submitted at once cannot lose an update, and the
  // conditional status flip means completion runs exactly once.
  const { data: claimedCompletion } = await admin.rpc("apply_attempt", {
    p_session: session.id,
    p_user: user.id,
    p_xp: xp,
    p_category: slot.category,
    p_rating: newRating,
    p_correct: correct,
    p_median: nudgeMedian(ratingRow?.median_time_ms ?? null, timeMs),
    p_slots: slots.length,
  });

  const sessionComplete = claimedCompletion === true;
  if (sessionComplete) {
    const { data: fresh } = await admin
      .from("sessions")
      .select("xp_earned")
      .eq("id", session.id)
      .single();
    await completeSession({
      admin,
      userId: user.id,
      sessionId: session.id,
      sessionType: session.type,
      challengeId: session.challenge_id,
      xpEarned: fresh?.xp_earned ?? session.xp_earned + xp,
    });
  }

  return NextResponse.json({
    correct,
    solution,
    explanation,
    xpEarned: xp,
    ratingDelta,
    sessionComplete,
  });
}

async function completeSession(args: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  sessionId: string;
  sessionType: string;
  challengeId: string | null;
  xpEarned: number;
}) {
  const { admin, userId, sessionId, sessionType, challengeId, xpEarned } = args;

  const { data: attempts } = await admin
    .from("attempts")
    .select("puzzle_type, category, difficulty, correct, time_ms, hints_used")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  const rows = attempts ?? [];
  const correctCount = rows.filter((a) => a.correct).length;
  const accuracy = rows.length ? correctCount / rows.length : 0;
  const totalTime = rows.reduce((n, a) => n + a.time_ms, 0);
  // Session score: 100 per solve, minus 10 per hint tier used on solved
  // puzzles — a headline number for recaps and challenge comparisons.
  const score = rows.reduce(
    (n, a) => n + (a.correct ? Math.max(50, 100 - a.hints_used * 10) : 0),
    0,
  );

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (!profile) return;

  const ratings = await loadRatings(admin, userId);
  const newCognitive = cognitiveScore(
    ratings.map((r) => ({ rating: r.rating, updated_at: r.updated_at })),
  );

  const profileUpdate: Partial<typeof profile> = {
    xp: profile.xp + xpEarned,
    level: levelForXp(profile.xp + xpEarned),
    cognitive_score: newCognitive,
  };

  if (sessionType === "daily") {
    const today = localDate(profile.timezone);
    const streak = advanceStreak(
      {
        current: profile.streak_current,
        longest: profile.streak_longest,
        freezes: profile.streak_freezes,
        lastSessionDate: profile.last_session_date,
      },
      today,
    );
    profileUpdate.streak_current = streak.current;
    profileUpdate.streak_longest = streak.longest;
    profileUpdate.streak_freezes = streak.freezes;
    profileUpdate.last_session_date = streak.lastSessionDate;
  }

  await admin.from("profiles").update(profileUpdate).eq("id", userId);

  if (sessionType === "challenge" && challengeId) {
    await admin.from("challenge_results").upsert(
      {
        challenge_id: challengeId,
        user_id: userId,
        score,
        time_ms: totalTime,
      },
      { onConflict: "challenge_id,user_id" },
    );
  }

  // Recap paragraph, generated once and stored on the session.
  const summaries: RecapPuzzleSummary[] = rows.map((a) => ({
    type: a.puzzle_type as PuzzleType,
    category: a.category,
    difficulty: a.difficulty,
    correct: a.correct,
    timeMs: a.time_ms,
    hintsUsed: a.hints_used,
  }));
  const feedback = await generateRecapFeedback(summaries);

  // apply_attempt already flipped status to complete (that flip is what
  // claimed this run); fill in the rest of the summary.
  await admin
    .from("sessions")
    .update({
      completed_at: new Date().toISOString(),
      accuracy,
      score,
      cognitive_score_after: newCognitive,
      feedback,
    })
    .eq("id", sessionId);

  // Achievements fire in a single server evaluation after each session (§6).
  await evaluateAchievements(admin, userId).catch(() => []);
  // Weekly leaderboard surface; a failed refresh must not fail the session.
  await admin.rpc("refresh_weekly_xp").then(
    () => undefined,
    () => undefined,
  );
}
