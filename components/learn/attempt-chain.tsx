"use client";

// B2 — the attempt chain, in order: every submission, and every hint that was
// taken between submissions. It stays on screen while the item is live so the
// student can see what they already tried before trying again.
//
// B8/I4 — a hint that could not be grounded against the verified solution is
// labelled as such, here, every time it appears. It is never dressed up as a
// hint about this problem.

import type { AttemptOutcome, AttemptState, HelpLevel } from "@/lib/research/types";
import { MathText } from "@/components/math-text";

type Step = AttemptState["steps"][number];

const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  correct: "correct",
  incorrect: "not correct",
  partial: "partly right",
  skipped: "skipped",
  low_effort: "too thin to count",
};

export const HINT_TIER_LABEL: Record<HelpLevel, string> = {
  none: "No help",
  strategy: "Strategy prompt",
  question: "A question back",
  narrow: "Narrowed down",
  next_step: "One next step",
  solution: "Worked solution",
};

export const UNGROUNDED_NOTE =
  "General strategy — I couldn't ground this one in the solution.";

function TickIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden fill="currentColor">
      <path d="M7.6 14.2 3.4 10l1.4-1.4 2.8 2.8 7-7L16 5.8z" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden fill="currentColor">
      <path d="M15.2 6.2 13.8 4.8 10 8.6 6.2 4.8 4.8 6.2 8.6 10l-3.8 3.8 1.4 1.4L10 11.4l3.8 3.8 1.4-1.4L11.4 10z" />
    </svg>
  );
}

function OutcomeTag({ outcome }: { outcome: AttemptOutcome }) {
  const good = outcome === "correct";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${good ? "text-ink" : "text-flag"}`}
    >
      {good ? <TickIcon /> : <CrossIcon />}
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

export function AttemptChain({
  steps,
  answers,
}: {
  steps: Step[];
  /** What the student typed, in submission order. */
  answers: string[];
}) {
  const shown = steps.filter(
    (s) => s.kind === "attempt" || s.kind === "hint" || s.kind === "stuck",
  );
  if (shown.length === 0) return null;

  let attemptSeen = 0;

  return (
    <section className="plane p-5" aria-labelledby="chain-heading">
      <h2 id="chain-heading" className="font-display text-base font-extrabold">
        What you have done so far
      </h2>

      <ol className="mt-3 flex flex-col gap-3">
        {shown.map((step) => {
          if (step.kind === "attempt") {
            const n = ++attemptSeen;
            return (
              <li key={step.index} className="plane-sm p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="num text-xs font-semibold">Attempt {n}</span>
                  {step.outcome ? <OutcomeTag outcome={step.outcome} /> : null}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">
                  <MathText text={answers[n - 1] ?? "Recorded before you came back to this one."} />
                </p>
              </li>
            );
          }

          const tier = step.helpLevel ?? "strategy";
          return (
            <li key={step.index} className="plane-sm p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  {step.kind === "stuck" ? "You said you were stuck" : "Hint"}
                </span>
                <span className="text-xs text-slate">{HINT_TIER_LABEL[tier]}</span>
              </div>
              {step.aiOutput ? (
                <p className="mt-1 text-sm whitespace-pre-wrap">{step.aiOutput}</p>
              ) : null}
              {step.grounded === false ? (
                <p className="mt-2 text-xs text-slate">{UNGROUNDED_NOTE}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
