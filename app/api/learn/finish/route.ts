import { NextResponse } from "next/server";
import { z } from "zod";
import { structuredFeedback, type AttemptSummary } from "@/lib/research/tutor";
import { PROXY_DISCLAIMER, type AttemptOutcome } from "@/lib/research/types";
import { broke, fail, write } from "../_lib/db";
import {
  buildState,
  currentUser,
  hintsRequested,
  loadContext,
  reload,
  toTutorItem,
  wasUnaided,
  type LearnContext,
} from "../_lib/context";
import {
  awardSelfExplanation,
  awardXp,
  completeAttempt,
  elapsedMsSince,
  independenceContextFor,
  nextReviewDate,
  rollDerived,
  rollIndependence,
  scheduleReview,
  xpFor,
} from "../_lib/awards";

// POST /api/learn/finish — closes one item.
//
// Captures the confidence stated after the answer (H2), stores the
// self-explanation if one came with it (N9), settles the XP (§10), schedules the
// next retrieval (N8), rolls the item into the daily counters (§12), and returns
// the five-part structured feedback (I7).
//
// Idempotent by construction. An item solved on `/attempt` is already complete;
// finishing it again writes the late fields and returns the feedback without
// re-scheduling the review or double-counting the daily roll-up. The
// `completed_at is null` predicate inside `completeAttempt` is what decides.

const bodySchema = z.object({
  attemptId: z.uuid(),
  confidenceAfter: z.number().int().min(0).max(100).optional(),
  selfExplanation: z.string().min(1).max(4000).optional(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to finish an item.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("That request had no item on it.", 400);
  const { attemptId, confidenceAfter, selfExplanation } = parsed.data;

  const loaded = await loadContext(user.id, attemptId);
  if (!loaded.ok) {
    if (loaded.failure.kind === "not_found") return fail("That item is not one of yours.", 404);
    return broke("finish", loaded.failure.error, "Could not read that item. Try again.");
  }
  let ctx = loaded.ctx;

  try {
    // H2 — the rating that pairs with the one taken before the first attempt.
    if (confidenceAfter !== undefined && ctx.attempt.confidence_after === null) {
      await write(
        ctx.db
          .from("item_attempts")
          .update({ confidence_after: confidenceAfter })
          .eq("id", ctx.attempt.id)
          .is("confidence_after", null),
        "your confidence rating",
      );
      ctx.attempt.confidence_after = confidenceAfter;
    }

    // Written before the completion transition on purpose: `roll_independence`
    // counts self-explanations at the moment it runs.
    let explanationXp = 0;
    if (selfExplanation !== undefined && ctx.attempt.self_explanation === null) {
      await write(
        ctx.db
          .from("item_attempts")
          .update({ self_explanation: selfExplanation })
          .eq("id", ctx.attempt.id),
        "your explanation",
      );
      ctx.attempt.self_explanation = selfExplanation;
      explanationXp = (await awardSelfExplanation(ctx.db, ctx.attempt)).delta;
    }

    const outcome = finalOutcome(ctx);
    const unaided = wasUnaided(ctx.attempt, ctx.tutorTurns);

    const transitioned = await completeAttempt(ctx.db, ctx.attempt, {
      outcome,
      unaided,
      totalMs: elapsedMsSince(ctx.attempt.started_at),
    });

    if (transitioned) {
      // N8 — even a wrong or abandoned item comes back; a lapse pulls the
      // interval to one day rather than dropping the item.
      await scheduleReview(ctx.db, ctx.userId, ctx.item.id, outcome === "correct");
      await rollIndependence(ctx.db, ctx.attempt.id);
      await rollDerived(ctx.db, ctx.userId, {
        review: ctx.attempt.mode === "review",
        correct: outcome === "correct",
      });
    }

    ctx = await reload(ctx);

    const xp = await awardXp(
      ctx.db,
      ctx.attempt,
      xpFor({
        attempt: ctx.attempt,
        item: ctx.item,
        steps: ctx.steps,
        tutorTurns: ctx.tutorTurns,
        attemptsCounted: ctx.attemptsCounted,
        outcome,
      }),
    );

    const independence = await independenceContextFor(ctx.db, ctx.userId, ctx.supportLevel);
    const feedback = await structuredFeedback({
      item: toTutorItem(ctx.item),
      answerKey: ctx.item.answer_key,
      attempt: summarise(ctx, outcome, unaided),
      independence,
    });

    const nextReview = await nextReviewDate(ctx.db, ctx.userId, ctx.item.id);

    return NextResponse.json({
      feedback,
      xp: { ...xp, delta: xp.delta + explanationXp },
      nextReview,
      outcome,
      unaided,
      proxy: PROXY_DISCLAIMER,
      state: buildState(ctx),
    });
  } catch (error) {
    return broke("finish", error, "Could not close that item. Try again.");
  }
}

/**
 * The outcome of record. An item already closed keeps the outcome it was closed
 * with; otherwise it is the last graded submission, and an item with no genuine
 * submission at all is 'skipped' — persistence is measured by what was skipped
 * as much as by what was solved (B5, M2).
 */
function finalOutcome(ctx: LearnContext): AttemptOutcome {
  if (ctx.attempt.outcome !== null) return ctx.attempt.outcome;
  const attempts = ctx.steps.filter((step) => step.kind === "attempt");
  const last = attempts[attempts.length - 1];
  if (!last || last.outcome === null) return "skipped";
  return last.outcome;
}

function summarise(ctx: LearnContext, outcome: AttemptOutcome, unaided: boolean): AttemptSummary {
  const chain = ctx.chain;
  return {
    finalAnswer: chain.length > 0 ? chain[chain.length - 1].answer : "",
    outcome,
    attemptsMade: ctx.attemptsCounted,
    hintsRequested: hintsRequested(ctx.steps),
    maxHelpReached: ctx.attempt.max_help_level,
    solutionRevealed: ctx.attempt.solution_revealed,
    unaided,
    selfCorrected: ctx.attempt.self_corrected,
    persistedAfterError: ctx.attempt.persisted_after_error,
    thinkMs: ctx.attempt.think_ms,
    chain,
  };
}
