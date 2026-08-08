"use client";

import { useEffect, useState } from "react";

// The signature element (§7): a 4×4 block grid that fills one cell at a time
// in --flag instead of counting seconds in text. Used on every puzzle screen
// and in miniature on the streak counter.

const CELLS = 16;

export interface ThinkTimerProps {
  startedAt: number | null; // epoch ms; null renders empty
  durationMs: number; // time for all 16 cells to fill
  size?: "sm" | "md";
  label?: string; // accessible name, e.g. "think timer"
  className?: string;
}

export function ThinkTimer({
  startedAt,
  durationMs,
  size = "md",
  label = "think timer",
  className = "",
}: ThinkTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);
  const progress = Math.min(1, elapsed / durationMs);
  const lit = Math.floor(progress * CELLS);

  const cell = size === "sm" ? "size-1.5" : "size-3";
  const gap = size === "sm" ? "gap-px" : "gap-0.5";

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={CELLS}
      aria-valuenow={lit}
      className={`grid grid-cols-4 ${gap} ${className}`}
    >
      {Array.from({ length: CELLS }, (_, i) => (
        <div
          key={i}
          className={`${cell} rounded-[1px] ${
            i < lit ? "bg-flag" : "border border-slate/50 bg-transparent"
          }`}
        />
      ))}
    </div>
  );
}

// Static variant for places that show a fixed fill (e.g. streak counter).
export function BlockMeter({
  filled,
  size = "sm",
  label,
  className = "",
}: {
  filled: number; // 0..16
  size?: "sm" | "md";
  label: string;
  className?: string;
}) {
  const cell = size === "sm" ? "size-1.5" : "size-3";
  const gap = size === "sm" ? "gap-px" : "gap-0.5";
  return (
    <div
      role="img"
      aria-label={label}
      className={`grid grid-cols-4 ${gap} ${className}`}
    >
      {Array.from({ length: CELLS }, (_, i) => (
        <div
          key={i}
          className={`${cell} rounded-[1px] ${
            i < filled ? "bg-flag" : "border border-slate/50 bg-transparent"
          }`}
        />
      ))}
    </div>
  );
}
