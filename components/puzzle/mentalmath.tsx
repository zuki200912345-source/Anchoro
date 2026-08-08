"use client";

// MentalMath player. Custom number pad only — the OS keyboard never opens.
// Visible countdown; at zero whatever is entered gets submitted.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MentalMathAnswer, MentalMathData, PuzzleProps } from "@/lib/types";

const OPS = ["+", "-", "×", "÷"] as const;

export function MentalMathPuzzle({ puzzle, onSolve, onGrade }: PuzzleProps) {
  const data = puzzle.data as MentalMathData;
  const [entry, setEntry] = useState("");
  const [phase, setPhase] = useState<"play" | "grading" | "done">("play");
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const [remaining, setRemaining] = useState(data.timeLimitMs);
  const [shake, setShake] = useState(false);
  const startRef = useRef(performance.now());
  const submitted = useRef(false);
  const entryRef = useRef("");
  entryRef.current = entry;

  const buildAnswer = useCallback(
    (raw: string): MentalMathAnswer => {
      switch (data.format) {
        case "target":
          return { format: "target", expression: raw };
        case "missing_op":
          return { format: "missing_op", op: (raw as "+" | "-" | "×" | "÷") || "+" };
        case "larger":
          return { format: "larger", choice: raw === "1" ? 1 : 0 };
        case "backwards":
          return { format: "backwards", value: Number(raw) };
      }
    },
    [data.format],
  );

  const submit = useCallback(
    async (raw: string) => {
      if (submitted.current) return;
      submitted.current = true;
      setPhase("grading");
      const answer = buildAnswer(raw);
      try {
        const result = await onGrade(answer);
        setFlash(result.correct ? "correct" : "wrong");
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
        setPhase("play");
      }
    },
    [buildAnswer, onGrade, onSolve],
  );

  // Countdown.
  useEffect(() => {
    const id = setInterval(() => {
      const left = data.timeLimitMs - (performance.now() - startRef.current);
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        submit(entryRef.current);
      }
    }, 200);
    return () => clearInterval(id);
  }, [data.timeLimitMs, submit]);

  // Physical keyboard support.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "play") return;
      if (e.key === "Enter") {
        e.preventDefault();
        press("submit");
      } else if (e.key === "Backspace") {
        e.preventDefault();
        press("back");
      } else if (/^[0-9]$/.test(e.key)) {
        press(e.key);
      } else if (["+", "-", "*", "/", "(", ")"].includes(e.key)) {
        press(e.key === "*" ? "×" : e.key === "/" ? "÷" : e.key);
      } else if (data.format === "larger" && (e.key === "1" || e.key === "2")) {
        press(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Numbers still available in target mode (each usable once).
  const availableNumbers = (() => {
    if (data.format !== "target") return null;
    const used = (entry.match(/\d+/g) ?? []).map(Number);
    const pool = [...data.numbers];
    for (const u of used) {
      const i = pool.indexOf(u);
      if (i >= 0) pool.splice(i, 1);
    }
    return pool;
  })();

  const refuse = () => {
    setShake(true);
    setTimeout(() => setShake(false), 250);
  };

  const press = (key: string) => {
    if (phase !== "play") return;
    if (key === "submit") {
      if (entryRef.current || data.format === "larger") submit(entryRef.current);
      return;
    }
    if (key === "back") return setEntry((e) => e.slice(0, -1));
    if (key === "clear") return setEntry("");

    if (data.format === "missing_op") {
      if ((OPS as readonly string[]).includes(key)) submit(key);
      return;
    }
    if (data.format === "larger") {
      if (key === "1" || key === "2") submit(String(Number(key) - 1));
      return;
    }
    if (data.format === "backwards") {
      if (/^\d$/.test(key)) setEntry((e) => (e.length < 6 ? e + key : e));
      return;
    }
    // target: build an expression; digits must come from the remaining pool.
    if (/^\d$/.test(key)) {
      const nextEntry = entry + key;
      const lastNum = nextEntry.match(/(\d+)$/)?.[1];
      if (lastNum) {
        // The number being typed must be a prefix of an available number.
        const ok = availableNumbers?.some((n) => String(n).startsWith(lastNum));
        if (!ok) return refuse();
      }
      setEntry(nextEntry);
      return;
    }
    if ((OPS as readonly string[]).includes(key) || key === "(" || key === ")") {
      setEntry((e) => e + ` ${key} `.replace(/\s+\(/, " (").replace(/\)\s+/, ") "));
    }
  };

  const seconds = Math.ceil(remaining / 1000);
  const urgency = remaining < 10_000;

  return (
    <div className="flex flex-col gap-4">
      {/* Countdown */}
      <div className="flex items-center justify-between">
        <TimeBlocks fraction={remaining / data.timeLimitMs} />
        <span
          role="timer"
          aria-label={`${seconds} seconds left`}
          className={`num text-lg ${urgency ? "text-flag" : "text-slate"}`}
        >
          {seconds}s
        </span>
      </div>

      {/* Prompt */}
      {data.format === "target" && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-slate">
            Reach{" "}
            <span className="num font-display text-3xl font-extrabold text-ink">
              {data.target}
            </span>{" "}
            using each number at most once.
          </p>
          <div className="flex gap-2" aria-label="available numbers">
            {data.numbers.map((n, i) => {
              const stillFree = (() => {
                const pool = [...(availableNumbers ?? [])];
                const idx = pool.indexOf(n);
                if (idx >= 0) {
                  pool.splice(idx, 1);
                  return true;
                }
                return false;
              })();
              const usedCount =
                data.numbers.slice(0, i + 1).filter((x) => x === n).length;
              const freeCount = (availableNumbers ?? []).filter((x) => x === n).length;
              const dimmed = usedCount > freeCount;
              void stillFree;
              return (
                <span
                  key={i}
                  className="num grid size-11 place-content-center rounded-(--radius-ctl) border border-ink text-lg"
                  style={{
                    background: dimmed ? "var(--paper)" : "var(--chalk)",
                    opacity: dimmed ? 0.4 : 1,
                  }}
                >
                  {n}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {data.format === "missing_op" && (
        <p className="text-center font-display text-3xl font-extrabold">
          <span className="num">{data.a}</span>{" "}
          <span className="inline-grid size-10 place-content-center rounded-(--radius-ctl) border border-dashed border-slate align-middle text-2xl text-slate">
            ?
          </span>{" "}
          <span className="num">{data.b}</span> ={" "}
          <span className="num">{data.result}</span>
        </p>
      )}
      {data.format === "larger" && (
        <div className="flex flex-col gap-2">
          <p className="text-center text-sm text-slate">Which is larger?</p>
          <div className="grid grid-cols-2 gap-3">
            {[data.left, data.right].map((expr, i) => (
              <button
                key={i}
                type="button"
                disabled={phase !== "play"}
                onClick={() => press(String(i + 1))}
                className="plane-sm num min-h-16 px-3 py-4 text-center text-xl"
              >
                {expr}
                <span className="mt-1 block text-xs text-slate">{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {data.format === "backwards" && (
        <div className="text-center">
          <p className="text-sm text-slate">Start with a number.</p>
          <p className="font-display text-xl font-bold">
            {data.steps.map((s, i) => (
              <span key={i}>
                {s}
                {i < data.steps.length - 1 ? ". " : ". "}
              </span>
            ))}
            You get <span className="num">{data.result}</span>.
          </p>
          <p className="mt-1 text-sm text-slate">What did you start with?</p>
        </div>
      )}

      {/* Entry readout */}
      {(data.format === "target" || data.format === "backwards") && (
        <output
          aria-label="your entry"
          className={`num block min-h-12 w-full rounded-(--radius-ctl) border border-ink bg-chalk px-3 py-2.5 text-right text-xl ${
            flash === "correct"
              ? "animate-[flash-correct_0.6s]"
              : flash === "wrong"
                ? "animate-[flash-wrong_0.6s]"
                : ""
          }`}
          style={{
            transform: shake ? "translateX(-4px)" : undefined,
            transition: "transform 0.1s",
          }}
        >
          {entry || " "}
        </output>
      )}

      {/* Pad */}
      {data.format === "missing_op" ? (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="operators">
          {OPS.map((op) => (
            <PadKey key={op} label={op} onPress={() => press(op)} disabled={phase !== "play"} big />
          ))}
        </div>
      ) : data.format === "larger" ? null : (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="number pad">
          {["7", "8", "9", data.format === "target" ? "÷" : "back",
            "4", "5", "6", data.format === "target" ? "×" : "clear",
            "1", "2", "3", data.format === "target" ? "-" : "",
            data.format === "target" ? "(" : "", "0", data.format === "target" ? ")" : "", data.format === "target" ? "+" : "",
          ]
            .filter((k, i) => k !== "" || i < 12)
            .map((key, i) =>
              key === "" ? (
                <span key={`sp-${i}`} />
              ) : (
                <PadKey
                  key={`${key}-${i}`}
                  label={key === "back" ? "⌫" : key === "clear" ? "C" : key}
                  ariaLabel={key === "back" ? "backspace" : key === "clear" ? "clear" : key}
                  onPress={() => press(key)}
                  disabled={phase !== "play"}
                />
              ),
            )}
          {data.format === "target" && (
            <>
              <PadKey label="⌫" ariaLabel="backspace" onPress={() => press("back")} disabled={phase !== "play"} />
              <PadKey label="C" ariaLabel="clear" onPress={() => press("clear")} disabled={phase !== "play"} />
            </>
          )}
        </div>
      )}

      {(data.format === "target" || data.format === "backwards") && (
        <Button
          onClick={() => press("submit")}
          disabled={phase !== "play" || entry.length === 0}
        >
          Check it
        </Button>
      )}
    </div>
  );
}

function PadKey({
  label,
  ariaLabel,
  onPress,
  disabled,
  big,
}: {
  label: string;
  ariaLabel?: string;
  onPress: () => void;
  disabled: boolean;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={onPress}
      className={`plane-sm num min-h-[52px] text-lg active:translate-x-px active:translate-y-px active:shadow-none disabled:opacity-40 ${
        big ? "min-h-16 text-2xl" : ""
      }`}
    >
      {label}
    </button>
  );
}

// Draining time bar built from blocks, matching the app's timer motif.
function TimeBlocks({ fraction }: { fraction: number }) {
  const total = 16;
  const filled = Math.ceil(Math.max(0, Math.min(1, fraction)) * total);
  return (
    <div aria-hidden className="flex gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="block h-2 w-2 rounded-[1px]"
          style={{
            background:
              i < filled
                ? fraction < 0.25
                  ? "var(--flag)"
                  : "var(--ink)"
                : "transparent",
            boxShadow: i < filled ? undefined : "inset 0 0 0 1px rgb(93 104 82 / 0.5)",
          }}
        />
      ))}
    </div>
  );
}
