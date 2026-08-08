"use client";

// Recall player. Two modes: reproduce a flashed sequence, or n-back on a
// symbol stream. One viewing only — memory is the test.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PuzzleProps, RecallAnswer, RecallData } from "@/lib/types";

export function RecallPuzzle(props: PuzzleProps) {
  const data = props.puzzle.data as RecallData;
  return data.mode === "sequence" ? (
    <SequenceRecall {...props} data={data} />
  ) : (
    <NBackRecall {...props} data={data} />
  );
}

// ---------------------------------------------------------------------------
// Sequence mode
// ---------------------------------------------------------------------------

function SequenceRecall({
  data,
  onSolve,
  onGrade,
}: PuzzleProps & { data: Extract<RecallData, { mode: "sequence" }> }) {
  const size = data.gridSize;
  const [phase, setPhase] = useState<
    "intro" | "watch" | "answer" | "grading" | "done"
  >("intro");
  const [countdown, setCountdown] = useState(3);
  const [litIndex, setLitIndex] = useState(-1); // index into sequence during playback
  const [taps, setTaps] = useState<[number, number][]>([]);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef(performance.now());
  const submitted = useRef(false);

  // Intro countdown 3-2-1.
  useEffect(() => {
    if (phase !== "intro") return;
    if (countdown === 0) {
      setPhase("watch");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // Playback: light each sequence cell for flashMs with a 250ms gap.
  useEffect(() => {
    if (phase !== "watch") return;
    let i = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      if (i >= data.sequence.length) {
        setLitIndex(-1);
        setPhase("answer");
        startRef.current = performance.now();
        return;
      }
      setLitIndex(i);
      setTimeout(() => {
        if (cancelled) return;
        setLitIndex(-1);
        i += 1;
        setTimeout(step, 250);
      }, data.flashMs);
    };
    step();
    return () => {
      cancelled = true;
    };
  }, [phase, data.sequence.length, data.flashMs]);

  const submit = useCallback(
    async (cells: [number, number][]) => {
      if (submitted.current) return;
      submitted.current = true;
      setPhase("grading");
      const answer: RecallAnswer = { mode: "sequence", cells };
      try {
        const result = await onGrade(answer);
        setWasCorrect(result.correct);
        setPhase("done");
        setTimeout(() => {
          onSolve({
            correct: result.correct,
            timeMs: Math.round(performance.now() - startRef.current),
            hintsUsed: 0,
            attempts: 1,
            answer,
          });
        }, 1200);
      } catch {
        submitted.current = false;
        setPhase("answer");
        setError("That didn't save. Check your connection and try again.");
      }
    },
    [onGrade, onSolve],
  );

  const tapCell = (r: number, c: number) => {
    if (phase !== "answer") return;
    const next: [number, number][] = [...taps, [r, c]];
    setTaps(next);
    if (next.length === data.sequence.length) submit(next);
  };

  const tapped = new Map(taps.map(([r, c], i) => [r * 64 + c, i + 1]));
  const litCell = litIndex >= 0 ? data.sequence[litIndex] : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-slate" aria-live="polite">
        {phase === "intro" && (
          <>
            Watch the pattern.{" "}
            <span className="num text-lg text-ink">{countdown}</span>
          </>
        )}
        {phase === "watch" && "Watch."}
        {phase === "answer" && (
          <>
            Your turn. Tap the cells in order.{" "}
            <span className="num text-ink">
              {taps.length}/{data.sequence.length}
            </span>
          </>
        )}
        {phase === "grading" && "Checking."}
        {phase === "done" && (wasCorrect ? "Got it." : "Not quite.")}
      </p>

      <div
        role="grid"
        aria-label={`${size} by ${size} recall grid`}
        className="grid w-full max-w-[320px] gap-1"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      >
        {Array.from({ length: size * size }, (_, i) => {
          const r = Math.floor(i / size);
          const c = i % size;
          const isLit = litCell?.[0] === r && litCell?.[1] === c;
          const tapOrder = tapped.get(r * 64 + c);
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              aria-label={`row ${r + 1} column ${c + 1}${tapOrder ? `, tapped ${tapOrder}` : ""}`}
              disabled={phase !== "answer"}
              onClick={() => tapCell(r, c)}
              className="grid aspect-square min-h-11 place-content-center rounded-[2px] border border-ink/20"
              style={{
                background: isLit
                  ? `var(--block-${(litIndex % 6) + 1})`
                  : tapOrder
                    ? "color-mix(in srgb, var(--gold) 55%, var(--chalk))"
                    : "var(--chalk)",
              }}
            >
              {tapOrder && <span className="num text-xs">{tapOrder}</span>}
            </button>
          );
        })}
      </div>

      {phase === "answer" && taps.length > 0 && (
        <Button variant="quiet" onClick={() => setTaps((t) => t.slice(0, -1))}>
          Undo last tap
        </Button>
      )}
      {error && <p className="text-sm text-flag">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// N-back mode
// ---------------------------------------------------------------------------

function NBackRecall({
  data,
  onSolve,
  onGrade,
}: PuzzleProps & { data: Extract<RecallData, { mode: "nback" }> }) {
  const [phase, setPhase] = useState<"intro" | "stream" | "grading" | "done">(
    "intro",
  );
  const [pos, setPos] = useState(-1);
  const [flagged, setFlagged] = useState<number[]>([]);
  const [hitFlash, setHitFlash] = useState(false);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);
  const startRef = useRef(performance.now());
  const flaggedRef = useRef<number[]>([]);
  const submitted = useRef(false);

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    setPhase("grading");
    const answer: RecallAnswer = { mode: "nback", flagged: flaggedRef.current };
    try {
      const result = await onGrade(answer);
      setWasCorrect(result.correct);
      setPhase("done");
      setTimeout(() => {
        onSolve({
          correct: result.correct,
          timeMs: Math.round(performance.now() - startRef.current),
          hintsUsed: 0,
          attempts: 1,
          answer,
        });
      }, 1200);
    } catch {
      // A dropped stream cannot be replayed; grade what we have on retry.
      submitted.current = false;
      setTimeout(submit, 1500);
    }
  }, [onGrade, onSolve]);

  useEffect(() => {
    if (phase !== "stream") return;
    if (pos >= data.stream.length - 1) {
      const t = setTimeout(submit, data.stepMs);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setPos((p) => p + 1), data.stepMs);
    return () => clearTimeout(t);
  }, [phase, pos, data.stream.length, data.stepMs, submit]);

  const flag = () => {
    if (phase !== "stream" || pos < 0) return;
    if (!flaggedRef.current.includes(pos)) {
      flaggedRef.current = [...flaggedRef.current, pos];
      setFlagged(flaggedRef.current);
      setHitFlash(true);
      setTimeout(() => setHitFlash(false), 200);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        flag();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col items-center gap-5">
      {phase === "intro" ? (
        <>
          <p className="max-w-sm text-center text-sm text-slate">
            Letters will stream one at a time. Hit Match when the letter on
            screen is the same as the one{" "}
            <span className="num text-ink">{data.n}</span> back. Space bar
            works too.
          </p>
          <Button
            onClick={() => {
              setPhase("stream");
              setPos(0);
              startRef.current = performance.now();
            }}
          >
            Start the stream
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate">
            same as <span className="num text-ink">{data.n}</span> back?{" "}
            <span className="num">
              {Math.min(pos + 1, data.stream.length)}/{data.stream.length}
            </span>
          </p>
          <div
            aria-live="off"
            className="grid h-28 w-28 place-content-center rounded-(--radius-card) border border-ink bg-chalk font-display text-6xl font-extrabold"
            style={{
              color: hitFlash ? "var(--gold)" : "var(--ink)",
            }}
          >
            {phase === "stream" && pos >= 0 ? data.stream[pos] : ""}
            {phase === "grading" && <span className="text-2xl">…</span>}
            {phase === "done" && (
              <span className="text-2xl">{wasCorrect ? "yes" : "no"}</span>
            )}
          </div>
          <Button
            onClick={flag}
            disabled={phase !== "stream"}
            className="h-16 w-full max-w-xs text-lg"
            aria-label="flag a match"
          >
            Match
          </Button>
          <p className="num text-xs text-slate">
            {flagged.length} flagged
          </p>
        </>
      )}
    </div>
  );
}
