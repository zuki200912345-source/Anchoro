import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ensureAssignment } from "@/lib/research/experiments";
import {
  computeSupportLevel,
  helpGate,
  type CompetenceSignal,
  type HelpGateResult,
  type SupportDecision,
} from "@/lib/research/support";
import { toPublicItem, type ItemRow } from "@/lib/research/items";
import type { AttemptRecord, TutorItem } from "@/lib/research/tutor";
import {
  SUPPORT_POLICIES,
  helpRank,
  type Arm,
  type AttemptState,
  type HelpLevel,
  type ItemKind,
  type SupportLevel,
  type SupportPolicy,
} from "@/lib/research/types";
import {
  asItemAttempt,
  asSecretItem,
  asSteps,
  helpLevel as parseHelpLevel,
  ITEM_ATTEMPT_SELECT,
  learnClients,
  num,
  readRow,
  readRows,
  SECRET_ITEM_SELECT,
  STEP_SELECT,
  str,
  write,
  type ItemAttemptRow,
  type LearnClients,
  type ResearchDb,
  type SecretItemRow,
  type StepRow,
} from "./db";

// Shared request context for the attempt-first engine.
//
// Three rules are enforced here rather than in each route, so there is one place
// to audit:
//
//   1. The caller is identified from the Supabase cookie session. The
//      service-role client is only handed out after that.
//   2. Every attempt is loaded with `user_id = caller`, so a service-role write
//      can never touch someone else's row.
//   3. The help gate (B1, B4) is computed from the support policy stamped on the
//      attempt and the number of GENUINE attempts on the chain.

export interface AuthedUser {
  id: string;
}

/** Cookie-session auth. Null means the route must return 401. */
export async function currentUser(): Promise<AuthedUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}

// ---------------------------------------------------------------------------
// §13 E2 — the attempt-first RCT
// ---------------------------------------------------------------------------

/**
 * The experiment the whole product exists to test: attempt-first + scaffolded
 * fading hints (treatment) against the same tool offering **answers on demand**
 * (control).
 *
 * For a control user the gate is open from the first request and the worked
 * solution is reachable straight away. That is not a bug and not a bypass — it
 * is the comparator condition. Without a faithful control arm the trial measures
 * nothing, so it is implemented deliberately, in this one function, keyed on the
 * stored arm and on nothing else. There is no request parameter, header, or
 * query string anywhere in `/api/learn` that opens the gate.
 *
 * Two things stay true in both arms:
 *
 *   - A brain-only session withholds AI for its whole length (E1). The student
 *     opted into an unaided session; that is Feature E, not the attempt gate.
 *   - Everything is still recorded identically — attempts, hints, timings — so
 *     the arms are comparable on the primary outcomes (M1).
 */
export function policyForArm(policy: SupportPolicy, arm: Arm): SupportPolicy {
  if (arm !== "control") return policy;
  return {
    ...policy,
    maxHelp: "solution",
    attemptsBeforeHelp: 0,
    attemptsBeforeSolution: 0,
    description: "Hints and the worked solution are available whenever you ask.",
  };
}

/** The attempt-first arm for this user, assigned once and then sticky (E1). */
export async function attemptFirstArm(clients: LearnClients, userId: string): Promise<Arm> {
  return ensureAssignment(clients.experiments, userId, "attempt_first");
}

// ---------------------------------------------------------------------------
// Feature D — resolving the support level
// ---------------------------------------------------------------------------

const FADE_HISTORY = 10;

function asSupportLevel(value: number | null | undefined, fallback: SupportLevel): SupportLevel {
  if (value == null || !Number.isFinite(value)) return fallback;
  const n = Math.round(value);
  return (n < 1 ? 1 : n > 5 ? 5 : n) as SupportLevel;
}

export interface SupportResolution {
  level: SupportLevel;
  policy: SupportPolicy;
  decision: SupportDecision;
  /** True when the fading arm is fixed-support, so the level did not move (E6). */
  fixed: boolean;
}

/**
 * D2/D4 — reads the level in force, recomputes it from recent finished items,
 * and persists a move. Called at `/start` only: the policy is then stamped on
 * the attempt (`support_level_at_time`) so the rules cannot change underneath a
 * student mid-item (D6).
 *
 * §13 E6 runs alongside: users in the fading CONTROL arm keep a fixed support
 * level, which is what the adaptive arm is measured against.
 */
export async function resolveSupport(
  clients: LearnClients,
  userId: string,
): Promise<SupportResolution> {
  const { db } = clients;

  const profile = await readRow(
    db.from("profiles").select("support_level").eq("id", userId).maybeSingle(),
    "your profile",
  );
  const current = asSupportLevel(num(profile?.support_level), 2);

  // Finished items only, newest first from the index, then reversed: the fading
  // window reads oldest first.
  const finished = await readRows(
    db
      .from("item_attempts")
      .select("unaided, outcome, max_help_level, completed_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false })
      .limit(FADE_HISTORY),
    "your recent items",
  );

  const recent: CompetenceSignal[] = finished
    .filter((row) => str(row.completed_at) !== null)
    .map((row) => ({
      unaided: row.unaided === true,
      outcome: (row.outcome as CompetenceSignal["outcome"]) ?? "skipped",
      maxHelpLevel: parseHelpLevel(row.max_help_level) ?? "none",
    }))
    .reverse();

  const fadingArm = await ensureAssignment(clients.experiments, userId, "fading");
  const decision = computeSupportLevel({ current, recent });
  const fixed = fadingArm === "control";
  const level = fixed ? current : decision.level;

  if (!fixed && level !== current) {
    await write(
      db
        .from("profiles")
        .update({ support_level: level, support_level_updated_at: new Date().toISOString() })
        .eq("id", userId),
      "your support level",
    );
  }

  return { level, policy: SUPPORT_POLICIES[level], decision, fixed };
}

// ---------------------------------------------------------------------------
// The loaded attempt
// ---------------------------------------------------------------------------

export interface LearnContext {
  clients: LearnClients;
  db: ResearchDb;
  userId: string;
  attempt: ItemAttemptRow;
  item: SecretItemRow;
  steps: StepRow[];
  /** Turns already spoken by the tutor for this item (C7). */
  tutorTurns: number;
  arm: Arm;
  /** The level stamped on the attempt at `/start`. */
  supportLevel: SupportLevel;
  /** The fading policy — what the treatment arm plays by. */
  basePolicy: SupportPolicy;
  /** The policy actually in force, after the arm adjustment (E2). */
  policy: SupportPolicy;
  /** Attempts that count towards the gate: filler is excluded (B7, X2). */
  attemptsCounted: number;
  /** Every attempt on the chain, filler included (B2). */
  attemptsRecorded: number;
  chain: AttemptRecord[];
  gate: HelpGateResult;
}

export type LoadFailure = { kind: "not_found" } | { kind: "broken"; error: unknown };
export type LoadResult = { ok: true; ctx: LearnContext } | { ok: false; failure: LoadFailure };

/**
 * Loads an attempt the caller owns, with the item (key included, server-side
 * only), the chain, and the gate. `user_id` is part of the query, so an attempt
 * id belonging to someone else reads as "not found" and never as a 403 that
 * confirms the row exists.
 */
export async function loadContext(
  userId: string,
  attemptId: string,
  options: { stuck?: boolean } = {},
): Promise<LoadResult> {
  const clients = learnClients();
  const { db } = clients;

  try {
    const attempt = asItemAttempt(
      await readRow(
        db
          .from("item_attempts")
          .select(ITEM_ATTEMPT_SELECT)
          .eq("id", attemptId)
          .eq("user_id", userId)
          .maybeSingle(),
        "that attempt",
      ),
    );
    if (!attempt) return { ok: false, failure: { kind: "not_found" } };

    const item = asSecretItem(
      await readRow(
        db.from("items").select(SECRET_ITEM_SELECT).eq("id", attempt.item_id).maybeSingle(),
        "that item",
      ),
    );
    if (!item) return { ok: false, failure: { kind: "not_found" } };

    const steps = asSteps(
      await readRows(
        db
          .from("attempt_steps")
          .select(STEP_SELECT)
          .eq("item_attempt_id", attempt.id)
          .order("step_index", { ascending: true })
          .limit(200),
        "your attempt chain",
      ),
    );

    const turns = await readRows(
      db
        .from("tutor_turns")
        .select("turn_index, role")
        .eq("item_attempt_id", attempt.id)
        .limit(200),
      "your tutor transcript",
    );
    const tutorTurns = turns.filter((row) => str(row.role) === "tutor").length;

    const arm = await attemptFirstArm(clients, userId);
    const supportLevel = asSupportLevel(attempt.support_level_at_time, 2);
    const basePolicy = SUPPORT_POLICIES[supportLevel];
    const policy = policyForArm(basePolicy, arm);

    const attemptsRecorded = attempt.attempts_count;
    const attemptsCounted = countedAttempts(attempt, steps);

    const gate = helpGate({
      attemptsMade: attemptsCounted,
      maxHelpReached: attempt.max_help_level,
      support: policy,
      mode: attempt.mode,
      stuck: options.stuck === true,
    });

    return {
      ok: true,
      ctx: {
        clients,
        db,
        userId,
        attempt,
        item,
        steps,
        tutorTurns,
        arm,
        supportLevel,
        basePolicy,
        policy,
        attemptsCounted,
        attemptsRecorded,
        chain: attemptChain(steps),
        gate,
      },
    };
  } catch (error) {
    return { ok: false, failure: { kind: "broken", error } };
  }
}

/**
 * B7 / X2 — filler attempts do not buy help.
 *
 * Every submission is kept on the chain (B2), including the empty ones, the
 * repeats and the stem echoes: the record has to be honest. But an attempt the
 * grader marked `low_effort` is not thinking, and the gate is there to buy
 * thinking, so those are subtracted before the gate reads the count. Submitting
 * "asdf" four times leaves you exactly where you started.
 */
export function countedAttempts(attempt: ItemAttemptRow, steps: StepRow[]): number {
  const filler = steps.filter(
    (step) => step.kind === "attempt" && step.outcome === "low_effort",
  ).length;
  return Math.max(0, attempt.attempts_count - filler);
}

/** The attempt chain as the tutor reads it (B2). */
export function attemptChain(steps: StepRow[]): AttemptRecord[] {
  return steps
    .filter((step) => step.kind === "attempt")
    .map((step, index) => ({
      index,
      answer: answerOf(step.student_input),
      outcome: step.outcome,
      helpLevel: step.help_level,
    }));
}

export function answerOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const answer = (input as Record<string, unknown>).answer;
    if (typeof answer === "string") return answer;
  }
  return "";
}

/** Answers already submitted, for the grader's duplicate check (B7). */
export function previousAnswers(steps: StepRow[]): string[] {
  return attemptChain(steps)
    .map((record) => record.answer)
    .filter((answer) => answer.length > 0);
}

/** The server-side item view the tutor works from. The key stays out of it. */
export function toTutorItem(item: SecretItemRow): TutorItem {
  return {
    id: item.id,
    kind: item.kind as ItemKind,
    subject: item.subject,
    topic: item.topic,
    skill: item.skill,
    difficulty: item.difficulty,
    stem: item.stem,
    worked_solution: item.worked_solution,
    common_misconceptions: item.common_misconceptions,
    rubric: item.rubric,
  };
}

/** The client-safe projection. `toPublicItem` is the only stripping point. */
export function publicItemOf(item: SecretItemRow): ReturnType<typeof toPublicItem> {
  const row: ItemRow = {
    id: item.id,
    kind: item.kind as ItemKind,
    subject: item.subject,
    topic: item.topic,
    skill: item.skill,
    difficulty: item.difficulty,
    stem: item.stem,
    distractors: item.distractors,
  };
  return toPublicItem(row);
}

// ---------------------------------------------------------------------------
// AttemptState
// ---------------------------------------------------------------------------

/**
 * The whole client-visible state of one item encounter. `attemptsMade` is the
 * COUNTED figure, so the number the student sees is the number the gate reads —
 * a filler attempt shows the gate unmoved instead of quietly not working.
 *
 * Nothing derived from `answer_key`, `rubric`, `worked_solution` or
 * `common_misconceptions` appears here. `steps[].aiOutput` carries hint text the
 * student has already been shown, which is why it is safe to return.
 */
export function buildState(ctx: LearnContext): AttemptState {
  // A finished item closes its ladder. The worked solution stays open, because
  // reading the key after you have committed is a self-check, not help (E2).
  const finished = ctx.attempt.completed_at !== null;

  return {
    attemptId: ctx.attempt.id,
    item: publicItemOf(ctx.item),
    mode: ctx.attempt.mode,
    support: ctx.policy,
    attemptsMade: ctx.attemptsCounted,
    maxHelpReached: ctx.attempt.max_help_level,
    nextHelpAvailable: finished ? null : ctx.gate.nextHelpAvailable,
    helpGateReason: finished
      ? "That item is finished. Check it against the worked solution."
      : ctx.gate.reason,
    solutionAvailable: finished || ctx.gate.solutionAvailable,
    confidenceBefore: ctx.attempt.confidence_before,
    steps: ctx.steps.map((step) => ({
      index: step.step_index,
      kind: step.kind,
      helpLevel: step.help_level,
      aiOutput: step.ai_output,
      grounded: step.grounded,
      outcome: step.outcome,
    })),
  };
}

/**
 * Rebuilds the context from the database after a write, so the state a route
 * returns is the state that was actually stored rather than a guess at it.
 */
export async function reload(ctx: LearnContext): Promise<LearnContext> {
  const result = await loadContext(ctx.userId, ctx.attempt.id);
  if (!result.ok) throw new Error("The attempt disappeared mid-request.");
  return result.ctx;
}

// ---------------------------------------------------------------------------
// Ladder helpers
// ---------------------------------------------------------------------------

/** Hint rungs taken on this item, the solution excluded (B5, G2). */
export function hintsRequested(steps: StepRow[]): number {
  return steps.filter(
    (step) =>
      (step.kind === "hint" || step.kind === "stuck") && step.help_level !== "solution",
  ).length;
}

/**
 * Unaided means no AI touched this item at all (M1): no rung of the ladder and
 * no tutor turn. `max_help_level` alone would miss a student who talked to the
 * tutor and never pressed for a hint.
 */
export function wasUnaided(attempt: ItemAttemptRow, tutorTurns: number): boolean {
  return attempt.max_help_level === "none" && tutorTurns === 0 && !attempt.solution_revealed;
}

/** True when `next` is exactly one rung above what has been reached. */
export function isSingleStep(from: HelpLevel, next: HelpLevel): boolean {
  return helpRank(next) === helpRank(from) + 1;
}

/** Milliseconds from the item appearing to the first attempt or first help (B5). */
export function thinkMsFor(attempt: ItemAttemptRow, now = Date.now()): number | null {
  if (attempt.think_ms !== null) return null;
  const started = Date.parse(attempt.started_at);
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.round(now - started));
}

export const supportLevelOf = asSupportLevel;
