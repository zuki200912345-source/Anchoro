import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ITEM_SELECT,
  asResearchAdmin,
  selectDailySet,
  toPublicItem,
  type ItemRow,
} from "@/lib/research/items";
import { ITEM_KINDS, type ItemKind, type PublicItem } from "@/lib/research/types";
import { localDate } from "@/lib/streak";

// Brain-Only mode (Feature E). A scheduled AI-free session: this route hands
// back items and nothing else. There is no hint, tutor or solution path here by
// design (E1) — the student self-checks against the key after the session ends,
// which is the completion route's job (E2).
//
// Starting a session opens one `item_attempts` row per served item. That row is
// the record of what was actually served, so the completion route grades the
// set the student was given rather than a list the client hands back. Sessions
// are deliberately short (E7): five items, a five-minute budget.

// The generated Database type predates the research migration, so this route
// describes the exact query surface it uses instead of the full generated
// client. The service-role client satisfies it structurally.
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface Query extends PromiseLike<QueryResult> {
  eq(column: string, value: string | number | boolean): Query;
  gte(column: string, value: string | number): Query;
  is(column: string, value: null): Query;
  in(column: string, values: readonly string[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  select(columns: string): Query;
}

interface Table {
  select(columns: string): Query;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): Query;
  update(values: Record<string, unknown>): Query;
}

interface Db {
  from(table: string): Table;
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

const SESSION_FIELDS =
  "id, scheduled_for, started_at, completed_at, items_total, items_correct, self_checked";

interface SessionSummary {
  id: string;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  itemsTotal: number;
  itemsCorrect: number;
  selfChecked: boolean;
}

function toSummary(row: Row): SessionSummary | null {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    scheduledFor: str(row.scheduled_for),
    startedAt: str(row.started_at),
    completedAt: str(row.completed_at),
    itemsTotal: int(row.items_total),
    itemsCorrect: int(row.items_correct),
    selfChecked: row.self_checked === true,
  };
}

/** Validated row → PublicItem through the one stripping point in items.ts. */
function toClientItem(row: Row): PublicItem | null {
  const id = str(row.id);
  const kind = str(row.kind);
  const subject = str(row.subject);
  const topic = str(row.topic);
  const skill = str(row.skill);
  const stem = str(row.stem);
  if (!id || !kind || !subject || !topic || !skill || !stem) return null;
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) return null;

  const item: ItemRow = {
    id,
    kind: kind as ItemKind,
    subject,
    topic,
    skill,
    difficulty: int(row.difficulty, 1),
    stem,
    distractors: row.distractors,
  };
  return toPublicItem(item);
}

const startSchema = z.object({
  // Kept short on purpose (E7). Three is the floor a set needs to say anything.
  size: z.number().int().min(3).max(8).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to start a brain-only session." },
      { status: 401 },
    );
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = startSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A brain-only session takes between 3 and 8 items." },
      { status: 400 },
    );
  }
  const size = parsed.data.size ?? 5;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const today = localDate(profile?.timezone ?? "UTC");

  const admin = createAdminClient();
  const write = db(admin);

  // One brain-only session per day. Resuming an unfinished one is fine;
  // re-running a finished one is not, because the record it produces is the
  // unaided measure (E3).
  const existing = rows(
    await write
      .from("brain_only_sessions")
      .select(SESSION_FIELDS)
      .eq("user_id", user.id)
      .eq("scheduled_for", today)
      .order("created_at", { ascending: false })
      .limit(1),
  )
    .map(toSummary)
    .find((row): row is SessionSummary => row !== null);

  if (existing?.completedAt) {
    return NextResponse.json(
      {
        error:
          "Today's brain-only session is already finished. The next one is scheduled for tomorrow.",
      },
      { status: 409 },
    );
  }

  // Resume: the open attempts are the record of what was served, so the same
  // items come back rather than a fresh draw.
  if (existing?.startedAt) {
    const openIds = rows(
      await write
        .from("item_attempts")
        .select("item_id, started_at")
        .eq("user_id", user.id)
        .eq("mode", "brain_only")
        .is("completed_at", null)
        .gte("started_at", existing.startedAt)
        .order("started_at", { ascending: true })
        .limit(12),
    )
      .map((row) => str(row.item_id))
      .filter((id): id is string => id !== null);

    if (openIds.length > 0) {
      const served = rows(
        await write.from("items").select(ITEM_SELECT).in("id", openIds),
      )
        .map(toClientItem)
        .filter((item): item is PublicItem => item !== null);

      if (served.length > 0) {
        const ordered = openIds
          .map((id) => served.find((item) => item.id === id))
          .filter((item): item is PublicItem => item !== undefined);
        return NextResponse.json({
          sessionId: existing.id,
          scheduledFor: today,
          itemsTotal: ordered.length,
          items: ordered,
        });
      }
    }
  }

  let set;
  try {
    set = await selectDailySet(asResearchAdmin(admin), user.id, {
      size,
      targetMinutes: 5,
      today,
      // A transfer item belongs in an assisted set where the strategy can be
      // scaffolded; brain-only measures what is already solid.
      includeTransfer: false,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not read the item bank. Try again in a moment." },
      { status: 503 },
    );
  }

  const items = set.entries.map((entry) => entry.item);
  if (items.length === 0) {
    return NextResponse.json(
      {
        error:
          "No items are ready for a brain-only session yet. Work through a normal session first.",
      },
      { status: 409 },
    );
  }

  // One stamp for the session and its attempts, so the completion route can
  // pick out exactly the attempts this session opened.
  const startedAt = new Date().toISOString();
  let sessionId = existing?.id ?? null;

  if (sessionId) {
    const { error } = await write
      .from("brain_only_sessions")
      .update({ items_total: items.length, started_at: startedAt })
      .eq("id", sessionId)
      .eq("user_id", user.id);
    if (error) {
      return NextResponse.json(
        { error: "Could not open that session. Try again." },
        { status: 500 },
      );
    }
  } else {
    const inserted = await write
      .from("brain_only_sessions")
      .insert({
        user_id: user.id,
        scheduled_for: today,
        started_at: startedAt,
        items_total: items.length,
      })
      .select("id");
    if (inserted.error) {
      return NextResponse.json(
        { error: "Could not start the session. Try again." },
        { status: 500 },
      );
    }
    sessionId = str(rows(inserted)[0]?.id);
  }

  if (!sessionId) {
    return NextResponse.json(
      { error: "Could not start the session. Try again." },
      { status: 500 },
    );
  }

  const supportLevel = int(
    rows(await write.from("profiles").select("support_level").eq("id", user.id).limit(1))[0]
      ?.support_level,
    2,
  );

  const opened = await write.from("item_attempts").insert(
    items.map((item) => ({
      user_id: user.id,
      item_id: item.id,
      mode: "brain_only",
      unaided: true,
      max_help_level: "none",
      solution_revealed: false,
      support_level_at_time: supportLevel,
      started_at: startedAt,
    })),
  );
  if (opened.error) {
    return NextResponse.json(
      { error: "Could not open the items for this session. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    sessionId,
    scheduledFor: today,
    itemsTotal: items.length,
    // PublicItem only. The verified key stays server-side until the session is
    // finished and the self-check screen asks for it (I3, E2).
    items,
  });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to see your brain-only record." },
      { status: 401 },
    );
  }

  const read = db(supabase);

  const profile = rows(
    await read
      .from("profiles")
      .select("ai_free_streak, ai_free_longest")
      .eq("id", user.id)
      .limit(1),
  )[0];

  const sessions = rows(
    await read
      .from("brain_only_sessions")
      .select(SESSION_FIELDS)
      .eq("user_id", user.id)
      .order("scheduled_for", { ascending: false })
      .limit(12),
  )
    .map(toSummary)
    .filter((row): row is SessionSummary => row !== null);

  return NextResponse.json({
    aiFreeStreak: int(profile?.ai_free_streak),
    aiFreeLongest: int(profile?.ai_free_longest),
    sessions,
  });
}
