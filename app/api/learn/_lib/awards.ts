import "server-only";
import { levelForXp } from "@/lib/types";
import { scoreAttempt, type XpInput, type XpResult } from "@/lib/research/xp";
import { buildProfile, type IndependenceDailyRow } from "@/lib/research/independence";
import { calibrationError } from "@/lib/research/calibration";
import type { IndependenceContext } from "@/lib/research/tutor";
import { isoDate } from "@/lib/research/items";
import { XP, type AttemptOutcome, type HelpLevel, type ItemKind, type SupportLevel } from "@/lib/research/types";
import {
  int,
  num,
  readRow,
  readRows,
  str,
  write,
  type ItemAttemptRow,
  type ResearchDb,
  type Row,
  type SecretItemRow,
  type StepRow,
} from "./db";
import { wasUnaided } from "./context";

// Writes that follow from an attempt: the chain, XP, completion, the spaced
// review, and the daily roll-up. Everything here runs on the service role after
// the caller has been verified in `context.ts`.

// ---------------------------------------------------------------------------
// The attempt chain (B2)
// ---------------------------------------------------------------------------

export interface StepInput {
  kind: "attempt" | "hint" | "stuck" | "explain_back";
  help?: HelpLevel | null;
  input?: unknown;
  ai?: string | null;
  grounded?: boolean | null;
  confidence?: number | null;
  outcome?: AttemptOutcome | null;
  elapsedMs?: number | null;
}

/**
 * `record_attempt_step` keeps the parent counters honest inside one statement:
 * an 'attempt' bumps `attempts_count`, a 'hint' raises `max_help_level` and sets
 * `solution_revealed`. Nothing else may write those columns.
 */
export async function recordStep(
  db: ResearchDb,
  attemptId: string,
  step: StepInput,
): Promise<number> {
  const { data, error } = await db.rpc("record_attempt_step", {
    p_attempt: attemptId,
    p_kind: step.kind,
    p_help: step.help ?? null,
    p_input: step.input ?? null,
    p_ai: step.ai ?? null,
    p_grounded: step.grounded ?? null,
    p_confidence: step.confidence ?? null,
    p_outcome: step.outcome ?? null,
    p_elapsed: step.elapsedMs ?? null,
  });
  if (error) throw new Error(`Could not record that step: ${error.message}`);
  return int(data, 0);
}

/**
 * B7 records "I'm stuck" as its own step kind so it stays distinguishable in
 * analysis, which means `record_attempt_step` will not raise `max_help_level`
 * for it. This does that separately, and only ever upwards.
 */
export async function raiseMaxHelp(
  db: ResearchDb,
  attemptId: string,
  level: HelpLevel,
): Promise<void> {
  await write(
    db.from("item_attempts").update({ max_help_level: level }).eq("id", attemptId),
    "the help level",
  );
}

/**
 * B5 — time thinking before help: the gap between the item appearing and the
 * first thing the student did with it, whether that was an attempt or a request
 * for help. Written once and never overwritten.
 */
export async function markThinkMs(db: ResearchDb, attempt: ItemAttemptRow): Promise<void> {
  if (attempt.think_ms !== null) return;
  const started = Date.parse(attempt.started_at);
  if (!Number.isFinite(started)) return;
  await write(
    db
      .from("item_attempts")
      .update({ think_ms: Math.max(0, Math.round(Date.now() - started)) })
      .eq("id", attempt.id)
      .is("think_ms", null),
    "your thinking time",
  );
}

// ---------------------------------------------------------------------------
// §10 — independence XP
// ---------------------------------------------------------------------------

export interface XpContext {
  attempt: ItemAttemptRow;
  item: SecretItemRow;
  steps: StepRow[];
  tutorTurns: number;
  /** Genuine attempts. Filler never buys XP (X2). */
  attemptsCounted: number;
  outcome: AttemptOutcome;
}

export function xpInputFor(ctx: XpContext): XpInput {
  return {
    unaided: wasUnaided(ctx.attempt, ctx.tutorTurns),
    outcome: ctx.outcome,
    attemptsCount: ctx.attemptsCounted,
    maxHelpLevel: ctx.attempt.max_help_level,
    selfCorrected: ctx.attempt.self_corrected,
    persistedAfterError: ctx.attempt.persisted_after_error,
    selfExplanation: ctx.attempt.self_explanation !== null,
    itemKind: ctx.item.kind as ItemKind,
  };
}

export function xpFor(ctx: XpContext): XpResult {
  return scoreAttempt(xpInputFor(ctx));
}

export interface XpAward extends XpResult {
  /** What actually moved the balance on this request. */
  delta: number;
}

/**
 * Pays the difference between what this item has earned so far and what it is
 * worth now, so the same award is never paid twice. `/explain-back` can hand
 * over its +5 the moment the explanation lands, and the completion award nets
 * out against it.
 *
 * Nothing is ever deducted. §10 sets unnecessary dependence at 0, not at minus
 * anything: the payoff for offloading is removed, and that is the whole
 * intervention. A student whose last attempt was filler keeps the +5 they earned
 * for persisting earlier.
 */
export async function awardXp(
  db: ResearchDb,
  attempt: ItemAttemptRow,
  result: XpResult,
): Promise<XpAward> {
  const delta = result.total - attempt.xp_awarded;
  if (delta <= 0) return { ...result, delta: 0 };

  await write(
    db.from("item_attempts").update({ xp_awarded: result.total }).eq("id", attempt.id),
    "your XP for this item",
  );

  const profile = await readRow(
    db.from("profiles").select("xp").eq("id", attempt.user_id).maybeSingle(),
    "your profile",
  );
  const total = Math.max(0, int(profile?.xp, 0) + delta);
  await write(
    db.from("profiles").update({ xp: total, level: levelForXp(total) }).eq("id", attempt.user_id),
    "your XP",
  );

  attempt.xp_awarded = result.total;
  return { ...result, delta };
}

/** The +5 for writing the explanation, paid once, the first time one lands (N9). */
export async function awardSelfExplanation(
  db: ResearchDb,
  attempt: ItemAttemptRow,
): Promise<XpAward> {
  const lines = [
    {
      key: "selfExplanation" as const,
      label: "Explained your reasoning in your own words",
      amount: XP.selfExplanation,
    },
  ];
  return awardXp(db, attempt, {
    total: attempt.xp_awarded + XP.selfExplanation,
    lines,
  });
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export interface CompletionPatch {
  outcome: AttemptOutcome;
  unaided: boolean;
  totalMs: number | null;
}

/**
 * Marks the item finished, exactly once. The `completed_at is null` predicate
 * makes the transition atomic, and the return value says whether THIS request
 * made it — which is what stops the daily roll-up being counted twice when an
 * item is solved on `/attempt` and then closed on `/finish`.
 */
export async function completeAttempt(
  db: ResearchDb,
  attempt: ItemAttemptRow,
  patch: CompletionPatch,
): Promise<boolean> {
  const completedAt = new Date().toISOString();
  const rows = await readRows(
    db
      .from("item_attempts")
      .update({
        outcome: patch.outcome,
        unaided: patch.unaided,
        total_ms: patch.totalMs,
        completed_at: completedAt,
      })
      .eq("id", attempt.id)
      .is("completed_at", null)
      .select("id"),
    "the finished item",
  );

  if (rows.length === 0) return false;
  attempt.outcome = patch.outcome;
  attempt.unaided = patch.unaided;
  attempt.completed_at = completedAt;
  return true;
}

export function elapsedMsSince(startedAt: string): number | null {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.round(Date.now() - started));
}

// ---------------------------------------------------------------------------
// N8 — spaced retrieval
// ---------------------------------------------------------------------------

/** SM-2-style expanding interval. Returns the next due date (N8, A3). */
export async function scheduleReview(
  db: ResearchDb,
  userId: string,
  itemId: string,
  correct: boolean,
): Promise<string | null> {
  const { data, error } = await db.rpc("schedule_review", {
    p_user: userId,
    p_item: itemId,
    p_correct: correct,
  });
  if (error) throw new Error(`Could not schedule the review: ${error.message}`);
  return str(data);
}

export async function nextReviewDate(
  db: ResearchDb,
  userId: string,
  itemId: string,
): Promise<string | null> {
  const row = await readRow(
    db
      .from("reviews")
      .select("due_on")
      .eq("user_id", userId)
      .eq("item_id", itemId)
      .maybeSingle(),
    "your review queue",
  );
  return str(row?.due_on);
}

// ---------------------------------------------------------------------------
// §12 — the daily roll-up
// ---------------------------------------------------------------------------

/**
 * Folds one finished item into `independence_daily`. The function itself returns
 * early unless the attempt is complete, so it is only ever called on the request
 * that made the completion transition.
 */
export async function rollIndependence(db: ResearchDb, attemptId: string): Promise<void> {
  const { error } = await db.rpc("roll_independence", { p_attempt: attemptId });
  if (error) throw new Error(`Could not update your daily counts: ${error.message}`);
}

/**
 * Three columns of `independence_daily` that `roll_independence` leaves alone,
 * filled in here on the same request that rolled the item:
 *
 *   - `delayed_retention_due` / `delayed_retention_correct` (A5, M1). An item
 *     served in 'review' mode came back off the spaced queue, and
 *     `schedule_review` never sets a due date sooner than tomorrow, so every
 *     review attempt is a delayed re-test by construction.
 *   - `calibration_error` (H4) and `median_think_ms` (B5), recomputed from
 *     today's finished items rather than accumulated. A recompute is idempotent,
 *     which matters because these are the numbers the profile reads.
 *
 * The migration is authoritative and untouched; this is the caller doing the
 * part the RPC does not.
 */
export async function rollDerived(
  db: ResearchDb,
  userId: string,
  options: { review: boolean; correct: boolean },
): Promise<void> {
  const day = isoDate();

  const finished = await readRows(
    db
      .from("item_attempts")
      .select("think_ms, confidence_before, outcome")
      .eq("user_id", userId)
      .gte("completed_at", `${day}T00:00:00.000Z`)
      .limit(200),
    "today's items",
  );

  const points = finished
    .map((row) => ({ confidence: num(row.confidence_before), correct: row.outcome === "correct" }))
    .filter((point): point is { confidence: number; correct: boolean } => point.confidence !== null);
  const thinkTimes = finished
    .map((row) => num(row.think_ms))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const patch: Record<string, unknown> = {
    calibration_error: calibrationError(points),
    median_think_ms: median(thinkTimes),
  };

  if (options.review) {
    const current = await readRow(
      db
        .from("independence_daily")
        .select("delayed_retention_due, delayed_retention_correct")
        .eq("user_id", userId)
        .eq("day", day)
        .maybeSingle(),
      "your daily counts",
    );
    if (current) {
      patch.delayed_retention_due = int(current.delayed_retention_due, 0) + 1;
      patch.delayed_retention_correct =
        int(current.delayed_retention_correct, 0) + (options.correct ? 1 : 0);
    }
  }

  await write(
    db.from("independence_daily").update(patch).eq("user_id", userId).eq("day", day),
    "your daily counts",
  );
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? Math.round(sorted[middle])
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

const DAILY_SELECT =
  "day, unaided_attempts, unaided_correct, delayed_retention_due, delayed_retention_correct, " +
  "transfer_attempts, transfer_correct, total_attempts, hints_requested, solutions_revealed, " +
  "skipped, median_think_ms, calibration_error, self_explanations, assisted_correct, assisted_attempts";

function asDailyRow(row: Row): IndependenceDailyRow | null {
  const day = str(row.day);
  if (!day) return null;
  return {
    day,
    unaided_attempts: int(row.unaided_attempts, 0),
    unaided_correct: int(row.unaided_correct, 0),
    delayed_retention_due: int(row.delayed_retention_due, 0),
    delayed_retention_correct: int(row.delayed_retention_correct, 0),
    transfer_attempts: int(row.transfer_attempts, 0),
    transfer_correct: int(row.transfer_correct, 0),
    total_attempts: int(row.total_attempts, 0),
    hints_requested: int(row.hints_requested, 0),
    solutions_revealed: int(row.solutions_revealed, 0),
    skipped: int(row.skipped, 0),
    median_think_ms: num(row.median_think_ms),
    calibration_error: num(row.calibration_error),
    self_explanations: int(row.self_explanations, 0),
    assisted_correct: int(row.assisted_correct, 0),
    assisted_attempts: int(row.assisted_attempts, 0),
  };
}

const PROFILE_WINDOW_DAYS = 14;

/**
 * The behavioural proxies the feedback writer is allowed to quote (F4, M5).
 * Values stay null until the dimension clears its sample floor, so feedback
 * never quotes a rate computed from three items.
 */
export async function independenceContextFor(
  db: ResearchDb,
  userId: string,
  supportLevel: SupportLevel,
): Promise<IndependenceContext> {
  const since = isoDate(new Date(Date.now() - PROFILE_WINDOW_DAYS * 2 * 86_400_000));
  const rows = await readRows(
    db
      .from("independence_daily")
      .select(DAILY_SELECT)
      .eq("user_id", userId)
      .gte("day", since)
      .order("day", { ascending: true })
      .limit(60),
    "your independence counts",
  );

  const daily = rows
    .map(asDailyRow)
    .filter((row): row is IndependenceDailyRow => row !== null);
  const profile = buildProfile(daily, PROFILE_WINDOW_DAYS);
  const find = (key: string) => profile.dimensions.find((d) => d.key === key) ?? null;
  const reliance = find("hint_reliance");
  const unaided = find("unaided_accuracy");

  return {
    supportLevel,
    hintReliancePct: reliance?.value ?? null,
    unaidedAccuracyPct: unaided?.value ?? null,
    sample: reliance?.sample ?? 0,
  };
}
