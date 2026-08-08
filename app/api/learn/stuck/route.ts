import { NextResponse } from "next/server";
import { z } from "zod";
import { broke, fail } from "../_lib/db";
import { currentUser, loadContext } from "../_lib/context";
import { escalate } from "../_lib/help";

// POST /api/learn/stuck — the explicit "I'm stuck" escalation (B7, B14).
//
// It does the same thing as `/hint`: one rung up, never two. What it adds is a
// label. The step is written with `kind = 'stuck'`, so an escalation the student
// asked for in those words stays distinguishable from an ordinary hint request
// in every later analysis — help-seeking timing (M2) reads very differently when
// the student said out loud that they were stuck.
//
// It does NOT open the gate. B1 has no exception, and an "I'm stuck" button that
// skipped the attempt would be the answer-on-demand tool this one is measured
// against. When the gate is shut the wording softens ("Put down what you do
// know and the hints open") and the rule does not move.

const bodySchema = z.object({ attemptId: z.uuid() });

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in first.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("That request had no item on it.", 400);

  // `stuck: true` only changes the copy on a shut gate.
  const loaded = await loadContext(user.id, parsed.data.attemptId, { stuck: true });
  if (!loaded.ok) {
    if (loaded.failure.kind === "not_found") return fail("That item is not one of yours.", 404);
    return broke("stuck", loaded.failure.error, "Could not read that item. Try again.");
  }

  try {
    const result = await escalate(loaded.ctx, "stuck");
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, state: result.state },
        { status: result.status },
      );
    }
    return NextResponse.json({
      kind: "stuck",
      helpLevel: result.helpLevel,
      text: result.text,
      grounded: result.grounded,
      state: result.state,
    });
  } catch (error) {
    return broke("stuck", error, "Could not record that escalation. Try again.");
  }
}
