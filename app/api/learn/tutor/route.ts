import { NextResponse } from "next/server";
import { z } from "zod";
import { socraticTurn, type TutorTurn } from "@/lib/research/tutor";
import { helpRank } from "@/lib/research/types";
import { broke, fail, int, readRows, str, write } from "../_lib/db";
import {
  buildState,
  currentUser,
  loadContext,
  reload,
  toTutorItem,
  type LearnContext,
} from "../_lib/context";
import { raiseMaxHelp } from "../_lib/awards";

// POST /api/learn/tutor — one turn of the Socratic dialogue (Feature C).
//
// The tutor asks what the student thinks first (C1), moves one step at a time
// (C2), names the misconception from the item's own closed list (C3), asks them
// to say it back (C4), and refuses rather than guessing when the key does not
// cover the question (C9, I4). It never hands over a solution on demand (C6) —
// that is `/solution`, with its own bar.
//
// Two accounting decisions worth stating plainly:
//
//   - The attempt bar applies here too (B1). A tutor that talks before an
//     attempt is answer-on-demand with extra steps. What does NOT apply is the
//     ladder ceiling: at "questions only" the tutor IS the help, so it keeps
//     working after the first turn.
//   - A tutor turn raises `max_help_level` to at least 'question'. Talking to
//     the tutor is assistance, so an item worked through with the tutor must not
//     be counted unaided (M1) or absent from hint reliance (G2).
//
// Refusals are stored, not swallowed: `refused` and `refusal_reason` are columns
// on `tutor_turns` so the refusal rate can be audited (I4).

const bodySchema = z.object({
  attemptId: z.uuid(),
  message: z.string().min(1).max(2000),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to talk to the tutor.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Say something to the tutor before sending.", 400);
  const { attemptId, message } = parsed.data;

  const loaded = await loadContext(user.id, attemptId);
  if (!loaded.ok) {
    if (loaded.failure.kind === "not_found") return fail("That item is not one of yours.", 404);
    return broke("tutor", loaded.failure.error, "Could not read that item. Try again.");
  }
  const ctx = loaded.ctx;

  if (ctx.attempt.completed_at !== null) {
    return fail("That item is finished, so the tutor is closed on it.", 409);
  }

  const shut = tutorGate(ctx);
  if (shut) {
    return NextResponse.json({ error: shut, state: buildState(ctx) }, { status: 403 });
  }

  try {
    const rows = await readRows(
      ctx.db
        .from("tutor_turns")
        .select("turn_index, role, content")
        .eq("item_attempt_id", ctx.attempt.id)
        .order("turn_index", { ascending: true })
        .limit(60),
      "your tutor transcript",
    );

    const transcript: TutorTurn[] = rows
      .map((row) => ({
        role: str(row.role) === "tutor" ? ("tutor" as const) : ("student" as const),
        content: str(row.content) ?? "",
      }))
      .filter((turn) => turn.content.length > 0);
    const nextIndex = rows.reduce((max, row) => Math.max(max, int(row.turn_index, 0) + 1), 0);

    const result = await socraticTurn({
      item: toTutorItem(ctx.item),
      answerKey: ctx.item.answer_key,
      transcript,
      studentMessage: message,
      supportPolicy: ctx.policy,
    });

    await write(
      ctx.db.from("tutor_turns").insert({
        item_attempt_id: ctx.attempt.id,
        turn_index: nextIndex,
        role: "student",
        content: message,
      }),
      "your message",
    );
    await write(
      ctx.db.from("tutor_turns").insert({
        item_attempt_id: ctx.attempt.id,
        turn_index: nextIndex + 1,
        role: "tutor",
        content: result.reply,
        misconception_tag: result.misconceptionTag,
        refused: result.refused,
        refusal_reason: result.refusalReason,
        // A refusal is the model declining to ground something. Recording it as
        // ungrounded is what makes the refusal rate readable later (I4).
        grounded: !result.refused,
      }),
      "the tutor's reply",
    );

    if (result.misconceptionTag && ctx.attempt.misconception_tag === null) {
      await write(
        ctx.db
          .from("item_attempts")
          .update({ misconception_tag: result.misconceptionTag })
          .eq("id", ctx.attempt.id),
        "the misconception tag",
      );
    }

    // Assistance is assistance: a turn the tutor actually gave puts this item at
    // 'question' on the ladder at minimum.
    if (!result.refused && helpRank(ctx.attempt.max_help_level) < helpRank("question")) {
      await raiseMaxHelp(ctx.db, ctx.attempt.id, "question");
    }

    const fresh = await reload(ctx);
    return NextResponse.json({
      reply: result.reply,
      misconceptionTag: result.misconceptionTag,
      refused: result.refused,
      refusalReason: result.refusalReason,
      state: buildState(fresh),
    });
  } catch (error) {
    return broke("tutor", error, "Could not send that to the tutor. Try again.");
  }
}

/**
 * B1 for the dialogue. Returns the copy for a shut gate, or null when the tutor
 * is open. In the attempt-first CONTROL arm `attemptsBeforeHelp` is 0, so this
 * never closes — that is the answer-on-demand condition (§13 E2).
 */
function tutorGate(ctx: LearnContext): string | null {
  if (ctx.attempt.mode === "brain_only") {
    return "Brain-only session. No tutor until you finish — check against the key at the end.";
  }
  if (ctx.policy.maxHelp === "none") {
    return `You're on ${ctx.policy.label.toLowerCase()}. Solve it, then check your answer against the key.`;
  }

  const required = ctx.policy.attemptsBeforeHelp;
  if (ctx.attemptsCounted >= required) return null;

  if (ctx.attemptsCounted === 0) {
    return "Submit an attempt first. The tutor starts from what you tried.";
  }
  const short = required - ctx.attemptsCounted;
  return short === 1
    ? "One more attempt before the tutor opens."
    : `${short} more attempts before the tutor opens.`;
}
