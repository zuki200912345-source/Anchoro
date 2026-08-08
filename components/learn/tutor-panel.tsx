"use client";

// Feature C — the hint-first tutor. Kestin et al. (Scientific Reports 15:17458,
// 2025, N=194 crossover RCT) got their result from a tutor that asks first and
// keeps its turns short; C8 says brevity was the fix for cognitive overload, so
// nothing here encourages long exchanges.
//
// C1 — it asks what you think first, and the panel says so before you type.
// C6 — it is constrained to ask, hint and diagnose. When it declines, the
//      refusal is shown as a refusal with its reason (I4), not smoothed over
//      into an answer that sounds confident.
// C3 — a named misconception is shown with the turn that named it.
//
// The attempt gate applies here too (B1): with nothing submitted there is
// nothing for the tutor to ask about, so the composer is replaced by the same
// kind of reason the hint ladder shows.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/math-text";

export interface TutorMessage {
  role: "student" | "tutor";
  content: string;
  refused?: boolean;
  refusalReason?: string | null;
  misconceptionTag?: string | null;
}

export function TutorPanel({
  turns,
  pending,
  gateReason,
  error,
  onSend,
}: {
  turns: TutorMessage[];
  pending: boolean;
  /** Non-null while the tutor is shut. Shown where the composer would be. */
  gateReason: string | null;
  error: string | null;
  onSend: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const blocked = pending || text.trim() === "";

  const send = () => {
    if (blocked) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <section className="plane p-5" aria-labelledby="tutor-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tutor-heading" className="font-display text-base font-extrabold">
          Tutor
        </h2>
        <Button
          type="button"
          variant="quiet"
          aria-expanded={open}
          aria-controls="tutor-body"
          onClick={() => setOpen((o) => !o)}
          className="min-h-11"
        >
          {open ? "Hide" : "Open"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate">
        It asks what you think first. It will not hand over an answer.
      </p>

      <div id="tutor-body" hidden={!open}>
        {turns.length > 0 ? (
          <ol className="mt-3 flex flex-col gap-2">
            {turns.map((turn, i) => (
              <li
                key={i}
                className={
                  turn.role === "student"
                    ? "plane-sm p-3 sm:ml-8"
                    : "plane-sm p-3 sm:mr-8"
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate">
                    {turn.role === "student" ? "You" : "Tutor"}
                  </span>
                  {turn.refused ? (
                    <span className="text-xs font-semibold text-flag">
                      Declined
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap"><MathText text={turn.content} /></p>
                {turn.refused && turn.refusalReason ? (
                  <p className="mt-2 text-xs text-slate">{turn.refusalReason}</p>
                ) : null}
                {turn.misconceptionTag ? (
                  <p className="mt-2 text-xs text-slate">
                    Named the misconception: {turn.misconceptionTag}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}

        {gateReason ? (
          <p className="plane-sm mt-3 p-3 text-sm" role="note">
            {gateReason}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <label htmlFor="tutor-input" className="text-sm">
              {turns.length === 0
                ? "What did you try, and where did it stop making sense?"
                : "Your reply"}
            </label>
            <textarea
              id="tutor-input"
              rows={3}
              value={text}
              disabled={pending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              aria-describedby="tutor-help"
              className="w-full rounded-(--radius-ctl) border border-ink bg-chalk px-3 py-2.5 text-sm text-ink placeholder:text-slate disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={send}
                disabled={blocked}
                className="min-h-11"
              >
                {pending ? "Thinking…" : "Send"}
              </Button>
              <p id="tutor-help" className="text-xs text-slate">
                Short turns work better than long ones.
              </p>
            </div>
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-flag" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
