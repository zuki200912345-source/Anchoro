"use client";

// H2 — predicted against actual, straight after grading. The comparison is
// arithmetic on two numbers the student and the grader supplied; no model
// touches it (I6).
//
// H5 — an accurate rating is called out on its own, separately from whether
// the answer was right. Being sure and wrong, and being right but unsure, are
// both worth knowing about.
//
// M5/F4 — it is a behavioural proxy and says so.

import { CALIBRATION_TOLERANCE_PP } from "@/lib/research/calibration";
import { PROXY_DISCLAIMER } from "@/lib/research/types";

export function CalibrationResult({
  predicted,
  correct,
}: {
  /** 0–100, stated before the first attempt. */
  predicted: number | null;
  correct: boolean;
}) {
  if (predicted === null) {
    return (
      <section className="plane p-5" aria-labelledby="calibration-heading">
        <h2
          id="calibration-heading"
          className="font-display text-base font-extrabold"
        >
          Predicted against actual
        </h2>
        <p className="mt-2 text-sm text-slate">
          No confidence rating went in on this one, so there is nothing to
          compare. Rate the next one before you answer.
        </p>
      </section>
    );
  }

  const actual = correct ? 100 : 0;
  const gap = predicted - actual;
  const size = Math.abs(gap);
  const calibrated = size <= CALIBRATION_TOLERANCE_PP;

  const verdict = calibrated
    ? "Your rating matched the result."
    : gap > 0
      ? "You were surer than the result."
      : "You were less sure than the result.";

  return (
    <section className="plane p-5" aria-labelledby="calibration-heading">
      <h2 id="calibration-heading" className="font-display text-base font-extrabold">
        Predicted against actual
      </h2>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div className="plane-sm p-3">
          <dt className="text-xs text-slate">You said</dt>
          <dd className="num mt-1 text-lg font-semibold">{predicted}%</dd>
        </div>
        <div className="plane-sm p-3">
          <dt className="text-xs text-slate">It was</dt>
          <dd className="mt-1 text-lg font-semibold">
            {correct ? "right" : "wrong"}
          </dd>
        </div>
        <div className="plane-sm p-3">
          <dt className="text-xs text-slate">Gap</dt>
          <dd className="num mt-1 text-lg font-semibold">{size} pts</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm">{verdict}</p>
      <p className="mt-1 text-xs text-slate">
        Calibration error is the distance between what you predicted and what
        happened, in percentage points. {PROXY_DISCLAIMER}
      </p>
    </section>
  );
}
