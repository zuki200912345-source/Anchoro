import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

// Achievement definitions and the single server evaluation function (§6).
// The session-completion path calls evaluateAchievements after each session;
// it must never throw, because a failed evaluation must not fail the session.
//
// Structure: pure predicates over an AchievementStats snapshot (unit-tested
// in lib/__tests__/achievements.test.ts), plus one DB-facing function that
// gathers the snapshot, diffs against already-earned rows, and inserts only
// the new ones.

type Admin = ReturnType<typeof createAdminClient>;

export interface AchievementDef {
  key: string;
  name: string;
  description: string; // shown once earned
  hint: string; // shown on the locked silhouette
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // Volume
  {
    key: "first_session",
    name: "opening move",
    description: "First session finished. Now do tomorrow's.",
    hint: "finish one session",
  },
  {
    key: "solved_10",
    name: "double digits",
    description: "10 puzzles solved.",
    hint: "solve 10 puzzles",
  },
  {
    key: "solved_50",
    name: "half century",
    description: "50 solved. Past the warm-up.",
    hint: "solve 50 puzzles",
  },
  {
    key: "solved_100",
    name: "century",
    description: "100 puzzles solved, every one on record.",
    hint: "solve 100 puzzles",
  },
  {
    key: "solved_250",
    name: "the long haul",
    description: "250 solved. This stopped being casual a while ago.",
    hint: "solve 250 puzzles",
  },
  // Independence
  {
    key: "no_hint_5",
    name: "own work",
    description: "5 straight solves, zero hints.",
    hint: "solve 5 in a row without a hint",
  },
  {
    key: "no_hint_20",
    name: "cold solver",
    description: "20 in a row without touching the hint button.",
    hint: "solve 20 in a row without a hint",
  },
  {
    key: "clean_session",
    name: "clean sheet",
    description: "A whole session and the hint button never got pressed.",
    hint: "finish a session without hints",
  },
  // Consistency
  {
    key: "streak_3",
    name: "three days",
    description: "3 days straight. A pattern forms.",
    hint: "keep a 3-day streak",
  },
  {
    key: "streak_7",
    name: "the full week",
    description: "7 days without a gap.",
    hint: "keep a 7-day streak",
  },
  {
    key: "streak_14",
    name: "fortnight",
    description: "14 consecutive days. Most people quit by day 4.",
    hint: "keep a 14-day streak",
  },
  {
    key: "iron_streak_30",
    name: "iron month",
    description: "30 days straight. The calendar works for you now.",
    hint: "keep a 30-day streak",
  },
  // Category mastery
  {
    key: "rating_1400",
    name: "specialist",
    description: "One category rated 1400 or better.",
    hint: "reach a 1400 rating in any category",
  },
  {
    key: "rating_1400_x3",
    name: "triple threat",
    description: "Three categories at 1400 or better.",
    hint: "reach 1400 in three categories",
  },
  // Performance
  {
    key: "perfect_session",
    name: "five for five",
    description: "Every puzzle in a session, correct.",
    hint: "go 5 for 5 in one session",
  },
  {
    key: "flawless_session",
    name: "flawless",
    description: "5 for 5 with zero hints. Frame it.",
    hint: "go 5 for 5 without a hint",
  },
  {
    key: "d10_solve",
    name: "the deep end",
    description: "A difficulty 10 puzzle, solved.",
    hint: "solve a difficulty 10 puzzle",
  },
  {
    key: "sub_10s",
    name: "quick draw",
    description: "Correct in under 10 seconds.",
    hint: "solve any puzzle in under 10 seconds",
  },
  {
    key: "comeback",
    name: "the recovery",
    description: "Three misses, then a solve. Steady hands.",
    hint: "solve one after 3 straight misses",
  },
  // Social
  {
    key: "first_friend",
    name: "two player",
    description: "First friend on the list.",
    hint: "add a friend who accepts",
  },
  {
    key: "challenge_win",
    name: "head to head",
    description: "Top score in a challenge against at least one other.",
    hint: "win a challenge",
  },
];

// ---------------------------------------------------------------------------
// Pure helpers. No database, so the qualification rules are unit-testable.
// ---------------------------------------------------------------------------

export interface AttemptLite {
  correct: boolean;
  hintsUsed: number;
}

// Longest run of consecutive hint-free solves in the given window (oldest
// first). A miss or a hinted solve breaks the run.
export function computeHintFreeRun(attempts: AttemptLite[]): number {
  let best = 0;
  let run = 0;
  for (const a of attempts) {
    if (a.correct && a.hintsUsed === 0) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

// True when a correct answer directly follows 3 or more consecutive misses.
export function hasComebackSolve(attempts: { correct: boolean }[]): boolean {
  let misses = 0;
  for (const a of attempts) {
    if (a.correct) {
      if (misses >= 3) return true;
      misses = 0;
    } else {
      misses += 1;
    }
  }
  return false;
}

// A win: the user holds the top score in a challenge with 2+ results.
export function countChallengeWins(
  userId: string,
  results: { challenge_id: string; user_id: string; score: number }[],
): number {
  const byChallenge = new Map<string, { user_id: string; score: number }[]>();
  for (const r of results) {
    const rows = byChallenge.get(r.challenge_id) ?? [];
    rows.push({ user_id: r.user_id, score: r.score });
    byChallenge.set(r.challenge_id, rows);
  }
  let wins = 0;
  for (const rows of byChallenge.values()) {
    if (rows.length < 2) continue;
    const mine = rows.find((r) => r.user_id === userId);
    if (!mine) continue;
    const top = Math.max(...rows.map((r) => r.score));
    if (mine.score >= top) wins += 1;
  }
  return wins;
}

// Snapshot of everything the predicates need, gathered in one pass.
export interface AchievementStats {
  completedSessions: number;
  solvedPuzzles: number;
  bestHintFreeRun: number;
  hasNoHintSession: boolean;
  hasPerfectSession: boolean;
  hasPerfectNoHintSession: boolean;
  streakBest: number;
  bestCategoryRating: number;
  categoriesAt1400: number;
  hasD10Solve: boolean;
  hasSub10sSolve: boolean;
  hasComeback: boolean;
  acceptedFriends: number;
  challengeWins: number;
}

const QUALIFIES: Record<string, (s: AchievementStats) => boolean> = {
  first_session: (s) => s.completedSessions >= 1,
  solved_10: (s) => s.solvedPuzzles >= 10,
  solved_50: (s) => s.solvedPuzzles >= 50,
  solved_100: (s) => s.solvedPuzzles >= 100,
  solved_250: (s) => s.solvedPuzzles >= 250,
  no_hint_5: (s) => s.bestHintFreeRun >= 5,
  no_hint_20: (s) => s.bestHintFreeRun >= 20,
  clean_session: (s) => s.hasNoHintSession,
  streak_3: (s) => s.streakBest >= 3,
  streak_7: (s) => s.streakBest >= 7,
  streak_14: (s) => s.streakBest >= 14,
  iron_streak_30: (s) => s.streakBest >= 30,
  rating_1400: (s) => s.bestCategoryRating >= 1400,
  rating_1400_x3: (s) => s.categoriesAt1400 >= 3,
  perfect_session: (s) => s.hasPerfectSession,
  flawless_session: (s) => s.hasPerfectNoHintSession,
  d10_solve: (s) => s.hasD10Solve,
  sub_10s: (s) => s.hasSub10sSolve,
  comeback: (s) => s.hasComeback,
  first_friend: (s) => s.acceptedFriends >= 1,
  challenge_win: (s) => s.challengeWins >= 1,
};

// All keys the snapshot qualifies for, in definition order.
export function pickEarnedKeys(stats: AchievementStats): string[] {
  return ACHIEVEMENTS.filter((a) => QUALIFIES[a.key]?.(stats) ?? false).map(
    (a) => a.key,
  );
}

// ---------------------------------------------------------------------------
// The single post-session evaluation (§6). Gathers counts, computes which
// keys qualify, inserts only rows the user does not already have, and returns
// the newly inserted keys. Swallows every failure: partial data means fewer
// achievements this round, not a broken session.
// ---------------------------------------------------------------------------

// Recent-attempt window for run-based checks. 300 rows covers 60 sessions,
// far more than any run we measure.
const RECENT_WINDOW = 300;

export async function evaluateAchievements(
  admin: Admin,
  userId: string,
): Promise<string[]> {
  try {
    const [
      profileQ,
      ratingsQ,
      solvedQ,
      sessionsQ,
      noHintSessionQ,
      perfectQ,
      flawlessQ,
      d10Q,
      fastQ,
      recentQ,
      friendsQ,
      myResultsQ,
    ] = await Promise.all([
      admin
        .from("profiles")
        .select("streak_current, streak_longest")
        .eq("id", userId)
        .maybeSingle(),
      admin.from("category_ratings").select("rating").eq("user_id", userId),
      admin
        .from("attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("correct", true),
      admin
        .from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "complete"),
      admin
        .from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "complete")
        .eq("hints_used", 0),
      admin
        .from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "complete")
        .eq("accuracy", 1),
      admin
        .from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "complete")
        .eq("accuracy", 1)
        .eq("hints_used", 0),
      admin
        .from("attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("correct", true)
        .eq("difficulty", 10),
      admin
        .from("attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("correct", true)
        .lt("time_ms", 10_000),
      admin
        .from("attempts")
        .select("correct, hints_used")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(RECENT_WINDOW),
      admin
        .from("friendships")
        .select("*", { count: "exact", head: true })
        .eq("status", "accepted")
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
      admin
        .from("challenge_results")
        .select("challenge_id, score")
        .eq("user_id", userId),
    ]);

    // Challenge wins need the peers' rows for the challenges the user played.
    let challengeWins = 0;
    const myResults = myResultsQ.data ?? [];
    if (myResults.length > 0) {
      const { data: peers } = await admin
        .from("challenge_results")
        .select("challenge_id, user_id, score")
        .in(
          "challenge_id",
          myResults.map((r) => r.challenge_id),
        );
      challengeWins = countChallengeWins(userId, peers ?? []);
    }

    // Window comes back newest first; run logic wants oldest first.
    const recent = (recentQ.data ?? [])
      .slice()
      .reverse()
      .map((r) => ({ correct: r.correct, hintsUsed: r.hints_used }));
    const ratings = (ratingsQ.data ?? []).map((r) => r.rating);
    const profile = profileQ.data;

    const stats: AchievementStats = {
      completedSessions: sessionsQ.count ?? 0,
      solvedPuzzles: solvedQ.count ?? 0,
      bestHintFreeRun: computeHintFreeRun(recent),
      hasNoHintSession: (noHintSessionQ.count ?? 0) > 0,
      hasPerfectSession: (perfectQ.count ?? 0) > 0,
      hasPerfectNoHintSession: (flawlessQ.count ?? 0) > 0,
      streakBest: Math.max(
        profile?.streak_current ?? 0,
        profile?.streak_longest ?? 0,
      ),
      bestCategoryRating: ratings.length > 0 ? Math.max(...ratings) : 0,
      categoriesAt1400: ratings.filter((r) => r >= 1400).length,
      hasD10Solve: (d10Q.count ?? 0) > 0,
      hasSub10sSolve: (fastQ.count ?? 0) > 0,
      hasComeback: hasComebackSolve(recent),
      acceptedFriends: friendsQ.count ?? 0,
      challengeWins,
    };

    const earned = pickEarnedKeys(stats);
    if (earned.length === 0) return [];

    const { data: existing } = await admin
      .from("achievements")
      .select("achievement_key")
      .eq("user_id", userId);
    const have = new Set((existing ?? []).map((r) => r.achievement_key));
    const fresh = earned.filter((k) => !have.has(k));
    if (fresh.length === 0) return [];

    const { error } = await admin.from("achievements").upsert(
      fresh.map((k) => ({ user_id: userId, achievement_key: k })),
      { onConflict: "user_id,achievement_key", ignoreDuplicates: true },
    );
    if (error) return [];
    return fresh;
  } catch {
    return [];
  }
}
