"use client";

// Session recap (§4): per-puzzle results, XP, rating moves, streak, and the
// AI paragraph. Fetches /api/session/[id]/recap.

import { useEffect, useState } from "react";
import Link from "next/link";
import { BlockMeter } from "@/components/ui/think-timer";
import { ShareButton } from "@/components/share/share-button";
import {
  CATEGORY_LABELS,
  PUZZLE_LABELS,
  type Category,
  type PuzzleType,
} from "@/lib/types";

interface RecapData {
  perPuzzle: {
    slotIndex: number;
    type: PuzzleType;
    category: Category;
    difficulty: number;
    correct: boolean;
    timeMs: number;
    hintsUsed: number;
    ratingDelta: number;
  }[];
  xpEarned: number;
  accuracy: number | null;
  score: number | null;
  ratingMoves: { category: Category; delta: number }[];
  streak: { current: number; freezes: number; extendedToday: boolean };
  sessionType: "daily" | "practice" | "challenge";
  feedback: string;
  newAchievements: string[];
}

export function SessionRecap({
  sessionId,
  friendCode,
}: {
  sessionId: string;
  friendCode?: string;
}) {
  const [data, setData] = useState<RecapData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/session/${sessionId}/recap`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load the recap.");
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, [sessionId]);

  if (error) {
    return (
      <p className="plane p-4 text-sm">
        {error}{" "}
        <Link href="/today" className="underline underline-offset-4">
          Back to today
        </Link>
      </p>
    );
  }
  if (!data) {
    return <div className="plane h-48 animate-pulse p-4" aria-label="loading recap" />;
  }

  const solved = data.perPuzzle.filter((p) => p.correct).length;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          {solved === data.perPuzzle.length
            ? "All five."
            : `${solved} out of ${data.perPuzzle.length}.`}
        </h1>
        {data.sessionType === "practice" && (
          <p className="mt-1 text-sm text-slate">
            Practice run: ratings moved, half xp, streak untouched.
          </p>
        )}
      </header>

      <section className="plane divide-y divide-ink/10 p-2" aria-label="results by puzzle">
        {data.perPuzzle.map((p) => (
          <div key={p.slotIndex} className="flex items-center gap-3 px-3 py-2.5">
            <span
              aria-label={p.correct ? "solved" : "missed"}
              className="size-3 shrink-0 rounded-[1px]"
              style={{
                background: p.correct ? "var(--block-3)" : "var(--flag)",
              }}
            />
            <span className="flex-1 text-sm font-semibold">
              {PUZZLE_LABELS[p.type]}
              <span className="ml-2 font-normal text-slate">
                {CATEGORY_LABELS[p.category]} · d
                <span className="num">{p.difficulty}</span>
              </span>
            </span>
            <span className="num text-sm text-slate">
              {(p.timeMs / 1000).toFixed(0)}s
            </span>
            <span className="num w-14 text-right text-sm text-slate">
              {p.hintsUsed > 0 ? `${p.hintsUsed}h` : "no h"}
            </span>
          </div>
        ))}
      </section>

      {/* Informational competence feedback, not a reward total (RESEARCH-SPEC
          X1): positive competence feedback is the one reward type that raised
          intrinsic motivation in Deci et al. So we describe what you did, and
          keep the xp number quiet underneath. */}
      <section className="plane p-4" aria-label="what you did">
        <h2 className="text-sm font-semibold">What you did yourself</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {(() => {
            const solvedAlone = data.perPuzzle.filter(
              (p) => p.correct && p.hintsUsed === 0,
            ).length;
            const keptGoing = data.perPuzzle.filter(
              (p) => p.correct && p.hintsUsed > 0,
            ).length;
            const lines: string[] = [];
            if (solvedAlone > 0)
              lines.push(
                `Solved ${solvedAlone} of ${data.perPuzzle.length} with no help at all.`,
              );
            if (keptGoing > 0)
              lines.push(
                `Used a hint and then finished ${keptGoing} of them — help used as a tool.`,
              );
            if (lines.length === 0)
              lines.push("A hard set. The next one calibrates to it.");
            return lines.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 shrink-0 rounded-[1px] bg-gold"
                />
                {l}
              </li>
            ));
          })()}
        </ul>
        <p className="num mt-3 text-xs text-slate">
          {data.xpEarned} xp, weighted toward what you did without help
        </p>
      </section>

      <section className="plane p-4">
        <p className="num font-display text-3xl font-extrabold">
          {data.streak.current}
        </p>
        <p className="text-sm text-slate">
          {data.sessionType === "daily"
            ? data.streak.extendedToday
              ? "Retrieval days, extended"
              : "Retrieval days"
            : "Retrieval days, unchanged"}
        </p>
        <BlockMeter
          filled={Math.min(16, data.streak.current)}
          label={`${data.streak.current} retrieval days`}
          className="mt-2"
        />
      </section>

      <section className="plane p-4" aria-label="rating moves">
        <h2 className="text-sm font-semibold">Ratings</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {data.ratingMoves.map((m) => (
            <li key={m.category} className="flex justify-between text-sm">
              <span>{CATEGORY_LABELS[m.category]}</span>
              <span
                className="num"
                style={{ color: m.delta < 0 ? "var(--flag)" : "var(--ink)" }}
              >
                {m.delta >= 0 ? "+" : ""}
                {m.delta}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {data.feedback && (
        <section className="plane border-gold p-4" aria-label="coach's read">
          <p className="text-sm leading-relaxed">{data.feedback}</p>
        </section>
      )}

      {data.newAchievements.length > 0 && (
        <section className="plane p-4">
          <h2 className="text-sm font-semibold">
            Earned this session
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {data.newAchievements.map((key) => (
              <li key={key} className="plane-sm bg-gold/20 px-3 py-1.5 text-sm">
                {key.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="plane p-4">
        <h2 className="mb-3 text-sm font-semibold">Share the score</h2>
        <ShareButton
          title="Anchor"
          text={`${solved}/${data.perPuzzle.length} on today's five, ${data.perPuzzle.reduce((n, p) => n + p.hintsUsed, 0) === 0 ? "no hints" : "some hints"}.`}
          url={`${typeof window === "undefined" ? "" : window.location.origin}/auth?mode=signup`}
          imageUrl={`/api/share/score/${sessionId}`}
          friendCode={friendCode}
        />
      </section>

      <Link
        href="/today"
        className="inline-flex w-fit items-center rounded-full border border-ink bg-ink px-6 py-3 text-sm font-semibold text-chalk hover:bg-ink/85"
      >
        Back to today
      </Link>
    </div>
  );
}
