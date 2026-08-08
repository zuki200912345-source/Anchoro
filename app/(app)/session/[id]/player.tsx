"use client";

// The session player. Owns per-puzzle clocks, hint state, grading round
// trips, and slot advancing. Puzzle components stay pure per PuzzleProps.

import { useCallback, useEffect, useRef, useState } from "react";
import { PuzzleFrame } from "@/components/puzzle/frame";
import { BlockFitPuzzle } from "@/components/puzzle/blockfit";
import { RuleShiftPuzzle } from "@/components/puzzle/ruleshift";
import { RecallPuzzle } from "@/components/puzzle/recall";
import { MentalMathPuzzle } from "@/components/puzzle/mentalmath";
import { SessionRecap } from "@/components/session/recap";
import { Button } from "@/components/ui/button";
import {
  PUZZLE_LABELS,
  type GradeResult,
  type PuzzleInstance,
  type PuzzleType,
  type SessionSlot,
} from "@/lib/types";

const COMPONENTS: Record<
  PuzzleType,
  (props: import("@/lib/types").PuzzleProps) => React.ReactNode
> = {
  blockfit: BlockFitPuzzle,
  ruleshift: RuleShiftPuzzle,
  recall: RecallPuzzle,
  mentalmath: MentalMathPuzzle,
};

interface SessionPayload {
  session: { id: string; type: string; status: string };
  slots: SessionSlot[];
  puzzles: PuzzleInstance[];
  attempts: { slotIndex: number; correct: boolean }[];
}

type Stage =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "intro"; payload: SessionPayload }
  | { kind: "puzzle"; payload: SessionPayload; slotIndex: number }
  | { kind: "recap" };

export function SessionPlayer({ sessionId }: { sessionId: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [startedAt, setStartedAt] = useState(Date.now());
  const [hintTexts, setHintTexts] = useState<string[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [gradeState, setGradeState] = useState<{
    result: { correct: boolean } | null;
    explanation: string | null;
  }>({ result: null, explanation: null });
  const grading = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/session/${sessionId}`);
      const d: SessionPayload & { error?: string } = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not load the session.");
      if (d.session.status === "complete") {
        setStage({ kind: "recap" });
        return;
      }
      setStage({ kind: "intro", payload: d });
    } catch (e) {
      setStage({
        kind: "error",
        message:
          e instanceof Error ? e.message : "Could not load the session.",
      });
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // Intro: deal the five slots in, then start the first unanswered puzzle.
  useEffect(() => {
    if (stage.kind !== "intro") return;
    const t = setTimeout(() => {
      const done = new Set(stage.payload.attempts.map((a) => a.slotIndex));
      const next = stage.payload.slots.findIndex((_, i) => !done.has(i));
      if (next === -1) {
        setStage({ kind: "recap" });
      } else {
        beginSlot(stage.payload, next);
      }
    }, 5 * 40 + 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.kind]);

  const beginSlot = (payload: SessionPayload, slotIndex: number) => {
    setHintTexts([]);
    setGradeState({ result: null, explanation: null });
    setStartedAt(Date.now());
    grading.current = false;
    setStage({ kind: "puzzle", payload, slotIndex });
  };

  const onRequestHint = useCallback(async () => {
    if (stage.kind !== "puzzle" || hintLoading) return;
    const slot = stage.payload.slots[stage.slotIndex];
    const tier = hintTexts.length + 1;
    if (tier > 3) return;
    setHintLoading(true);
    try {
      const r = await fetch("/api/hint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, seed: slot.seed, tier }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No hint right now.");
      setHintTexts((h) => [...h, d.hint]);
    } catch (e) {
      setHintTexts((h) => [
        ...h,
        e instanceof Error ? e.message : "No hint right now. Keep going.",
      ]);
    } finally {
      setHintLoading(false);
    }
  }, [stage, hintTexts.length, hintLoading, sessionId]);

  const onHintRequest = useCallback(
    async (tier: 1 | 2 | 3): Promise<string> => {
      void tier; // the ladder is strictly sequential; the page owns tiers
      await onRequestHint();
      return "";
    },
    [onRequestHint],
  );

  const onGrade = useCallback(
    async (answer: unknown): Promise<GradeResult> => {
      if (stage.kind !== "puzzle") throw new Error("No active puzzle.");
      if (grading.current) throw new Error("Already checking that one.");
      grading.current = true;
      try {
        const r = await fetch(`/api/session/${sessionId}/attempt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slotIndex: stage.slotIndex,
            answer,
            timeMs: Math.max(1, Date.now() - startedAt),
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "That didn't save.");
        setGradeState({
          result: { correct: d.correct },
          explanation: d.explanation,
        });
        return {
          correct: d.correct,
          explanation: d.explanation,
          solution: d.solution,
        };
      } catch (e) {
        grading.current = false;
        throw e;
      }
    },
    [stage, sessionId, startedAt],
  );

  const onSolve = useCallback(() => {
    if (stage.kind !== "puzzle") return;
    const { payload, slotIndex } = stage;
    const done = new Set(payload.attempts.map((a) => a.slotIndex));
    done.add(slotIndex);
    const next = payload.slots.findIndex((_, i) => !done.has(i));
    payload.attempts = [
      ...payload.attempts,
      { slotIndex, correct: gradeState.result?.correct ?? false },
    ];
    if (next === -1) {
      setStage({ kind: "recap" });
    } else {
      beginSlot(payload, next);
    }
  }, [stage, gradeState.result]);

  if (stage.kind === "loading") {
    return <div className="plane h-64 animate-pulse" aria-label="loading session" />;
  }

  if (stage.kind === "error") {
    return (
      <div className="plane p-5">
        <p className="text-sm">{stage.message}</p>
        <Button variant="secondary" onClick={load} className="mt-3">
          Try again
        </Button>
      </div>
    );
  }

  if (stage.kind === "recap") {
    return <SessionRecap sessionId={sessionId} />;
  }

  if (stage.kind === "intro") {
    const done = new Set(stage.payload.attempts.map((a) => a.slotIndex));
    return (
      <div className="flex flex-col gap-3" aria-label="today's puzzles">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          {stage.payload.session.type === "daily"
            ? "Today's five."
            : stage.payload.session.type === "practice"
              ? "Practice five."
              : "The challenge."}
        </h1>
        {stage.payload.slots.map((slot, i) => (
          <div
            key={i}
            className="plane deal-in flex items-center justify-between p-4"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="font-semibold">{PUZZLE_LABELS[slot.type]}</span>
            <span className="num text-sm text-slate">
              d{slot.difficulty}
              {done.has(i) ? " · done" : ""}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const slot = stage.payload.slots[stage.slotIndex];
  const puzzle = stage.payload.puzzles[stage.slotIndex];
  const Component = COMPONENTS[slot.type];

  return (
    <PuzzleFrame
      title={PUZZLE_LABELS[slot.type]}
      category={slot.category}
      index={stage.slotIndex}
      total={stage.payload.slots.length}
      startedAt={startedAt}
      hintsUsed={hintTexts.length}
      hintTexts={hintTexts}
      hintLoading={hintLoading}
      onRequestHint={onRequestHint}
      explanation={gradeState.explanation}
      result={gradeState.result}
    >
      <Component
        key={`${sessionId}-${stage.slotIndex}`}
        puzzle={puzzle}
        onSolve={onSolve}
        onGrade={onGrade}
        onHintRequest={onHintRequest}
      />
    </PuzzleFrame>
  );
}
