"use client";

// Shared chrome for every puzzle screen: the think timer, the hint ladder
// with its 45-second lock, and the post-answer explanation. The session page
// owns all state; this component just renders it.

import { useEffect, useState, type ReactNode } from "react";
import { ThinkTimer } from "@/components/ui/think-timer";
import { Button } from "@/components/ui/button";
import {
  HINT_LOCK_MS,
  HINT_XP_COST,
  CATEGORY_LABELS,
  type Category,
} from "@/lib/types";

export interface PuzzleFrameProps {
  title: string;
  category: Category;
  index?: number; // 0-based slot in the session
  total?: number;
  startedAt: number;
  hintsUsed: number; // tiers consumed, 0..3
  hintTexts: string[]; // hints received so far, in tier order
  hintLoading: boolean;
  onRequestHint: () => void;
  explanation: string | null; // set after the answer is graded
  result: { correct: boolean } | null;
  children: ReactNode;
}

const TIER_ASKS: Record<number, string> = {
  1: "Ask a question",
  2: "Narrow it down",
  3: "Get the next move",
};

export function PuzzleFrame({
  title,
  category,
  index,
  total,
  startedAt,
  hintsUsed,
  hintTexts,
  hintLoading,
  onRequestHint,
  explanation,
  result,
  children,
}: PuzzleFrameProps) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            {title}
          </h1>
          <p className="text-sm text-slate">
            {CATEGORY_LABELS[category]}
            {index !== undefined && total !== undefined && (
              <>
                {" · "}
                <span className="num">
                  {index + 1}/{total}
                </span>
              </>
            )}
          </p>
        </div>
        <ThinkTimer
          startedAt={startedAt}
          durationMs={HINT_LOCK_MS}
          label="think timer, fills over 45 seconds"
        />
      </header>

      <div className="plane p-4">{children}</div>

      {result === null ? (
        <HintLadder
          startedAt={startedAt}
          hintsUsed={hintsUsed}
          hintTexts={hintTexts}
          hintLoading={hintLoading}
          onRequestHint={onRequestHint}
        />
      ) : (
        <section
          className={`plane p-4 ${result.correct ? "" : "border-flag"}`}
          aria-live="polite"
        >
          <p className="font-display text-lg font-bold">
            {result.correct ? "Solved." : "Not this time."}
          </p>
          {explanation && (
            <p className="mt-2 text-sm leading-relaxed">{explanation}</p>
          )}
        </section>
      )}
    </div>
  );
}

function HintLadder({
  startedAt,
  hintsUsed,
  hintTexts,
  hintLoading,
  onRequestHint,
}: {
  startedAt: number;
  hintsUsed: number;
  hintTexts: string[];
  hintLoading: boolean;
  onRequestHint: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - startedAt;
  const locked = elapsed < HINT_LOCK_MS;
  const progress = Math.min(1, elapsed / HINT_LOCK_MS);
  const nextTier = (hintsUsed + 1) as 1 | 2 | 3;
  const exhausted = hintsUsed >= 3;

  return (
    <section aria-label="hints" className="flex flex-col gap-2">
      {hintTexts.map((text, i) => (
        <p key={i} className="plane-sm px-3 py-2 text-sm">
          <span className="mr-2 inline-block size-2 rounded-[1px] bg-gold align-baseline" aria-hidden />
          {text}
        </p>
      ))}

      {locked ? (
        <div className="flex items-center gap-3 px-1 py-1 text-sm text-slate">
          <span
            aria-hidden
            className="inline-block size-5 rounded-full"
            style={{
              background: `conic-gradient(var(--flag) ${progress * 360}deg, var(--chalk) 0)`,
              border: "1px solid var(--ink)",
            }}
          />
          <span role="timer" aria-label="hints locked while you think">
            Think first
          </span>
        </div>
      ) : exhausted ? (
        <p className="px-1 text-sm text-slate">
          That was the last hint. The rest is on you.
        </p>
      ) : (
        <Button
          variant="secondary"
          onClick={onRequestHint}
          disabled={hintLoading}
          className="self-start"
        >
          {hintLoading ? "Thinking about it" : TIER_ASKS[nextTier]}
          <span className="num text-slate">-{HINT_XP_COST[nextTier]} xp</span>
        </Button>
      )}
    </section>
  );
}
