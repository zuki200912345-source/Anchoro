import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gradeAnswer, type AnswerKey, type GradableItem } from "@/lib/research/grader";
import type { AttemptOutcome } from "@/lib/research/types";

// Finishing a brain-only session (Feature E).
//
// POST grades the whole set deterministically against the verified key — no
// model is called anywhere in this file, because the LLM never adjudicates
// correctness (I6, I3). The set graded is the set the start route opened, read
// back from `item_attempts`, so the client cannot substitute easier items into
// its own unaided record. The key and worked solution are released in the
// response only once the session is complete, which is the self-check screen
// E2 asks for.
//
// PATCH records that the student actually went through that self-check.
//
// Nothing here reads or returns a duration: E6 rewards completion and
// improvement, never speed.

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface Query extends PromiseLike<QueryResult> {
  eq(column: string, value: string | number | boolean): Query;
  neq(column: string, value: string | number | boolean): Query;
  gt(column: string, value: string | number): Query;
  gte(column: string, value: string | number): Query;
  is(column: string, value: null): Query;
  in(column: string, values: readonly string[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  select(columns: string): Query;
}

interface Table {
  select(columns: string): Query;
  update(values: Record<string, unknown>): Query;
}

interface Db {
  from(table: string): Table;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

const db = (client: object): Db => client as unknown as Db;

type Row = Record<string, unknown>;

function rows(result: QueryResult): Row[] {
  if (!Array.isArray(result.data)) return [];
  return result.data.filter(
    (row): row is Row => typeof row === "object" && row !== null,
  );
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const idSchema = z.string().uuid();

const completeSchema = z.object({
  answers: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        answer: z.string().max(2000),
      }),
    )
    .min(1)
    .max(12),
});

const selfCheckSchema = z.object({
  selfChecked: z.literal(true),
});

// ---------------------------------------------------------------------------
// Answer keys
// ---------------------------------------------------------------------------

const KEY_TYPES = ["exact", "numeric", "set", "choice", "expression", "rubric"];

/** Validates the jsonb key shape before grading. An unreadable key is skipped,
 *  never guessed at (I4: refusing beats inventing). */
function asAnswerKey(value: unknown): AnswerKey | null {
  if (typeof value !== "object" || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !KEY_TYPES.includes(type)) return null;
  return value as AnswerKey;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((entry) => typeof entry === "string" || typeof entry === "number")
    .map((entry) => String(entry));
  return out.length > 0 ? out : null;
}

/**
 * The verified key, in words the student can compare their own work against
 * (E2). Released only after the session is complete.
 */
function describeKey(key: AnswerKey, options: string[] | null): string {
  switch (key.type) {
    case "exact": {
      const alternates = (key.alternates ?? []).filter(Boolean);
      return alternates.length > 0
        ? `${key.value} (also accepted: ${alternates.join(", ")})`
        : key.value;
    }
    case "numeric": {
      const base = key.unit ? `${key.value} ${key.unit}` : String(key.value);
      return key.tolerance && key.tolerance > 0
        ? `${base} (anything within ${key.tolerance} counts)`
        : base;
    }
    case "set":
      return key.ordered
        ? `In this order: ${key.values.join(", ")}`
        : key.values.join(", ");
    case "choice":
      return options?.[key.index] ?? `Option ${key.index + 1}`;
    case "expression":
      return key.canonical;
    case "rubric": {
      const points = key.criteria
        .map((criterion) => criterion.keywords[0])
        .filter((keyword): keyword is string => Boolean(keyword));
      return points.length > 0
        ? `A full answer covers: ${points.join("; ")}`
        : "See the worked solution.";
    }
  }
}

// ---------------------------------------------------------------------------
// POST — grade the set, close the unaided record, move the AI-free streak
// ---------------------------------------------------------------------------

interface OpenAttempt {
  attemptId: string;
  itemId: string;
  /** Read back rather than assumed: an attempt that somehow took help is not
   *  recorded as unaided, whatever mode it was opened in. */
  unaided: boolean;
}

interface ItemResult {
  itemId: string;
  itemAttemptId: string;
  stem: string;
  yourAnswer: string;
  outcome: AttemptOutcome | null;
  key: string | null;
  workedSolution: string | null;
  nextReviewOn: string | null;
}

export async function POST(
  request: Request,
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
    return NextResponse.json(
      { error: "Sign in to finish a brain-only session." },
      { status: 401 },
    );
  }

  const parsed = completeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Send one answer per item, each under 2000 characters." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const write = db(admin);

  const session = rows(
    await write
      .from("brain_only_sessions")
      .select("id, user_id, started_at, completed_at, items_total, self_checked")
      .eq("id", id)
      .eq("user_id", user.id)
      .limit(1),
  )[0];

  if (!session) {
    return NextResponse.json({ error: "No such brain-only session." }, { status: 404 });
  }
  if (str(session.completed_at)) {
    return NextResponse.json(
      { error: "That session is already finished. Start today's from the brain-only page." },
      { status: 409 },
    );
  }

  const startedAt = str(session.started_at);
  if (!startedAt) {
    return NextResponse.json(
      { error: "That session was never opened. Start it again from the brain-only page." },
      { status: 409 },
    );
  }

  // The items this session actually served (B2). Grading anything else would
  // let the record be picked rather than earned.
  const open: OpenAttempt[] = rows(
    await write
      .from("item_attempts")
      .select("id, item_id, max_help_level, solution_revealed, started_at")
      .eq("user_id", user.id)
      .eq("mode", "brain_only")
      .is("completed_at", null)
      .gte("started_at", startedAt)
      .order("started_at", { ascending: true })
      .limit(12),
  )
    .map((row) => {
      const attemptId = str(row.id);
      const itemId = str(row.item_id);
      if (!attemptId || !itemId) return null;
      return {
        attemptId,
        itemId,
        unaided: str(row.max_help_level) === "none" && row.solution_revealed !== true,
      } satisfies OpenAttempt;
    })
    .filter((entry): entry is OpenAttempt => entry !== null);

  if (open.length === 0) {
    return NextResponse.json(
      { error: "That session has no open items. Start a new one from the brain-only page." },
      { status: 409 },
    );
  }

  const openByItem = new Map(open.map((entry) => [entry.itemId, entry]));

  // One answer per served item; anything else in the payload is ignored.
  const submitted = new Map<string, string>();
  for (const entry of parsed.data.answers) {
    if (!openByItem.has(entry.itemId) || submitted.has(entry.itemId)) continue;
    submitted.set(entry.itemId, entry.answer);
  }

  const itemById = new Map(
    rows(
      await write
        .from("items")
        .select("id, stem, answer_key, worked_solution, distractors, verified")
        .in(
          "id",
          open.map((entry) => entry.itemId),
        ),
    ).map((row) => [str(row.id) ?? "", row] as const),
  );

  const completedAt = new Date().toISOString();

  // Answered items in the order the student sent them, then everything they
  // left blank: blank counts as not solved, and is recorded as such.
  const sentOrder = [...submitted.keys()];
  const ordered = [
    ...open
      .filter((entry) => submitted.has(entry.itemId))
      .sort((a, b) => sentOrder.indexOf(a.itemId) - sentOrder.indexOf(b.itemId)),
    ...open.filter((entry) => !submitted.has(entry.itemId)),
  ];

  const results: ItemResult[] = [];
  let correct = 0;

  for (const entry of ordered) {
    const row = itemById.get(entry.itemId);
    const stem = str(row?.stem) ?? "";
    const options = toStringArray(row?.distractors);
    const key = row && row.verified !== false ? asAnswerKey(row.answer_key) : null;
    const answer = submitted.get(entry.itemId);

    let outcome: AttemptOutcome | null = null;
    if (answer === undefined) {
      outcome = "skipped";
    } else if (key) {
      const gradable: GradableItem = { stem, answer_key: key, distractors: options };
      outcome = gradeAnswer(gradable, answer).outcome;
      if (outcome === "correct") correct += 1;
    }

    await write
      .from("item_attempts")
      .update({
        outcome,
        unaided: entry.unaided,
        completed_at: completedAt,
      })
      .eq("id", entry.attemptId)
      .eq("user_id", user.id);

    if (answer !== undefined) {
      await write.rpc("record_attempt_step", {
        p_attempt: entry.attemptId,
        p_kind: "attempt",
        p_help: null,
        p_input: { answer },
        p_ai: null,
        p_grounded: null,
        p_confidence: null,
        p_outcome: outcome,
        p_elapsed: null,
      });
    }

    // Counts towards the daily independence figures the same way every other
    // mode does (E3, E4, M4).
    await write.rpc("roll_independence", { p_attempt: entry.attemptId });

    let nextReviewOn: string | null = null;
    if (answer !== undefined) {
      const scheduled = await write.rpc("schedule_review", {
        p_user: user.id,
        p_item: entry.itemId,
        p_correct: outcome === "correct",
      });
      nextReviewOn = str(scheduled.data);
    }

    results.push({
      itemId: entry.itemId,
      itemAttemptId: entry.attemptId,
      stem,
      yourAnswer: answer ?? "",
      outcome,
      // E2: the key is released here and only here — after the work is in.
      key: key ? describeKey(key, options) : null,
      workedSolution: str(row?.worked_solution),
      nextReviewOn,
    });
  }

  const { error: closeError } = await write
    .from("brain_only_sessions")
    .update({
      completed_at: completedAt,
      items_correct: correct,
      items_total: open.length,
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (closeError) {
    return NextResponse.json(
      { error: "Graded the set but could not close the session. Reload and check the record." },
      { status: 500 },
    );
  }

  const streak = await advanceAiFreeStreak(write, user.id, id);

  return NextResponse.json({
    sessionId: id,
    itemsTotal: open.length,
    itemsCorrect: correct,
    aiFreeStreak: streak.current,
    aiFreeLongest: streak.longest,
    results,
  });
}

/**
 * N2 / E5 — consecutive AI-free sessions.
 *
 * The run survives if no hint and no worked solution has been taken since the
 * previous brain-only session closed; otherwise it restarts at one.
 * Deterministic, and computed from the attempt record rather than trusted from
 * the client.
 */
async function advanceAiFreeStreak(
  write: Db,
  userId: string,
  currentSessionId: string,
): Promise<{ current: number; longest: number }> {
  const profile = rows(
    await write
      .from("profiles")
      .select("ai_free_streak, ai_free_longest")
      .eq("id", userId)
      .limit(1),
  )[0];
  const previousStreak = int(profile?.ai_free_streak, 0);
  const longest = int(profile?.ai_free_longest, 0);

  const priorCompleted = rows(
    await write
      .from("brain_only_sessions")
      .select("id, completed_at")
      .eq("user_id", userId)
      .order("scheduled_for", { ascending: false })
      .limit(20),
  )
    .filter((row) => str(row.id) !== currentSessionId)
    .map((row) => str(row.completed_at))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  let current = 1;
  if (priorCompleted) {
    const aided = rows(
      await write
        .from("item_attempts")
        .select("id")
        .eq("user_id", userId)
        .neq("max_help_level", "none")
        .gt("completed_at", priorCompleted)
        .limit(1),
    );
    current = aided.length > 0 ? 1 : previousStreak + 1;
  }

  const nextLongest = Math.max(longest, current);
  await write
    .from("profiles")
    .update({ ai_free_streak: current, ai_free_longest: nextLongest })
    .eq("id", userId);

  return { current, longest: nextLongest };
}

// ---------------------------------------------------------------------------
// PATCH — record that the student self-checked against the key (E2)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
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

  const parsed = selfCheckSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Send selfChecked: true once you have compared every answer." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const write = db(admin);

  const session = rows(
    await write
      .from("brain_only_sessions")
      .select("id, completed_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .limit(1),
  )[0];

  if (!session) {
    return NextResponse.json({ error: "No such brain-only session." }, { status: 404 });
  }
  if (!str(session.completed_at)) {
    return NextResponse.json(
      { error: "Finish the session before checking it against the key." },
      { status: 409 },
    );
  }

  const { error } = await write
    .from("brain_only_sessions")
    .update({ self_checked: true })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: "Could not record the self-check. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ sessionId: id, selfChecked: true });
}
