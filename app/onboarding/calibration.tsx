"use client";

import { useEffect, useRef, useState } from "react";
import { ThinkTimer } from "@/components/ui/think-timer";

// Three quick self-contained checks, one per category, used to seed starting
// difficulty. Fixed data, graded locally; only right/wrong leaves this file.

export interface CalibrationResults {
  pattern: boolean;
  mental_math: boolean;
  memory: boolean;
}

type Cell = [number, number];

const MATH_TIME_MS = 12_000;
const FLASH_MS = 2_000;

// Pattern: a block walks clockwise around the border, two edges at a time.
const PATTERN_SEQUENCE: Cell[][] = [[[0, 0]], [[0, 2]], [[2, 2]]];
const PATTERN_OPTIONS: Cell[][] = [
  [[0, 0]], // back to the start
  [[2, 0]], // correct
  [[1, 1]], // centre
  [[2, 1]], // one step short
];
const PATTERN_CORRECT = 1;

const MATH_PROMPT = "63 − 27 + 8";
const MATH_OPTIONS = [36, 42, 44, 46];
const MATH_CORRECT = 2;

const MEMORY_TARGET: Cell[] = [
  [0, 0],
  [0, 2],
  [1, 1],
  [2, 0],
];
const MEMORY_OPTIONS: Cell[][] = [
  [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 2],
  ],
  [
    [0, 0],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  MEMORY_TARGET, // correct
  [
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
];
const MEMORY_CORRECT = 2;

function MiniGrid({
  cells,
  fill,
  cellSize = "size-6",
}: {
  cells: Cell[];
  fill: string;
  cellSize?: string;
}) {
  const lit = new Set(cells.map(([r, c]) => r * 3 + c));
  return (
    <div aria-hidden className="grid w-fit grid-cols-3 gap-0.5">
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className={`${cellSize} rounded-[1px] ${lit.has(i) ? fill : "border border-ink/20 bg-paper"}`}
        />
      ))}
    </div>
  );
}

function GridOptions({
  options,
  fill,
  onPick,
}: {
  options: Cell[][];
  fill: string;
  onPick: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((cells, i) => (
        <button
          key={i}
          type="button"
          aria-label={`option ${i + 1}`}
          onClick={() => onPick(i)}
          className="plane-sm flex cursor-pointer justify-center p-3 hover:bg-paper active:translate-x-px active:translate-y-px"
        >
          <MiniGrid cells={cells} fill={fill} />
        </button>
      ))}
    </div>
  );
}

function PatternCheck({ onAnswer }: { onAnswer: (correct: boolean) => void }) {
  return (
    <div>
      <p className="text-sm text-slate">
        Three grids follow a rule. Pick the one that comes next.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {PATTERN_SEQUENCE.map((cells, i) => (
          <span key={i} className="flex items-center gap-2">
            <MiniGrid cells={cells} fill="bg-block-1" cellSize="size-5" />
            <span aria-hidden className="text-slate">
              →
            </span>
          </span>
        ))}
        <span className="plane-sm flex size-[68px] items-center justify-center font-display text-xl font-bold text-slate">
          ?
        </span>
      </div>
      <div className="mt-5">
        <GridOptions
          options={PATTERN_OPTIONS}
          fill="bg-block-1"
          onPick={(i) => onAnswer(i === PATTERN_CORRECT)}
        />
      </div>
    </div>
  );
}

function MathCheck({ onAnswer }: { onAnswer: (correct: boolean) => void }) {
  const [startedAt] = useState(() => Date.now());
  const answered = useRef(false);

  const answer = (correct: boolean) => {
    if (answered.current) return;
    answered.current = true;
    onAnswer(correct);
  };

  useEffect(() => {
    const t = setTimeout(() => answer(false), MATH_TIME_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <p className="text-sm text-slate">In your head, before the blocks fill.</p>
      <div className="mt-4 flex items-center justify-between">
        <p className="num font-display text-3xl font-extrabold tracking-tight">
          {MATH_PROMPT}
        </p>
        <ThinkTimer
          startedAt={startedAt}
          durationMs={MATH_TIME_MS}
          size="sm"
          label="time left"
        />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {MATH_OPTIONS.map((n, i) => (
          <button
            key={n}
            type="button"
            onClick={() => answer(i === MATH_CORRECT)}
            className="plane-sm num cursor-pointer px-4 py-3 text-lg hover:bg-paper active:translate-x-px active:translate-y-px"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function MemoryCheck({ onAnswer }: { onAnswer: (correct: boolean) => void }) {
  const [phase, setPhase] = useState<"ready" | "flash" | "pick">("ready");

  useEffect(() => {
    if (phase !== "flash") return;
    const t = setTimeout(() => setPhase("pick"), FLASH_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "ready") {
    return (
      <div>
        <p className="text-sm text-slate">
          A pattern flashes for two seconds. Then you pick it out of four.
        </p>
        <button
          type="button"
          onClick={() => setPhase("flash")}
          className="plane-sm mt-4 cursor-pointer px-4 py-3 text-sm font-semibold hover:bg-paper active:translate-x-px active:translate-y-px"
        >
          Show the pattern
        </button>
      </div>
    );
  }

  if (phase === "flash") {
    return (
      <div>
        <p className="text-sm text-slate">Memorise it.</p>
        <div className="mt-4 flex justify-center">
          <MiniGrid cells={MEMORY_TARGET} fill="bg-block-2" cellSize="size-8" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-slate">Which one did you just see?</p>
      <div className="mt-4">
        <GridOptions
          options={MEMORY_OPTIONS}
          fill="bg-block-2"
          onPick={(i) => onAnswer(i === MEMORY_CORRECT)}
        />
      </div>
    </div>
  );
}

const CHECKS = [
  { key: "pattern", label: "patterns" },
  { key: "mental_math", label: "mental maths" },
  { key: "memory", label: "memory" },
] as const;

export function Calibration({
  onDone,
}: {
  onDone: (results: CalibrationResults) => void;
}) {
  const [index, setIndex] = useState(0);
  const results = useRef<CalibrationResults>({
    pattern: false,
    mental_math: false,
    memory: false,
  });

  const record = (correct: boolean) => {
    results.current[CHECKS[index].key] = correct;
    if (index === CHECKS.length - 1) {
      onDone({ ...results.current });
    } else {
      setIndex(index + 1);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold text-slate">
        check <span className="num">{index + 1}</span> of{" "}
        <span className="num">3</span> · {CHECKS[index].label}
      </p>
      <div className="mt-3">
        {index === 0 && <PatternCheck onAnswer={record} />}
        {index === 1 && <MathCheck onAnswer={record} />}
        {index === 2 && <MemoryCheck onAnswer={record} />}
      </div>
    </div>
  );
}
