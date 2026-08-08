import { NextResponse } from "next/server";
import { z } from "zod";
import { dueReviews, selectDailySet } from "@/lib/research/items";
import { SESSION_MODES, type SessionMode } from "@/lib/research/types";
import { broke, fail, learnClients, readRows, str } from "../_lib/db";
import { buildState, currentUser, loadContext, resolveSupport } from "../_lib/context";

// POST /api/learn/start — opens one item encounter.
//
// Creates the `item_attempts` row that every other route in this folder works
// against, resolves the fading level (D2, D4) and stamps it on the row
// (`support_level_at_time`, D6), and returns the item as a PublicItem: no
// answer key, no rubric, no worked solution, no misconception list (I3).
//
// The gate starts shut in the treatment arm. `state.helpGateReason` says why.

const bodySchema = z.object({
  mode: z.enum(SESSION_MODES).default("assisted"),
  subject: z.string().min(1).max(80).optional(),
  topic: z.string().min(1).max(160).optional(),
});

/** A page refresh should not eat the item bank, so a fresh untouched attempt in
 *  the same mode is handed back rather than replaced. */
const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to start an item.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("That request was not a valid start request. Send a mode Anchor knows.", 400);
  }
  const { mode, subject, topic } = parsed.data;

  try {
    const clients = learnClients();
    const { db } = clients;

    const resumable = await findResumable(clients, user.id, mode);
    if (resumable) {
      const resumed = await loadContext(user.id, resumable);
      if (resumed.ok) {
        return NextResponse.json({ attemptId: resumable, state: buildState(resumed.ctx) });
      }
    }

    const support = await resolveSupport(clients, user.id);
    const picked = await pickItem(clients, user.id, mode, subject, topic);
    if (!picked.itemId) return fail(picked.reason, 404);

    const inserted = await readRows(
      db
        .from("item_attempts")
        .insert({
          user_id: user.id,
          item_id: picked.itemId,
          mode,
          support_level_at_time: support.level,
        })
        .select("id"),
      "the new attempt",
    );
    const attemptId = str(inserted[0]?.id);
    if (!attemptId) return fail("Could not open that item. Try again.", 500);

    const loaded = await loadContext(user.id, attemptId);
    if (!loaded.ok) return fail("Could not open that item. Try again.", 500);

    return NextResponse.json({ attemptId, state: buildState(loaded.ctx) });
  } catch (error) {
    return broke("start", error, "Could not start that item. Try again in a moment.");
  }
}

type Clients = ReturnType<typeof learnClients>;

async function findResumable(
  clients: Clients,
  userId: string,
  mode: SessionMode,
): Promise<string | null> {
  const since = new Date(Date.now() - RESUME_WINDOW_MS).toISOString();
  const rows = await readRows(
    clients.db
      .from("item_attempts")
      .select("id, attempts_count, max_help_level, started_at")
      .eq("user_id", userId)
      .eq("mode", mode)
      .is("completed_at", null)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(1),
    "your open items",
  );
  const row = rows[0];
  if (!row) return null;
  const untouched = row.attempts_count === 0 && (row.max_help_level ?? "none") === "none";
  return untouched ? str(row.id) : null;
}

interface Pick {
  itemId: string | null;
  reason: string;
}

/**
 * A1/N7/N8/N6 all live in `lib/research/items.ts`; this only says which slice of
 * the day's set the requested mode wants.
 */
async function pickItem(
  clients: Clients,
  userId: string,
  mode: SessionMode,
  subject?: string,
  topic?: string,
): Promise<Pick> {
  if (mode === "review") {
    const due = await dueReviews(clients.items, userId, 1);
    return {
      itemId: due[0]?.itemId ?? null,
      reason: "Nothing is due for review today. Come back when something falls due.",
    };
  }

  const set = await selectDailySet(clients.items, userId, {
    subject,
    topic,
    includeTransfer: mode !== "brain_only",
  });

  if (mode === "transfer") {
    const entry = set.entries.find((candidate) => candidate.source === "transfer");
    return {
      itemId: entry?.item.id ?? null,
      reason:
        "No transfer item is ready. Transfer items need a skill you have already worked on, so do a normal set first.",
    };
  }

  return {
    itemId: set.entries[0]?.item.id ?? null,
    reason: subject
      ? `Nothing left in ${subject} for you right now. Try another subject or come back tomorrow.`
      : "Nothing left in the item bank for you right now. Come back tomorrow for your reviews.",
  };
}
