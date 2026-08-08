"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { daysBetween, localDate } from "@/lib/streak";
import type { AttemptOutcome } from "@/lib/research/types";
import { MathText } from "@/components/math-text";

// E2 — the self-check. The verified key is released here, after the work is
// in, and the student compares their own answer against it. Marking already
// happened deterministically on the server (I3, I6); this screen exists so the
// student sees the key rather than a verdict.

export interface ItemResult {
  itemId: string;
  itemAttemptId: string | null;
  stem: string;
  yourAnswer: string;
  outcome: AttemptOutcome | null;
  key: string | null;
  workedSolution: string | null;
  nextReviewOn: string | null;
}

const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  correct: "Matches the key",
  partial: "Part of it matches",
  incorrect: "Does not match",
  skipped: "Left blank",
  low_effort: "Not enough to mark",
};

/** Days until the next spaced check, or null when nothing was scheduled (N8). */
function daysUntilNextCheck(nextReviewOn: string | null): number | null {
  if (!nextReviewOn) return null;
  const today = localDate(Intl.DateTimeFormat().resolvedOptions().timeZone);
  return Math.max(0, daysBetween(today, nextReviewOn));
}

export function SelfCheck({
  sessionId,
  itemsTotal,
  itemsCorrect,
  aiFreeStreak,
  aiFreeLongest,
  results,
  onDone,
}: {
  sessionId: string;
  itemsTotal: number;
  itemsCorrect: number;
  aiFreeStreak: number;
  aiFreeLongest: number;
  results: ItemResult[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/brain-only/${sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selfChecked: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not record the self-check.");
      }
      onDone();
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof Error ? e.message : "Could not record the self-check. Try again.",
      );
    }
  };

  const record = aiFreeStreak >= aiFreeLongest && aiFreeStreak > 0;

  return (
    <section className="flex flex-col gap-4" aria-label="Self-check against the key">
      <div className="plane p-6">
        <h2 className="font-display text-2xl font-extrabold tracking-tight">
          Session done. Check it yourself.
        </h2>
        <p className="mt-2 text-slate">
          <span className="num text-ink">{itemsCorrect}</span>
          <span className="text-slate">/</span>
          <span className="num text-ink">{itemsTotal}</span> matched the verified
          key, with no help at any point.
        </p>
        <p className="mt-2 text-sm text-slate">
          AI-free run: <span className="num text-ink">{aiFreeStreak}</span>{" "}
          {aiFreeStreak === 1 ? "session" : "sessions"}
          {record ? ". That is your longest run so far." : "."}
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {results.map((result, position) => {
          const gap = daysUntilNextCheck(result.nextReviewOn);
          return (
            <li key={result.itemId} className="plane p-5">
              <p className="text-sm text-slate">
                Item <span className="num text-ink">{position + 1}</span> ·{" "}
                {result.outcome ? OUTCOME_LABEL[result.outcome] : "No key on file"}
              </p>
              <p className="mt-2 font-semibold leading-snug"><MathText text={result.stem} /></p>

              <dl className="mt-3 flex flex-col gap-3 text-sm">
                <div>
                  <dt className="font-semibold">You wrote</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate">
                    {result.yourAnswer || "Nothing"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Verified key</dt>
                  <dd className="mt-0.5 text-slate">
                    {result.key ?? "This item has no key that can be shown."}
                  </dd>
                </div>
                {result.workedSolution && (
                  <div>
                    <dt className="font-semibold">How it works</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-slate">
                      {result.workedSolution}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {gap !== null && (
                  <span className="plane-sm px-3 py-1.5 text-xs">
                    {gap === 0 ? (
                      "Next check today"
                    ) : (
                      <>
                        Next check in <span className="num">{gap}</span>{" "}
                        {gap === 1 ? "day" : "days"}
                      </>
                    )}
                  </span>
                )}
                {result.outcome !== "correct" && result.itemAttemptId && (
                  <Link
                    href={`/journal?attempt=${result.itemAttemptId}`}
                    className="text-sm font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
                  >
                    Write what went wrong
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="plane flex flex-col gap-2 p-5">
        <p className="text-sm text-slate">
          Compared every answer against its key? Say so and the session is on the
          record.
        </p>
        <Button onClick={confirm} disabled={busy} className="self-start">
          {busy ? "Recording" : "Record the self-check"}
        </Button>
        {error && (
          <p className="text-sm text-flag" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
