import { NextResponse } from "next/server";
import { z } from "zod";
import {
  dueReviews,
  isoDate,
  ITEM_SELECT,
  toPublicItem,
  type ItemRow,
} from "@/lib/research/items";
import { ITEM_KINDS, type ItemKind } from "@/lib/research/types";
import { broke, fail, int, learnClients, readRows, str } from "../../_lib/db";
import { currentUser } from "../../_lib/context";

// Cookie-bound and per-user: never cached.
export const dynamic = "force-dynamic";

// GET /api/learn/review/due — what has come back around today (N8, A3).
//
// Expanding intervals, scheduled by `schedule_review` when an item is closed.
// The 1–7 day window is where Adesope et al. found the largest testing effects,
// which is why a due item is a retrieval attempt and not a revision screen: the
// items come back as questions, through `/start` with mode 'review'.
//
// Items are returned as PublicItem — stem and options, no key (I3).

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to see your reviews.", 401);

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ limit: url.searchParams.get("limit") ?? undefined });
  if (!parsed.success) return fail("Ask for between 1 and 50 reviews.", 400);
  const { limit } = parsed.data;

  try {
    const clients = learnClients();
    const today = isoDate();
    const due = await dueReviews(clients.items, user.id, limit, today);

    if (due.length === 0) {
      return NextResponse.json({ today, count: 0, due: [] });
    }

    const rows = await readRows(
      clients.db
        .from("items")
        .select(ITEM_SELECT)
        .in(
          "id",
          due.map((review) => review.itemId),
        )
        .limit(limit),
      "your review items",
    );

    const byId = new Map<string, ReturnType<typeof toPublicItem>>();
    for (const row of rows) {
      const item = asItemRow(row);
      if (item) byId.set(item.id, toPublicItem(item));
    }

    const entries = due
      .map((review) => {
        const item = byId.get(review.itemId);
        return item
          ? {
              item,
              dueOn: review.dueOn,
              intervalDays: review.intervalDays,
              repetitions: review.repetitions,
              lapses: review.lapses,
              /** Days late, so the UI can say "3 days overdue" without maths. */
              daysOverdue: daysBetweenDates(review.dueOn, today),
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return NextResponse.json({ today, count: entries.length, due: entries });
  } catch (error) {
    return broke("review/due", error, "Could not read your review queue. Try again.");
  }
}

function asItemRow(row: Record<string, unknown>): ItemRow | null {
  const id = str(row.id);
  const kind = str(row.kind);
  const subject = str(row.subject);
  const topic = str(row.topic);
  const skill = str(row.skill);
  const stem = str(row.stem);
  if (!id || !kind || !subject || !topic || !skill || !stem) return null;
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) return null;
  if (row.verified === false) return null;
  return {
    id,
    kind: kind as ItemKind,
    subject,
    topic,
    skill,
    difficulty: int(row.difficulty, 5),
    stem,
    distractors: row.distractors,
  };
}

function daysBetweenDates(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
