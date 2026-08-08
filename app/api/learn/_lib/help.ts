import "server-only";
import { generateHint } from "@/lib/research/tutor";
import type { AttemptState, HelpLevel } from "@/lib/research/types";
import { buildState, isSingleStep, reload, toTutorItem, type LearnContext } from "./context";
import { markThinkMs, raiseMaxHelp, recordStep } from "./awards";

// One rung of the help ladder, shared by `/hint` and `/stuck`.
//
// The ladder is: strategy → question → narrow → next_step → solution. This
// function serves exactly one rung above whatever has already been reached and
// never skips: the level comes from `helpGate`, which reads
// `HELP_LEVELS[reached + 1]` and nothing else. A student cannot ask for a level,
// so there is no level to tamper with.
//
// The worked solution is not served here. It has its own route and its own bar
// (B4), so `/hint` stops one rung short of it.

export type Escalation =
  | { ok: false; status: number; error: string; state: AttemptState }
  | {
      ok: true;
      helpLevel: HelpLevel;
      text: string;
      grounded: boolean;
      state: AttemptState;
    };

export async function escalate(
  ctx: LearnContext,
  kind: "hint" | "stuck",
): Promise<Escalation> {
  if (ctx.attempt.completed_at !== null) {
    return {
      ok: false,
      status: 409,
      error: "That item is finished, so the ladder is closed. Start another one.",
      state: buildState(ctx),
    };
  }

  const next = ctx.gate.nextHelpAvailable;

  // B1 — the gate. The reason is the student-facing copy from
  // `lib/research/support.ts`; it says what is missing and what opens it.
  if (next === null) {
    return {
      ok: false,
      status: 403,
      error: ctx.gate.reason ?? "No hint is available yet. Submit an attempt first.",
      state: buildState(ctx),
    };
  }

  if (next === "solution") {
    return {
      ok: false,
      status: 403,
      error: ctx.gate.solutionAvailable
        ? "You have had every hint below the worked solution. Open the solution when you want it."
        : "You have had every hint below the worked solution.",
      state: buildState(ctx),
    };
  }

  // Belt and braces on the escalation rule: one rung, in order, always.
  if (!isSingleStep(ctx.attempt.max_help_level, next)) {
    return {
      ok: false,
      status: 500,
      error: "The hint ladder lost its place. Reload the item and try again.",
      state: buildState(ctx),
    };
  }

  // B5 — a first request for help stops the thinking clock just as a first
  // submission does.
  await markThinkMs(ctx.db, ctx.attempt);

  const hint = await generateHint({
    item: toTutorItem(ctx.item),
    answerKey: ctx.item.answer_key,
    attemptChain: ctx.chain,
    helpLevel: next,
    supportPolicy: ctx.policy,
  });

  await recordStep(ctx.db, ctx.attempt.id, {
    kind,
    help: next,
    ai: hint.text,
    // B8, I4 — false means the key could not ground this and the student got a
    // generic strategy prompt instead. It is stored, not hidden.
    grounded: hint.grounded,
    elapsedMs: elapsed(ctx),
  });

  // B7 — a 'stuck' step is recorded under its own kind so it stays visible in
  // analysis, and `record_attempt_step` only advances the ladder for 'hint'.
  if (kind === "stuck") await raiseMaxHelp(ctx.db, ctx.attempt.id, next);

  const fresh = await reload(ctx);
  return {
    ok: true,
    helpLevel: next,
    text: hint.text,
    grounded: hint.grounded,
    state: buildState(fresh),
  };
}

function elapsed(ctx: LearnContext): number | null {
  const started = Date.parse(ctx.attempt.started_at);
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.round(Date.now() - started));
}
