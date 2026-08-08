"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicItem } from "@/lib/research/types";
import { SelfCheck, type ItemResult } from "./self-check";
import { MathText } from "@/components/math-text";

// The brain-only session itself (E1). This component has no hint control, no
// tutor entry point and no solution button — there is nothing here to disable,
// because none of it is built. The keys arrive from the completion route once
// the set is submitted (E2).
//
// No clock is shown and no duration is sent: E6 rewards finishing and
// improving, never speed.

interface StartResponse {
  sessionId: string;
  scheduledFor: string;
  itemsTotal: number;
  items: PublicItem[];
}

interface CompleteResponse {
  itemsTotal: number;
  itemsCorrect: number;
  aiFreeStreak: number;
  aiFreeLongest: number;
  results: ItemResult[];
}

type Phase = "idle" | "working" | "checking";

const multiline = (item: PublicItem) =>
  item.kind === "reasoning" || item.kind === "transfer";

export function BrainOnlyRunner() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<PublicItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<CompleteResponse | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/brain-only", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ size: 5 }),
      });
      const data: StartResponse & { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start the session.");
      setSessionId(data.sessionId);
      setItems(data.items ?? []);
      setAnswers({});
      setIndex(0);
      setPhase("working");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the session. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!sessionId) return;
    const payload = items
      .map((item) => ({ itemId: item.id, answer: (answers[item.id] ?? "").trim() }))
      .filter((entry) => entry.answer.length > 0);

    if (payload.length === 0) {
      setError("Write an answer for at least one item before finishing.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/brain-only/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });
      const data: CompleteResponse & { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not mark the set.");
      setSummary(data);
      setPhase("checking");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark the set. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "checking" && summary && sessionId) {
    return (
      <SelfCheck
        sessionId={sessionId}
        itemsTotal={summary.itemsTotal}
        itemsCorrect={summary.itemsCorrect}
        aiFreeStreak={summary.aiFreeStreak}
        aiFreeLongest={summary.aiFreeLongest}
        results={summary.results}
        onDone={() => {
          setPhase("idle");
          setSessionId(null);
          setItems([]);
          setSummary(null);
          router.refresh();
        }}
      />
    );
  }

  if (phase === "working" && items.length > 0) {
    const item = items[index];
    const answered = items.filter((entry) => (answers[entry.id] ?? "").trim().length > 0)
      .length;
    const last = index === items.length - 1;

    return (
      <section className="plane p-6" aria-labelledby="brain-only-item">
        <p className="text-sm text-slate" aria-live="polite">
          Item <span className="num text-ink">{index + 1}</span> of{" "}
          <span className="num text-ink">{items.length}</span> ·{" "}
          <span className="num text-ink">{answered}</span> answered
        </p>

        <p className="mt-1 text-xs uppercase tracking-wide text-slate">
          {item.subject} · {item.topic}
        </p>

        <h2 id="brain-only-item" className="mt-3 text-lg font-semibold leading-snug">
          <MathText text={item.stem} />
        </h2>

        <div className="mt-4">
          {item.distractors && item.distractors.length > 0 ? (
            <fieldset>
              <legend className="sr-only">Choose your answer</legend>
              <ul className="flex flex-col gap-2">
                {item.distractors.map((option) => (
                  <li key={option}>
                    <label className="plane-sm flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name={`answer-${item.id}`}
                        value={option}
                        checked={(answers[item.id] ?? "") === option}
                        onChange={() =>
                          setAnswers((prev) => ({ ...prev, [item.id]: option }))
                        }
                        className="size-4 accent-[var(--ink)]"
                      />
                      {option}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : multiline(item) ? (
            <textarea
              id={`answer-${item.id}`}
              aria-label="Your answer"
              rows={4}
              value={answers[item.id] ?? ""}
              onChange={(event) =>
                setAnswers((prev) => ({ ...prev, [item.id]: event.target.value }))
              }
              placeholder="Your working and your answer"
              className="w-full rounded-(--radius-ctl) border border-ink bg-chalk px-3 py-2.5 text-sm text-ink placeholder:text-slate"
            />
          ) : (
            <Input
              id={`answer-${item.id}`}
              aria-label="Your answer"
              value={answers[item.id] ?? ""}
              onChange={(event) =>
                setAnswers((prev) => ({ ...prev, [item.id]: event.target.value }))
              }
              placeholder="Your answer"
            />
          )}
        </div>

        <p className="mt-3 text-xs text-slate">
          Nothing is marked until you finish. Anything left blank counts as not
          solved.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0 || busy}
          >
            Back
          </Button>
          {last ? (
            <Button onClick={finish} disabled={busy}>
              {busy ? "Finishing" : "Finish and check"}
            </Button>
          ) : (
            <Button onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}>
              Next item
            </Button>
          )}
        </div>

        {error && (
          <p className="mt-3 text-sm text-flag" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="plane p-6">
      <h2 className="font-display text-xl font-extrabold">Today&apos;s session</h2>
      <p className="mt-2 max-w-md text-slate">
        Five items, no help of any kind. You will see the verified key for every
        one of them the moment you finish, and not before.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <Button onClick={start} disabled={busy} className="self-start">
          {busy ? "Starting" : "Start brain-only session"}
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
