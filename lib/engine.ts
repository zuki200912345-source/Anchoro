import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { newSeed, createRng } from "@/lib/rng";
import {
  CATEGORIES,
  ELO_K,
  HINT_SCORE_COST,
  PUZZLE_CATEGORIES,
  PUZZLE_TYPES,
  SPEED_BONUS,
  puzzleRating,
  type Category,
  type PuzzleType,
  type SessionSlot,
} from "@/lib/types";
import type { CategoryRatingRow } from "@/lib/database.types";

type Admin = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// Pure scoring math (§5) — unit-tested without a database.
// ---------------------------------------------------------------------------

export function expectedScore(userRating: number, difficulty: number): number {
  return 1 / (1 + Math.pow(10, (puzzleRating(difficulty) - userRating) / 400));
}

export function effectiveScore(args: {
  correct: boolean;
  hintTiersUsed: number[];
  fasterThanMedian: boolean;
}): number {
  if (!args.correct) return 0;
  let score = 1;
  for (const tier of args.hintTiersUsed) {
    score -= HINT_SCORE_COST[tier as 1 | 2 | 3] ?? 0;
  }
  if (args.fasterThanMedian) score += SPEED_BONUS;
  return Math.min(1, Math.max(0, score));
}

export function eloUpdate(args: {
  rating: number;
  difficulty: number;
  correct: boolean;
  hintTiersUsed: number[];
  fasterThanMedian: boolean;
}): number {
  const expected = expectedScore(args.rating, args.difficulty);
  const actual = effectiveScore(args);
  return Math.round(args.rating + ELO_K * (actual - expected));
}

// Pick the difficulty whose expected win rate is closest to 0.675 (§5 asks
// for 60–75%); clamped to 1..10.
export function targetDifficulty(rating: number): number {
  let best = 1;
  let bestDist = Infinity;
  for (let d = 1; d <= 10; d++) {
    const dist = Math.abs(expectedScore(rating, d) - 0.675);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

// DEPRECATED (RESEARCH-SPEC R1). A single composite of accuracy, time, hints
// and retention is not a validated construct, and the research strategy places
// a single "brain score" on its Do-Not-Build list. This is retained only so the
// completeSession write path and existing rows keep working; nothing displays
// it any more. The headline progress view is the transparent independence
// profile (Feature F) at /independence, which shows each dimension separately
// with its own sample size and confidence interval. Do not add new readers.
//
// Recency-weighted mean of the six category ratings: categories tested recently
// count more. Weight = 1 / (1 + days since last update), normalised, clamped to
// 0..1000 (ratings live near 800–1600; mapped 600..1600 → 0..1000).
export function cognitiveScore(
  ratings: { rating: number; updated_at: string }[],
  now: Date = new Date(),
): number {
  if (ratings.length === 0) return 500;
  let weightSum = 0;
  let acc = 0;
  for (const r of ratings) {
    const days = Math.max(
      0,
      (now.getTime() - new Date(r.updated_at).getTime()) / 86_400_000,
    );
    const w = 1 / (1 + days);
    weightSum += w;
    acc += w * r.rating;
  }
  const mean = acc / weightSum;
  return Math.round(Math.min(1000, Math.max(0, ((mean - 600) / 1000) * 1000)));
}

// Which puzzle types can serve a category.
export function typesForCategory(category: Category): PuzzleType[] {
  return PUZZLE_TYPES.filter((t) => PUZZLE_CATEGORIES[t].includes(category));
}

// Build the five slots for a daily session (§5): 3 puzzles from the two
// weakest categories (2 weakest + 1 second-weakest), 2 from anywhere else,
// difficulty targeted at each slot's category rating, never two of the same
// type back to back. Seed uniqueness against history is enforced by the
// caller (it has DB access).
export function buildDailySlots(
  ratingsByCategory: Record<Category, number>,
  rngSeed: string,
): SessionSlot[] {
  const rng = createRng(rngSeed);
  const sorted = [...CATEGORIES].sort(
    (a, b) => ratingsByCategory[a] - ratingsByCategory[b],
  );
  const [weakest, second] = [sorted[0], sorted[1]];
  const rest = sorted.slice(2);
  const categories: Category[] = [
    weakest,
    weakest,
    second,
    rng.pick(rest),
    rng.pick(rest),
  ];

  const slots: SessionSlot[] = [];
  for (const category of rng.shuffle(categories)) {
    const options = typesForCategory(category).filter(
      (t) => t !== slots[slots.length - 1]?.type,
    );
    const pool = options.length > 0 ? options : typesForCategory(category);
    const type = rng.pick(pool);
    slots.push({
      type,
      category,
      seed: newSeed(type),
      difficulty: targetDifficulty(ratingsByCategory[category]),
    });
  }

  // Final pass: if a same-type adjacency survived (single-type categories
  // like memory), swap with a non-adjacent slot when possible.
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].type === slots[i - 1].type) {
      const j = slots.findIndex(
        (s, k) =>
          k !== i &&
          s.type !== slots[i].type &&
          (k === 0 || slots[k - 1].type !== slots[i].type) &&
          (k === slots.length - 1 || slots[k + 1]?.type !== slots[i].type),
      );
      if (j >= 0) [slots[i], slots[j]] = [slots[j], slots[i]];
    }
  }
  return slots;
}

// Practice slots: five puzzles serving one category at a fixed difficulty,
// alternating types where the category has two.
export function buildPracticeSlots(
  category: Category,
  difficulty: number,
): SessionSlot[] {
  const types = typesForCategory(category);
  return Array.from({ length: 5 }, (_, i) => {
    const type = types[i % types.length];
    return { type, category, seed: newSeed(type), difficulty };
  });
}

// ---------------------------------------------------------------------------
// DB-backed helpers.
// ---------------------------------------------------------------------------

export async function loadRatings(
  admin: Admin,
  userId: string,
): Promise<CategoryRatingRow[]> {
  const { data, error } = await admin
    .from("category_ratings")
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function selectDailySlots(
  admin: Admin,
  userId: string,
): Promise<SessionSlot[]> {
  const ratings = await loadRatings(admin, userId);
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, 1000]),
  ) as Record<Category, number>;
  for (const r of ratings) byCategory[r.category] = r.rating;

  const slots = buildDailySlots(byCategory, newSeed("daily"));

  // Never repeat a seed the user has already seen (§5). Seeds are 64-bit
  // random so collisions are cosmically unlikely, but the spec asks.
  const { data: seen } = await admin
    .from("attempts")
    .select("seed")
    .eq("user_id", userId)
    .in("seed", slots.map((s) => s.seed));
  const seenSet = new Set((seen ?? []).map((r) => r.seed));
  for (const slot of slots) {
    while (seenSet.has(slot.seed)) slot.seed = newSeed(slot.type);
  }
  return slots;
}

// Nudged median (documented approximation): rather than storing every time,
// move the stored median 10% toward each new observation.
export function nudgeMedian(current: number | null, timeMs: number): number {
  if (current === null) return timeMs;
  return Math.round(current + (timeMs - current) * 0.1);
}
