"use client";

// Feature I — the five required parts of feedback, verbatim from I.7:
// what was correct, where reasoning weakened, how independently it was solved,
// whether assistance was over-used, and what strategy to try next.
//
// The fixed schema is the point (I2): a rubric constrains what the model can
// say. Two honesty markers ride on top of it —
//
//   I4  a refusal is shown as a refusal, with its reason. "I'm not sure, try
//       this strategy" is a better answer than a confident wrong one.
//   I5  the counter-explanation is always one click away and always says the
//       same thing on the tin: why might this feedback be wrong? Buçinca et al.
//       2021 — the friction is the mechanism, so it is not opened by default.
//
// I1: every heading is about the work. None of them is about the student.

import type { StructuredFeedback as Feedback } from "@/lib/research/types";
import { MathText } from "@/components/math-text";

const PARTS: { key: keyof Feedback; heading: string }[] = [
  { key: "whatWasCorrect", heading: "What was correct" },
  { key: "whereReasoningWeakened", heading: "Where the reasoning weakened" },
  { key: "howIndependently", heading: "How independently it came out" },
  { key: "assistanceOveruse", heading: "Whether help was over-used" },
  { key: "nextStrategy", heading: "What to try next" },
];

export function StructuredFeedbackPanel({ feedback }: { feedback: Feedback }) {
  return (
    <section className="plane p-5" aria-labelledby="feedback-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="feedback-heading" className="font-display text-base font-extrabold">
          Feedback
        </h2>
        {!feedback.grounded ? (
          <span className="text-xs text-slate">
            Not grounded in the verified solution
          </span>
        ) : null}
      </div>

      {feedback.refused ? (
        <p className="plane-sm mt-3 p-3 text-sm">
          {feedback.refusalReason ??
            "Anchor wasn't sure enough about this one to mark it up, so it didn't guess."}
        </p>
      ) : null}

      {!feedback.grounded && !feedback.refused ? (
        <p className="mt-3 text-xs text-slate">
          This one could not be checked line by line against the verified
          solution. Read it as general advice, not as a mark.
        </p>
      ) : null}

      <dl className="mt-3 flex flex-col gap-3">
        {PARTS.map(({ key, heading }) => {
          const value = feedback[key];
          if (typeof value !== "string" || value.trim() === "") return null;
          return (
            <div key={key} className="plane-sm p-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate">
                {heading}
              </dt>
              <dd className="mt-1 text-sm whitespace-pre-wrap"><MathText text={value} /></dd>
            </div>
          );
        })}
      </dl>

      {feedback.counterExplanation ? (
        <details className="plane-sm mt-3 p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Why might this feedback be wrong?
          </summary>
          <p className="mt-2 text-sm whitespace-pre-wrap">
            <MathText text={feedback.counterExplanation} />
          </p>
          <p className="mt-2 text-xs text-slate">
            Read it before you accept the feedback above. If the counter-case
            fits your working better, the feedback is the thing that is wrong.
          </p>
        </details>
      ) : null}
    </section>
  );
}
