"use client";

// N9 / C4 — explain it back. The protégé effect and self-explanation both show
// up in Bisra et al. 2018 at g=0.55, which is the largest effect in the whole
// strategy document that a student can trigger on their own.
//
// It comes after the feedback on purpose: the point is to restate the method
// without the page in front of you, not to copy it back.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PROXY_DISCLAIMER } from "@/lib/research/types";
import type { ExplainBackResult } from "./types";

export function SelfExplanation({
  topic,
  result,
  pending,
  error,
  onSubmit,
}: {
  topic: string;
  result: ExplainBackResult | null;
  pending: boolean;
  error: string | null;
  onSubmit: (explanation: string) => void;
}) {
  const [text, setText] = useState("");
  const blocked = pending || text.trim().length < 10;

  return (
    <section className="plane p-5" aria-labelledby="explain-heading">
      <h2 id="explain-heading" className="font-display text-base font-extrabold">
        Explain it back
      </h2>
      <p className="mt-1 text-sm text-slate">
        Say how you would solve a {topic} problem like this one to someone who
        has not seen it. Your own words, no notes.
      </p>

      {result ? (
        <div className="plane-sm mt-3 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate">
              Explanation
            </span>
            <span className="num text-sm font-semibold">{result.score}/100</span>
          </div>
          <p className="mt-2 text-sm whitespace-pre-wrap">{result.feedback}</p>
          <p className="mt-2 text-xs text-slate">
            Scored against a fixed rubric for whether the method is stated, in
            order, with the reason it works. {PROXY_DISCLAIMER}
          </p>
        </div>
      ) : (
        <>
          <label htmlFor="explain-text" className="sr-only">
            Your explanation
          </label>
          <textarea
            id="explain-text"
            rows={4}
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !blocked) {
                e.preventDefault();
                onSubmit(text.trim());
              }
            }}
            placeholder="First I'd… because…"
            aria-describedby="explain-help"
            className="mt-3 w-full rounded-(--radius-ctl) border border-ink bg-chalk px-3 py-2.5 text-sm text-ink placeholder:text-slate disabled:opacity-60"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => onSubmit(text.trim())}
              disabled={blocked}
              className="min-h-11"
            >
              {pending ? "Sending…" : "Send explanation"}
            </Button>
            <p id="explain-help" className="text-xs text-slate">
              Worth <span className="num">+5</span>, whether or not you solved
              it.
            </p>
          </div>
        </>
      )}

      {error ? (
        <p className="mt-3 text-sm text-flag" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
