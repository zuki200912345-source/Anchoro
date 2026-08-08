"use client";

// B4 — the worked solution. Released only after sufficient effort, and until
// then the button is visibly there, visibly shut, with the exact requirement
// on it: "Two more attempts before the full solution."
//
// Showing the locked control rather than hiding it is deliberate. The student
// should know the solution exists and what it costs to get, which is what makes
// the choice to keep going a real one.

import { Button } from "@/components/ui/button";
import { attemptsRequiredFor } from "@/lib/research/support";
import { helpRank, type AttemptState } from "@/lib/research/types";
import { countWord } from "./framing";
import { tierCost } from "./hint-ladder";
import { MathText } from "@/components/math-text";

/** The requirement line under a shut solution button. */
export function solutionRequirement(state: AttemptState): string {
  const { support } = state;
  if (helpRank(support.maxHelp) < helpRank("solution")) {
    return `No worked solution at ${support.label.toLowerCase()}. You are past that level.`;
  }
  const required = attemptsRequiredFor("solution", support);
  const deficit = Math.max(0, required - state.attemptsMade);
  if (deficit === 0) return "It opens now.";
  if (deficit === 1) return "One more attempt before the full solution.";
  return `${capitalise(countWord(deficit))} more attempts before the full solution.`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function SolutionPanel({
  state,
  solutionText,
  pending,
  selfCheck = false,
  onReveal,
}: {
  state: AttemptState;
  solutionText: string | null;
  pending: boolean;
  /** E2 — the item is over, so the key is free to look at and costs nothing. */
  selfCheck?: boolean;
  onReveal: () => void;
}) {
  if (solutionText) {
    return (
      <section className="plane p-5" aria-labelledby="solution-heading">
        <h2 id="solution-heading" className="font-display text-base font-extrabold">
          Worked solution
        </h2>
        <p className="mt-2 text-sm whitespace-pre-wrap"><MathText text={solutionText} /></p>
        <p className="mt-3 text-xs text-slate">
          Read it, then write the method back in your own words below. That part
          still scores.
        </p>
      </section>
    );
  }

  // Same rule the server gates on, read from the same policy: the solution
  // cannot appear before the attempts B4 asks for.
  const available =
    selfCheck ||
    (state.solutionAvailable &&
      state.attemptsMade >= attemptsRequiredFor("solution", state.support));

  return (
    <section className="plane p-5" aria-labelledby="solution-heading">
      <h2 id="solution-heading" className="font-display text-base font-extrabold">
        Worked solution
      </h2>
      <Button
        type="button"
        variant="secondary"
        onClick={onReveal}
        disabled={!available || pending}
        aria-describedby="solution-requirement"
        className="mt-3 min-h-11 w-full"
      >
        {pending ? "Opening it…" : "Show the worked solution"}
      </Button>
      <p id="solution-requirement" className="mt-2 text-xs text-slate">
        {selfCheck
          ? "The item is finished, so this costs nothing. Check your working against it."
          : available
            ? tierCost("solution")
            : solutionRequirement(state)}
      </p>
    </section>
  );
}
