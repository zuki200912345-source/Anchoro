"use client";

// Development-only harness: render any puzzle by query params without auth
// or a database. /dev/puzzle?type=blockfit&seed=abc&difficulty=5
// The matching API route 404s in production.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PuzzleFrame } from "@/components/puzzle/frame";
import { BlockFitPuzzle } from "@/components/puzzle/blockfit";
import { RuleShiftPuzzle } from "@/components/puzzle/ruleshift";
import { RecallPuzzle } from "@/components/puzzle/recall";
import { MentalMathPuzzle } from "@/components/puzzle/mentalmath";
import {
  PUZZLE_LABELS,
  type GradeResult,
  type PuzzleInstance,
  type SolveResult,
} from "@/lib/types";

const COMPONENTS = {
  blockfit: BlockFitPuzzle,
  ruleshift: RuleShiftPuzzle,
  recall: RecallPuzzle,
  mentalmath: MentalMathPuzzle,
} as const;

function DevRunner() {
  const params = useSearchParams();
  const type = (params.get("type") ?? "blockfit") as keyof typeof COMPONENTS;
  const seed = params.get("seed") ?? "dev-1";
  const difficulty = Number(params.get("difficulty") ?? 5);

  const [puzzle, setPuzzle] = useState<PuzzleInstance | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [result, setResult] = useState<{ correct: boolean } | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [solved, setSolved] = useState<SolveResult | null>(null);
  const [hints, setHints] = useState<string[]>([]);

  useEffect(() => {
    fetch(`/api/dev/puzzle?type=${type}&seed=${seed}&difficulty=${difficulty}`)
      .then((r) => r.json())
      .then((d) => {
        setPuzzle(d.puzzle);
        setStartedAt(Date.now());
      });
  }, [type, seed, difficulty]);

  const onGrade = useCallback(
    async (answer: unknown): Promise<GradeResult> => {
      const r = await fetch(`/api/dev/puzzle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, seed, difficulty, answer }),
      });
      const d = await r.json();
      setResult({ correct: d.correct });
      setExplanation(d.explanation);
      return d;
    },
    [type, seed, difficulty],
  );

  const onHintRequest = useCallback(async (tier: 1 | 2 | 3) => {
    const text = `Dev stub hint, tier ${tier}.`;
    setHints((h) => [...h, text]);
    return text;
  }, []);

  if (!puzzle) return <p className="p-6 text-sm text-slate">Loading puzzle.</p>;

  const Component = COMPONENTS[type];

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PuzzleFrame
        title={PUZZLE_LABELS[type]}
        category={puzzle.category}
        startedAt={startedAt}
        hintsUsed={hints.length}
        hintTexts={hints}
        hintLoading={false}
        onRequestHint={() => onHintRequest((hints.length + 1) as 1 | 2 | 3)}
        explanation={explanation}
        result={result}
      >
        <Component
          puzzle={puzzle}
          onSolve={setSolved}
          onGrade={onGrade}
          onHintRequest={onHintRequest}
        />
      </PuzzleFrame>
      {solved && (
        <pre className="plane-sm mt-4 overflow-x-auto p-3 text-xs">
          {JSON.stringify(solved, null, 2)}
        </pre>
      )}
    </main>
  );
}

export default function DevPuzzlePage() {
  return (
    <Suspense>
      <DevRunner />
    </Suspense>
  );
}
