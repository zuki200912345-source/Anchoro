"use client";

// RuleShift player: worked examples, a test input, four candidates.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ColorGrid, PuzzleProps, RuleShiftData } from "@/lib/types";

function MiniGrid({
  grid,
  label,
  highlight,
}: {
  grid: ColorGrid;
  label?: string;
  highlight?: "chosen" | "correct" | "wrong" | null;
}) {
  const size = grid.length;
  return (
    <div
      role="img"
      aria-label={label ?? "grid"}
      className={`grid w-fit gap-px rounded-[2px] border p-0.5 ${
        highlight === "chosen"
          ? "border-ink shadow-(--shadow-plane-sm)"
          : highlight === "correct"
            ? "border-ink bg-block-3/20"
            : highlight === "wrong"
              ? "border-flag bg-flag/10"
              : "border-ink/25"
      }`}
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
    >
      {grid.flatMap((row, r) =>
        row.map((cell, c) => (
          <span
            key={`${r}-${c}`}
            className="block size-5 rounded-[1px] sm:size-6"
            style={{
              background:
                cell === 0
                  ? "var(--chalk)"
                  : `var(--block-${cell})`,
              boxShadow: cell === 0 ? "inset 0 0 0 1px rgb(22 25 15 / 0.08)" : undefined,
            }}
          />
        )),
      )}
    </div>
  );
}

function Arrow() {
  return (
    <svg
      aria-hidden
      width="20"
      height="12"
      viewBox="0 0 20 12"
      className="shrink-0 text-slate"
    >
      <path
        d="M1 6h15m0 0-4-4m4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}

export function RuleShiftPuzzle({ puzzle, onSolve, onGrade }: PuzzleProps) {
  const data = puzzle.data as RuleShiftData;
  const [choice, setChoice] = useState<number | null>(null);
  const [phase, setPhase] = useState<"play" | "grading" | "done">("play");
  const [correctChoice, setCorrectChoice] = useState<number | null>(null);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);
  const [startedAt] = useState(() => performance.now());
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (choice === null || phase !== "play") return;
    setPhase("grading");
    setError(null);
    try {
      const result = await onGrade({ choice });
      setWasCorrect(result.correct);
      const solution = result.solution as { choice?: number } | null;
      setCorrectChoice(
        typeof solution?.choice === "number" ? solution.choice : null,
      );
      setPhase("done");
      setTimeout(() => {
        onSolve({
          correct: result.correct,
          timeMs: Math.round(performance.now() - startedAt),
          hintsUsed: 0,
          attempts: 1,
          answer: { choice },
        });
      }, 1200);
    } catch {
      setPhase("play");
      setError("That didn't save. Check your connection and try again.");
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (phase !== "play") return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4) {
      setChoice(n - 1);
    } else if (e.key === "Enter" && choice !== null) {
      submit();
    }
  };

  return (
    <div className="flex flex-col gap-5" onKeyDown={onKey}>
      <section aria-label="worked examples" className="flex flex-col gap-3">
        {data.examples.map((ex, i) => (
          <div key={i} className="flex items-center gap-3">
            <MiniGrid grid={ex.input} label={`example ${i + 1} input`} />
            <Arrow />
            <MiniGrid grid={ex.output} label={`example ${i + 1} output`} />
          </div>
        ))}
      </section>

      <section aria-label="your puzzle" className="flex items-center gap-3">
        <MiniGrid grid={data.test} label="test input" />
        <Arrow />
        <span
          className="grid size-12 place-content-center rounded-[2px] border border-dashed border-slate font-display text-xl font-bold text-slate"
          aria-label="unknown output"
        >
          ?
        </span>
      </section>

      <div
        role="radiogroup"
        aria-label="candidate outputs, keys 1 to 4"
        className="grid grid-cols-2 gap-3"
      >
        {data.candidates.map((candidate, i) => {
          const highlight =
            phase === "done"
              ? i === correctChoice
                ? "correct"
                : i === choice
                  ? "wrong"
                  : null
              : choice === i
                ? "chosen"
                : null;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={choice === i}
              aria-label={`candidate ${i + 1}`}
              disabled={phase !== "play"}
              onClick={() => setChoice(i)}
              className="flex min-h-11 flex-col items-center gap-1 rounded-(--radius-ctl) p-2"
            >
              <MiniGrid grid={candidate} highlight={highlight} />
              <span className="num text-xs text-slate">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-sm text-flag">{error}</p>}

      <Button
        onClick={submit}
        disabled={choice === null || phase !== "play"}
        className="self-start"
      >
        Lock it in
      </Button>
    </div>
  );
}
