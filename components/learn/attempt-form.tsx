"use client";

// The attempt box. This is the gate for everything else on the screen (B1):
// no hint, no tutor, no worked solution exists until something has been
// submitted here. The verb on the button never changes across steps.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function AttemptForm({
  attemptNumber,
  needsConfidence,
  pending,
  disabled = false,
  onSubmit,
}: {
  /** 1-based number of the attempt about to be submitted. */
  attemptNumber: number;
  /** H1 — the first attempt cannot go without a confidence rating. */
  needsConfidence: boolean;
  pending: boolean;
  disabled?: boolean;
  onSubmit: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const lastNumber = useRef(attemptNumber);

  // Clear only once the attempt has actually been recorded — the number only
  // moves on a submit the server accepted. A failed round trip keeps what the
  // student wrote.
  useEffect(() => {
    if (attemptNumber !== lastNumber.current) {
      lastNumber.current = attemptNumber;
      setAnswer("");
    }
  }, [attemptNumber]);

  const blocked = pending || disabled || needsConfidence || answer.trim() === "";

  const submit = () => {
    if (blocked) return;
    onSubmit(answer.trim());
  };

  return (
    <section className="plane p-5" aria-labelledby="attempt-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="attempt-heading" className="font-display text-base font-extrabold">
          {attemptNumber === 1 ? "Your first attempt" : "Try again"}
        </h2>
        <span className="num text-xs text-slate">attempt {attemptNumber}</span>
      </div>

      <p className="mt-1 text-sm text-slate">
        Write the answer and the step that got you there. Working counts — the
        feedback reads it.
      </p>

      <label htmlFor="attempt-answer" className="sr-only">
        Your answer and working
      </label>
      <textarea
        id="attempt-answer"
        rows={4}
        value={answer}
        disabled={pending || disabled}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        aria-describedby="attempt-help"
        placeholder="Answer, then how you got it."
        className="mt-3 w-full rounded-(--radius-ctl) border border-ink bg-chalk px-3 py-2.5 text-sm text-ink placeholder:text-slate disabled:opacity-60"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={submit}
          disabled={blocked}
          className="min-h-11"
        >
          {pending ? "Submitting…" : "Submit attempt"}
        </Button>
        <p id="attempt-help" className="text-xs text-slate">
          {needsConfidence
            ? "Rate your confidence first."
            : "Ctrl or Cmd + Enter submits."}
        </p>
      </div>
    </section>
  );
}
