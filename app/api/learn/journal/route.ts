import { NextResponse } from "next/server";
import { z } from "zod";
import { broke, fail, learnClients, readRow, readRows, str } from "../_lib/db";
import { currentUser } from "../_lib/context";

// POST /api/learn/journal — the error journal (N4).
//
// The student writes, in their own words, why the error happened and what they
// will do differently. That combination — self-explanation plus productive
// failure — is the mechanism; the entry is resurfaced later so recurrence of the
// same misconception can be measured.
//
// The misconception tag is copied from the attempt rather than asked for: the
// tag came from the item's own closed list (C3), and a student picking their own
// label would make recurrence unmeasurable.

const bodySchema = z.object({
  itemAttemptId: z.uuid(),
  whatWentWrong: z.string().min(1).max(2000),
  whatToDoNext: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to write in your journal.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("A journal entry needs the item and what went wrong.", 400);
  }
  const { itemAttemptId, whatWentWrong, whatToDoNext } = parsed.data;

  try {
    const { db } = learnClients();

    // Ownership check on the parent attempt: the entry carries an item id and a
    // misconception tag, so it must not be written against someone else's item.
    const attempt = await readRow(
      db
        .from("item_attempts")
        .select("id, item_id, misconception_tag")
        .eq("id", itemAttemptId)
        .eq("user_id", user.id)
        .maybeSingle(),
      "that item",
    );
    if (!attempt) return fail("That item is not one of yours.", 404);

    const inserted = await readRows(
      db
        .from("error_journal")
        .insert({
          user_id: user.id,
          item_attempt_id: itemAttemptId,
          item_id: str(attempt.item_id),
          misconception_tag: str(attempt.misconception_tag),
          what_went_wrong: whatWentWrong,
          what_to_do_next: whatToDoNext ?? null,
        })
        .select("id, created_at"),
      "your journal entry",
    );

    const row = inserted[0];
    return NextResponse.json({
      id: str(row?.id),
      createdAt: str(row?.created_at),
      misconceptionTag: str(attempt.misconception_tag),
    });
  } catch (error) {
    return broke("journal", error, "Could not save that entry. Try again.");
  }
}
