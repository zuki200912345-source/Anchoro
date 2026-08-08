import { NextResponse } from "next/server";
import { z } from "zod";
import { scoreSelfExplanation, type SelfExplanationScore } from "@/lib/research/tutor";
import { PROXY_DISCLAIMER } from "@/lib/research/types";
import { broke, fail, write } from "../_lib/db";
import { buildState, currentUser, loadContext, reload, toTutorItem } from "../_lib/context";
import { awardSelfExplanation, recordStep } from "../_lib/awards";

// POST /api/learn/explain-back — teach the idea back (N9, C4).
//
// Bisra et al. 2018 put self-explanation at g=0.55, which is why this is worth
// +5 on its own (§10) and why the +5 is paid for writing the explanation rather
// than for writing a good one. The score is feedback, not a toll: a thin
// explanation still earns the XP and still gets told what was thin.
//
// Scoring is 60 points of deterministic rubric plus up to 40 the model may award
// for how well the explanation accounts for the verified route. The model is
// never asked whether the item was answered correctly (I6).
//
// This route stays open after the item is finished: explaining back once you
// have solved something is the point of the protégé effect, not a loophole.

const bodySchema = z.object({
  attemptId: z.uuid(),
  explanation: z.string().min(1).max(4000),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to write an explanation.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("Write something in the explanation box before sending it.", 400);
  }
  const { attemptId, explanation } = parsed.data;

  const loaded = await loadContext(user.id, attemptId);
  if (!loaded.ok) {
    if (loaded.failure.kind === "not_found") return fail("That item is not one of yours.", 404);
    return broke("explain-back", loaded.failure.error, "Could not read that item. Try again.");
  }
  const ctx = loaded.ctx;

  try {
    const scored = await scoreSelfExplanation({
      item: toTutorItem(ctx.item),
      answerKey: ctx.item.answer_key,
      explanation,
    });

    await recordStep(ctx.db, ctx.attempt.id, {
      kind: "explain_back",
      input: { explanation },
      ai: summarise(scored),
    });

    const first = ctx.attempt.self_explanation === null;
    await write(
      ctx.db
        .from("item_attempts")
        .update({ self_explanation: explanation, self_explanation_score: scored.score })
        .eq("id", ctx.attempt.id),
      "your explanation",
    );
    ctx.attempt.self_explanation = explanation;

    // +5, once per item. A rewrite improves the score and pays nothing extra.
    const xp = first
      ? await awardSelfExplanation(ctx.db, ctx.attempt)
      : { total: ctx.attempt.xp_awarded, lines: [], delta: 0 };

    const fresh = await reload(ctx);
    return NextResponse.json({
      score: scored.score,
      feedback: summarise(scored),
      rubric: scored.rubric,
      modelScored: scored.modelScored,
      xp,
      proxy: PROXY_DISCLAIMER,
      state: buildState(fresh),
    });
  } catch (error) {
    return broke("explain-back", error, "Could not save that explanation. Try again.");
  }
}

/**
 * One line, task-focused (I1): what the rubric gave and which line was thinnest.
 * Never a verdict on the student.
 */
function summarise(scored: SelfExplanationScore): string {
  const weakest = [...scored.rubric].sort(
    (a, b) => a.awarded / a.max - b.awarded / b.max,
  )[0];
  const full = scored.rubric.filter((line) => line.awarded === line.max);

  const head = `${scored.score} out of 100 on the explanation rubric.`;
  const strongest = full.length > 0 ? ` Full marks for: ${full[0].label.toLowerCase()}.` : "";
  const tail = weakest ? ` Thinnest line: ${weakest.label.toLowerCase()} — ${weakest.note}` : "";
  return `${head}${strongest}${tail}`;
}
