import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asResearchAdmin, type ResearchAdmin } from "@/lib/research/items";
import type { ExperimentAdminClient } from "@/lib/research/experiments";
import {
  ATTEMPT_OUTCOMES,
  HELP_LEVELS,
  SESSION_MODES,
  type AttemptOutcome,
  type HelpLevel,
  type SessionMode,
} from "@/lib/research/types";

// Database access for the /api/learn routes.
//
// `lib/database.types.ts` was hand-written before the research migration, so the
// generated client knows nothing about `items`, `item_attempts`, `attempt_steps`,
// `tutor_turns`, `reviews`, `error_journal`, `independence_daily`, or the three
// security-definer functions the engine calls. Rather than fork that file, this
// module describes the exact query surface these routes use and casts the
// service-role client to it in one place.
//
// Every table here has its client write path revoked in the migration: writes go
// through the service role, and only after the route has verified that the
// caller owns the row (see `context.ts`).

export interface DbError {
  message: string;
}

export interface DbResponse {
  data: unknown;
  error: DbError | null;
}

interface Filters<T> {
  eq(column: string, value: string | number | boolean): T;
  is(column: string, value: null): T;
  in(column: string, values: readonly string[]): T;
  lte(column: string, value: string | number): T;
  gte(column: string, value: string | number): T;
}

export interface ResearchQuery extends PromiseLike<DbResponse>, Filters<ResearchQuery> {
  order(column: string, options?: { ascending?: boolean }): ResearchQuery;
  limit(count: number): ResearchQuery;
  single(): PromiseLike<DbResponse>;
  maybeSingle(): PromiseLike<DbResponse>;
}

export interface ResearchMutation extends PromiseLike<DbResponse>, Filters<ResearchMutation> {
  select(columns?: string): ResearchQuery;
}

export interface ResearchTable {
  select(columns: string): ResearchQuery;
  insert(values: Record<string, unknown>): ResearchMutation;
  update(values: Record<string, unknown>): ResearchMutation;
  upsert(values: Record<string, unknown>, options?: Record<string, unknown>): ResearchMutation;
}

export interface ResearchDb {
  from(table: string): ResearchTable;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<DbResponse>;
}

/** The three views of one service-role client the learn routes need. */
export interface LearnClients {
  db: ResearchDb;
  /** Selection helpers in `lib/research/items.ts`. */
  items: ResearchAdmin;
  /** Arm assignment in `lib/research/experiments.ts`. */
  experiments: ExperimentAdminClient;
}

export function learnClients(): LearnClients {
  const admin = createAdminClient();
  return {
    db: admin as unknown as ResearchDb,
    items: asResearchAdmin(admin),
    experiments: admin as unknown as ExperimentAdminClient,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readRows(query: PromiseLike<DbResponse>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  if (!Array.isArray(data)) return [];
  return data.filter(isRow);
}

export async function readRow(query: PromiseLike<DbResponse>, what: string): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  if (Array.isArray(data)) return data.find(isRow) ?? null;
  return isRow(data) ? data : null;
}

export async function write(query: PromiseLike<DbResponse>, what: string): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not write ${what}: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Field readers. Every row arrives as `unknown`, so nothing is trusted.
// ---------------------------------------------------------------------------

export const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const int = (value: unknown, fallback: number): number => {
  const n = num(value);
  return n === null ? fallback : Math.round(n);
};

export const bool = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;

export const helpLevel = (value: unknown): HelpLevel | null => oneOf(HELP_LEVELS, value);
export const outcome = (value: unknown): AttemptOutcome | null => oneOf(ATTEMPT_OUTCOMES, value);
export const sessionMode = (value: unknown): SessionMode | null => oneOf(SESSION_MODES, value);

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** `item_attempts`. Column names match the migration exactly. */
export interface ItemAttemptRow {
  id: string;
  user_id: string;
  item_id: string;
  mode: SessionMode;
  confidence_before: number | null;
  confidence_after: number | null;
  outcome: AttemptOutcome | null;
  unaided: boolean;
  attempts_count: number;
  max_help_level: HelpLevel;
  solution_revealed: boolean;
  self_corrected: boolean;
  persisted_after_error: boolean;
  think_ms: number | null;
  total_ms: number | null;
  self_explanation: string | null;
  self_explanation_score: number | null;
  misconception_tag: string | null;
  xp_awarded: number;
  support_level_at_time: number | null;
  started_at: string;
  completed_at: string | null;
}

export const ITEM_ATTEMPT_SELECT =
  "id, user_id, item_id, mode, confidence_before, confidence_after, outcome, unaided, " +
  "attempts_count, max_help_level, solution_revealed, self_corrected, persisted_after_error, " +
  "think_ms, total_ms, self_explanation, self_explanation_score, misconception_tag, " +
  "xp_awarded, support_level_at_time, started_at, completed_at";

export function asItemAttempt(row: Row | null): ItemAttemptRow | null {
  if (!row) return null;
  const id = str(row.id);
  const userId = str(row.user_id);
  const itemId = str(row.item_id);
  const startedAt = str(row.started_at);
  if (!id || !userId || !itemId || !startedAt) return null;
  return {
    id,
    user_id: userId,
    item_id: itemId,
    mode: sessionMode(row.mode) ?? "assisted",
    confidence_before: num(row.confidence_before),
    confidence_after: num(row.confidence_after),
    outcome: outcome(row.outcome),
    unaided: bool(row.unaided),
    attempts_count: int(row.attempts_count, 0),
    max_help_level: helpLevel(row.max_help_level) ?? "none",
    solution_revealed: bool(row.solution_revealed),
    self_corrected: bool(row.self_corrected),
    persisted_after_error: bool(row.persisted_after_error),
    think_ms: num(row.think_ms),
    total_ms: num(row.total_ms),
    self_explanation: str(row.self_explanation),
    self_explanation_score: num(row.self_explanation_score),
    misconception_tag: str(row.misconception_tag),
    xp_awarded: int(row.xp_awarded, 0),
    support_level_at_time: num(row.support_level_at_time),
    started_at: startedAt,
    completed_at: str(row.completed_at),
  };
}

/** `attempt_steps` — the ordered attempt chain (B2). */
export interface StepRow {
  step_index: number;
  kind: string;
  help_level: HelpLevel | null;
  student_input: unknown;
  ai_output: string | null;
  grounded: boolean | null;
  outcome: AttemptOutcome | null;
  created_at: string | null;
}

export const STEP_SELECT =
  "step_index, kind, help_level, student_input, ai_output, grounded, outcome, created_at";

export function asSteps(rows: Row[]): StepRow[] {
  return rows
    .map((row) => ({
      step_index: int(row.step_index, 0),
      kind: str(row.kind) ?? "attempt",
      help_level: helpLevel(row.help_level),
      student_input: row.student_input,
      ai_output: str(row.ai_output),
      grounded: typeof row.grounded === "boolean" ? row.grounded : null,
      outcome: outcome(row.outcome),
      created_at: str(row.created_at),
    }))
    .sort((a, b) => a.step_index - b.step_index);
}

/**
 * `items`, including the columns that must never reach a client (I3). Loaded
 * only for deterministic grading and for grounding hints and feedback. The
 * client-safe projection is `toPublicItem` in `lib/research/items.ts`.
 */
export interface SecretItemRow {
  id: string;
  kind: string;
  subject: string;
  topic: string;
  skill: string;
  difficulty: number;
  stem: string;
  distractors: unknown;
  answer_key: unknown;
  rubric: unknown;
  worked_solution: string | null;
  common_misconceptions: unknown;
}

export const SECRET_ITEM_SELECT =
  "id, kind, subject, topic, skill, difficulty, stem, distractors, answer_key, rubric, " +
  "worked_solution, common_misconceptions";

export function asSecretItem(row: Row | null): SecretItemRow | null {
  if (!row) return null;
  const id = str(row.id);
  const kind = str(row.kind);
  const subject = str(row.subject);
  const topic = str(row.topic);
  const skill = str(row.skill);
  const stem = str(row.stem);
  if (!id || !kind || !subject || !topic || !skill || !stem) return null;
  return {
    id,
    kind,
    subject,
    topic,
    skill,
    difficulty: int(row.difficulty, 5),
    stem,
    distractors: row.distractors,
    answer_key: row.answer_key,
    rubric: row.rubric,
    worked_solution: str(row.worked_solution),
    common_misconceptions: row.common_misconceptions,
  };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** JSON `{ error }` with a status, per the route contract. */
export function fail(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Anything that got past validation and ownership but broke inside. The detail
 * is logged, never returned: the student gets what broke and what to try.
 */
export function broke(route: string, error: unknown, message: string): NextResponse {
  console.error(`[api/learn/${route}]`, error);
  return NextResponse.json({ error: message }, { status: 500 });
}
