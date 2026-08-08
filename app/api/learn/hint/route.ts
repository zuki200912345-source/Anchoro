import { NextResponse } from "next/server";
import { z } from "zod";
import { broke, fail } from "../_lib/db";
import { currentUser, loadContext } from "../_lib/context";
import { escalate } from "../_lib/help";

// POST /api/learn/hint — one rung up the ladder, or a 403 saying why not.
//
// B1: no hint is reachable until the attempt bar for the current support level
// has been met. The 403 carries the gate's own reason, so the student is told
// what opens it rather than being left at a dead button. There is no parameter
// on this route that changes that.
//
// §13 E2: users in the attempt-first CONTROL arm are the answer-on-demand
// comparator, so their gate is open from the first request. That is set once, in
// `policyForArm` (see `_lib/context.ts`), from the stored arm — never from
// anything in the request.
//
// B8/I4: `grounded: false` means the key could not support a hint and the
// student got a generic strategy prompt. Nothing is invented to fill the gap.

const bodySchema = z.object({ attemptId: z.uuid() });

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return fail("Sign in to ask for a hint.", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("That hint request had no item on it.", 400);

  const loaded = await loadContext(user.id, parsed.data.attemptId);
  if (!loaded.ok) {
    if (loaded.failure.kind === "not_found") return fail("That item is not one of yours.", 404);
    return broke("hint", loaded.failure.error, "Could not read that item. Try again.");
  }

  try {
    const result = await escalate(loaded.ctx, "hint");
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, state: result.state },
        { status: result.status },
      );
    }
    return NextResponse.json({
      helpLevel: result.helpLevel,
      text: result.text,
      grounded: result.grounded,
      state: result.state,
    });
  } catch (error) {
    return broke("hint", error, "Could not write that hint. Try again.");
  }
}
