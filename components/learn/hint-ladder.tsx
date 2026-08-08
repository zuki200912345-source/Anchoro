"use client";

// The help ladder (B1, B3, B7). Three rules it exists to make visible:
//
//   1. No hint button exists until an attempt has been submitted. When the gate
//      is shut this renders the reason from `helpGate` where the button would
//      have been — there is no disabled button to poke at, and no query param
//      that opens it early (B1).
//   2. The ladder escalates one rung at a time, and every rung says up front
//      what it gives and what it costs (B3).
//   3. "I'm stuck" is always reachable (B7). It changes the wording of the
//      answer, never the rule.
//
// Requirements come from `attemptsRequiredFor` in lib/research/support, the
// same function the server gates on, so the two can't drift.

import { Button } from "@/components/ui/button";
import { attemptsRequiredFor } from "@/lib/research/support";
import { HELP_LEVELS, helpRank, type AttemptState, type HelpLevel } from "@/lib/research/types";
import { HINT_TIER_LABEL } from "./attempt-chain";

const TIER_GIVES: Record<Exclude<HelpLevel, "none">, string> = {
  strategy: "A general way in. Nothing specific to this problem.",
  question: "One question back, to make you commit to a step.",
  narrow: "Cuts out what the answer can't be.",
  next_step: "The single next move, and nothing past it.",
  solution: "The whole thing, worked through.",
};

/** What taking this rung costs, in the terms XP actually uses (§10). */
export function tierCost(level: HelpLevel): string {
  if (level === "solution") {
    return "Costs the item. Nothing scores for solving it after this.";
  }
  return "Costs the unaided solve. Finishing it yourself after a hint still scores.";
}

export function HintLadder({
  state,
  pending,
  stuckPending,
  onHint,
  onStuck,
}: {
  state: AttemptState;
  pending: boolean;
  stuckPending: boolean;
  onHint: () => void;
  onStuck: () => void;
}) {
  const { support } = state;
  const ceiling = helpRank(support.maxHelp);
  const reached = helpRank(state.maxHelpReached);
  // The server owns the gate. This line owns one thing: no rung can appear
  // before the attempts its own policy asks for (B1), whatever the payload
  // says. It reads the requirement from the policy rather than hard-coding
  // one, so the answer-on-demand control arm (§13 E2) still behaves as its
  // design requires.
  const offered = state.nextHelpAvailable;
  const next =
    offered && state.attemptsMade >= attemptsRequiredFor(offered, support)
      ? offered
      : null;
  const rungs = HELP_LEVELS.slice(1, ceiling + 1) as Exclude<HelpLevel, "none">[];

  return (
    <section className="plane p-5" aria-labelledby="ladder-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ladder-heading" className="font-display text-base font-extrabold">
          Hints
        </h2>
        <span className="text-xs text-slate">
          <span className="num">Level {support.level}</span> · {support.label}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate">{support.description}</p>

      {rungs.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-2">
          {rungs.map((rung) => {
            const rank = helpRank(rung);
            const taken = rank <= reached;
            const isNext = rung === next;
            const required = attemptsRequiredFor(rung, support);
            return (
              <li
                key={rung}
                className={`plane-sm p-3 ${taken ? "opacity-60" : ""}`}
                aria-current={isNext ? "step" : undefined}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {HINT_TIER_LABEL[rung]}
                  </span>
                  <span className="text-xs text-slate">
                    {taken ? (
                      "taken"
                    ) : isNext ? (
                      "next"
                    ) : (
                      <>
                        opens at <span className="num">{required}</span>{" "}
                        {required === 1 ? "attempt" : "attempts"}
                      </>
                    )}
                  </span>
                </div>
                {!taken ? (
                  <p className="mt-1 text-xs text-slate">{TIER_GIVES[rung]}</p>
                ) : null}
                {isNext ? (
                  <p className="mt-1 text-xs text-slate">{tierCost(rung)}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        {next ? (
          <Button
            type="button"
            variant="secondary"
            onClick={onHint}
            disabled={pending}
            className="min-h-11 w-full"
          >
            {pending ? "Getting the hint…" : `Show the next hint: ${HINT_TIER_LABEL[next].toLowerCase()}`}
          </Button>
        ) : (
          // B1 — where the button would be, the reason it isn't.
          <p className="plane-sm p-3 text-sm" role="note">
            {state.helpGateReason ??
              (state.attemptsMade < support.attemptsBeforeHelp
                ? "Submit an attempt first."
                : "No hint available on this one.")}
          </p>
        )}

        <Button
          type="button"
          variant="quiet"
          onClick={onStuck}
          disabled={stuckPending}
          className="min-h-11 self-start"
        >
          {stuckPending ? "Working out where you are…" : "I'm stuck"}
        </Button>
      </div>
    </section>
  );
}
