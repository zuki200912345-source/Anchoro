import { NextResponse } from "next/server";
import { z } from "zod";
import { generateHint } from "@/lib/research/tutor";
import { attemptsRequiredFor } from "@/lib/research/support";
import { broke, fail } from "../_lib/db";
import {
  buildState,
  currentUser,
  loadContext,
  reload,
  toTutorItem,
  type LearnContext,
} from "../_lib/context";
import { markThinkMs, recordStep } from "../_lib/awards";

// POST /api/learn/solution — the worked solution, and the only route that
// returns it (B4).
//
// Two ways to reach it, and they are not the same thing:
//
//   1. During the item, once the effort bar for the support level has been met.
//      This counts: `solution_revealed` is set, the independence awards are off
//      the table (§10), and the item is marked assisted.
//   2. After the item is finished, as a self-check. Level 5 says it in its own
//      description — "Unaided. Check against the key when you finish" — and E2
//      requires it for brain-only sessions. Nothing is recorded, because reading
//      the key after you have committed is not assistance.
//
// The solution is served verbatim from the verified `worked_solution`. A model
// rewrite of a checked solution adds a hallucination surface for no gain (I3).

const bodySchema = z.object({ attemptId: z.uuid() });

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to see the worked solution.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("That request had no item on it.", 400);

  const loaded = await loadContext(user.id, parsed.data.attemptId);
  if (!loaded.ok) {
    if (loaded.failure.kind === "not_found") return fail("That item is not one of yours.", 404);
    return broke("solution", loaded.failure.error, "Could not read that item. Try again.");
  }
  const ctx = loaded.ctx;

  try {
    const solution = await generateHint({
      item: toTutorItem(ctx.item),
      answerKey: ctx.item.answer_key,
      attemptChain: ctx.chain,
      helpLevel: "solution",
      // The self-check and the gated reveal both serve the full solution, so the
      // policy passed here must allow it; the gate above is what decides whether
      // we get this far.
      supportPolicy: { ...ctx.policy, maxHelp: "solution" },
    });

    // Path 2 — finished item, self-check. No record, no penalty.
    if (ctx.attempt.completed_at !== null) {
      return NextResponse.json({
        helpLevel: "solution",
        workedSolution: solution.text,
        grounded: solution.grounded,
        selfCheck: true,
        state: buildState(ctx),
      });
    }

    // Path 1 — B4. The bar is attempts, and only attempts that were real (B7).
    if (!ctx.gate.solutionAvailable) {
      return NextResponse.json(
        { error: solutionGateReason(ctx), state: buildState(ctx) },
        { status: 403 },
      );
    }

    await markThinkMs(ctx.db, ctx.attempt);
    await recordStep(ctx.db, ctx.attempt.id, {
      kind: "hint",
      help: "solution",
      ai: solution.text,
      grounded: solution.grounded,
    });

    const fresh = await reload(ctx);
    return NextResponse.json({
      helpLevel: "solution",
      workedSolution: solution.text,
      grounded: solution.grounded,
      selfCheck: false,
      state: buildState(fresh),
    });
  } catch (error) {
    return broke("solution", error, "Could not open the worked solution. Try again.");
  }
}

function solutionGateReason(ctx: LearnContext): string {
  if (ctx.attempt.mode === "brain_only") {
    return "Brain-only session. Finish it, then check your answers against the key.";
  }
  if (ctx.policy.maxHelp !== "solution") {
    return `Support level ${ctx.policy.level} has no worked solution. ${ctx.policy.description}`;
  }
  const required = attemptsRequiredFor("solution", ctx.policy);
  const made = ctx.attemptsCounted;
  const short = required - made;
  return short === 1
    ? `The worked solution opens after ${required} attempts. One more.`
    : `The worked solution opens after ${required} attempts. You're on ${made}.`;
}
