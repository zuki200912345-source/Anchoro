import { NextResponse } from "next/server";
import { z } from "zod";
import { gradeAnswer, type AnswerKey, type GradableItem } from "@/lib/research/grader";
import { diagnoseAttempt } from "@/lib/research/tutor";
import { broke, fail, write } from "../_lib/db";
import {
  buildState,
  currentUser,
  loadContext,
  previousAnswers,
  reload,
  toTutorItem,
  wasUnaided,
  type LearnContext,
} from "../_lib/context";
import {
  awardXp,
  completeAttempt,
  elapsedMsSince,
  markThinkMs,
  recordStep,
  rollDerived,
  rollIndependence,
  scheduleReview,
  xpFor,
} from "../_lib/awards";

// POST /api/learn/attempt — the enforcement partner of the help gate.
//
// This is where the attempt-first rule earns its keep. Grading is deterministic
// against the verified key (I3, I6): no model is asked whether the student is
// right, here or anywhere else. The model is used afterwards, and only to name
// what the working suggests went wrong (C3, B3).
//
// Recorded on the way through: the step itself (B2), the confidence stated
// before the first submission (H1), whether the student went again after an
// error (persistence) and whether they fixed it themselves (self-correction).

const bodySchema = z.object({
  attemptId: z.uuid(),
  // Empty is allowed on purpose: an empty submission is a low-effort attempt
  // with a record, not a validation error (B7).
  answer: z.string().max(4000),
  confidence: z.number().int().min(0).max(100).optional(),
});

const KEY_TYPES = ["exact", "numeric", "set", "choice", "expression", "rubric"];

function asAnswerKey(value: unknown): AnswerKey | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && KEY_TYPES.includes(type) ? (value as AnswerKey) : null;
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to submit an attempt.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("That attempt was missing an item or an answer. Send both.", 400);
  }
  const { attemptId, answer, confidence } = parsed.data;

  const loaded = await loadContext(user.id, attemptId);
  if (!loaded.ok) {
    if (loaded.failure.kind === "not_found") return fail("That item is not one of yours.", 404);
    return broke("attempt", loaded.failure.error, "Could not read that item. Try again.");
  }
  let ctx = loaded.ctx;

  if (ctx.attempt.completed_at !== null) {
    return fail("That item is already finished. Start another one.", 409);
  }

  const key = asAnswerKey(ctx.item.answer_key);
  if (!key) {
    return fail(
      "This item has no usable answer key, so nothing can grade it. Skip it and start another.",
      422,
    );
  }

  try {
    const gradable: GradableItem = {
      stem: ctx.item.stem,
      answer_key: key,
      distractors: Array.isArray(ctx.item.distractors)
        ? (ctx.item.distractors as unknown[]).map(String)
        : null,
    };

    // H1 — the confidence rating belongs to the FIRST submission and nothing
    // after it. A rating given once the student has seen a result is not a
    // prediction, so later ratings are dropped rather than stored.
    const firstAttempt = ctx.attempt.attempts_count === 0;
    if (firstAttempt && confidence !== undefined && ctx.attempt.confidence_before === null) {
      await write(
        ctx.db
          .from("item_attempts")
          .update({ confidence_before: confidence })
          .eq("id", ctx.attempt.id)
          .is("confidence_before", null),
        "your confidence rating",
      );
      ctx.attempt.confidence_before = confidence;
    }

    await markThinkMs(ctx.db, ctx.attempt);

    // I6 — the only correctness authority in the product.
    const graded = gradeAnswer(gradable, answer, previousAnswers(ctx.steps));

    // Flags read the chain BEFORE this submission joins it.
    const priorError = ctx.chain.some(
      (record) => record.outcome === "incorrect" || record.outcome === "partial",
    );
    const persisted = ctx.attempt.persisted_after_error || priorError;
    // Kapur's self-correction: an earlier answer was wrong, this one is right,
    // and nobody handed over the solution in between.
    const selfCorrected =
      ctx.attempt.self_corrected ||
      (priorError && graded.outcome === "correct" && !ctx.attempt.solution_revealed);

    await recordStep(ctx.db, ctx.attempt.id, {
      kind: "attempt",
      input: { answer },
      outcome: graded.outcome,
      confidence: firstAttempt ? (confidence ?? null) : null,
      elapsedMs: elapsedMsSince(ctx.attempt.started_at),
    });

    if (persisted !== ctx.attempt.persisted_after_error || selfCorrected !== ctx.attempt.self_corrected) {
      await write(
        ctx.db
          .from("item_attempts")
          .update({ persisted_after_error: persisted, self_corrected: selfCorrected })
          .eq("id", ctx.attempt.id),
        "your attempt record",
      );
    }

    ctx = await reload(ctx);

    const correct = graded.outcome === "correct";
    let nextReview: string | null = null;

    if (correct) {
      // N8 — a correct answer pushes the next retrieval out on an expanding
      // interval. Scheduling happens on the answer, not on the tab closing.
      nextReview = await scheduleReview(ctx.db, ctx.userId, ctx.item.id, true);

      const unaided = wasUnaided(ctx.attempt, ctx.tutorTurns);
      const transitioned = await completeAttempt(ctx.db, ctx.attempt, {
        outcome: "correct",
        unaided,
        totalMs: elapsedMsSince(ctx.attempt.started_at),
      });
      // roll_independence returns early unless the attempt is complete, so it
      // runs exactly once — on whichever request made the transition.
      if (transitioned) {
        await rollIndependence(ctx.db, ctx.attempt.id);
        await rollDerived(ctx.db, ctx.userId, {
          review: ctx.attempt.mode === "review",
          correct: true,
        });
      }
    }

    const xp = await awardXp(
      ctx.db,
      ctx.attempt,
      xpFor({
        attempt: ctx.attempt,
        item: ctx.item,
        steps: ctx.steps,
        tutorTurns: ctx.tutorTurns,
        attemptsCounted: ctx.attemptsCounted,
        outcome: graded.outcome,
      }),
    );

    const diagnosis = await diagnose(ctx, answer, graded.outcome);

    return NextResponse.json({
      outcome: graded.outcome,
      state: buildState(ctx),
      xp,
      diagnosis,
      // The five-part structured feedback (I7) belongs to `/finish`: four of its
      // five parts are statements about the finished item, and generating them
      // mid-attempt would say how independently something was solved before it
      // had been. Mid-attempt, the model gets one job — name the slip (C3).
      feedback: null,
      nextReview,
    });
  } catch (error) {
    return broke("attempt", error, "Could not record that attempt. Try submitting it again.");
  }
}

interface AttemptFeedback {
  diagnosis: string;
  misconceptionTag: string | null;
}

/**
 * B3/C3 — the model reads the working and names what it suggests, choosing from
 * the item's own misconception list. It is not told whether the answer was
 * right; it is told what the grader already decided.
 *
 * It sits behind the same attempt bar as every other piece of AI (B1). Naming a
 * misconception is help, so a student on "lighter hints" gets it after the two
 * attempts their level asks for, not after one.
 *
 * Filler gets a fixed line and no model call: a hint dressed as a diagnosis
 * would be exactly the payoff the gate exists to remove (B7, X2).
 */
async function diagnose(
  ctx: LearnContext,
  answer: string,
  outcome: string,
): Promise<AttemptFeedback | null> {
  if (outcome === "low_effort") {
    return {
      diagnosis:
        "That reads as filler rather than an attempt, so it does not count towards a hint. Put down the part you are sure of.",
      misconceptionTag: null,
    };
  }
  if (outcome !== "incorrect" && outcome !== "partial") return null;
  if (ctx.attempt.mode === "brain_only" || ctx.policy.maxHelp === "none") return null;
  if (ctx.attemptsCounted < ctx.policy.attemptsBeforeHelp) return null;

  const result = await diagnoseAttempt({
    item: toTutorItem(ctx.item),
    answerKey: ctx.item.answer_key,
    studentAttempt: answer,
  });

  if (result.misconceptionTag && result.misconceptionTag !== ctx.attempt.misconception_tag) {
    await write(
      ctx.db
        .from("item_attempts")
        .update({ misconception_tag: result.misconceptionTag })
        .eq("id", ctx.attempt.id),
      "the misconception tag",
    );
  }

  return { diagnosis: result.diagnosis, misconceptionTag: result.misconceptionTag };
}
