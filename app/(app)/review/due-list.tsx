"use client";

import { useEffect, useState } from "react";
import { MathText } from "@/components/math-text";

// Today's due items (N8), read from GET /api/learn/review/due.
//
// The route belongs to the learn engine, so this reads its payload
// defensively: an array, or an object holding one under a few likely names,
// with each entry either flat or wrapping a PublicItem. Anything it cannot read
// is reported as such rather than rendered as an empty queue.

interface DueEntry {
  key: string;
  stem: string | null;
  subject: string | null;
  topic: string | null;
  dueOn: string | null;
  intervalDays: number | null;
  repetitions: number | null;
  ease: number | null;
  daysOverdue: number | null;
}

type Payload = Record<string, unknown>;

const isRecord = (v: unknown): v is Payload => typeof v === "object" && v !== null;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function pickArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;
  for (const key of ["items", "due", "reviews", "entries", "queue"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function toEntry(raw: unknown, position: number): DueEntry | null {
  if (!isRecord(raw)) return null;
  const item = isRecord(raw.item) ? raw.item : {};
  const get = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (raw[key] !== undefined) return raw[key];
      if (item[key] !== undefined) return item[key];
    }
    return undefined;
  };

  const id =
    str(get("itemId", "item_id", "id")) ?? `due-${position}`;

  return {
    key: id,
    stem: str(get("stem", "question")),
    subject: str(get("subject")),
    topic: str(get("topic")),
    dueOn: str(get("dueOn", "due_on")),
    intervalDays: num(get("intervalDays", "interval_days")),
    repetitions: num(get("repetitions")),
    ease: num(get("ease")),
    daysOverdue: num(get("daysOverdue", "days_overdue")),
  };
}

/**
 * The expanding interval, mirroring `schedule_review` in the migration: first
 * success 1 day, second 3 days, then the previous gap multiplied by the ease.
 * The ease is only exact when the route sends it, so the copy says "about"
 * whenever it has to assume the 2.5 default.
 */
function nextGap(entry: DueEntry): { days: number; approximate: boolean } {
  const repetitions = entry.repetitions ?? 0;
  if (repetitions <= 0) return { days: 1, approximate: false };
  if (repetitions === 1) return { days: 3, approximate: false };
  const ease = Math.min(3, (entry.ease ?? 2.5) + 0.1);
  const base = entry.intervalDays ?? 3;
  return { days: Math.max(1, Math.round(base * ease)), approximate: entry.ease === null };
}

function GapCopy({ entry }: { entry: DueEntry }) {
  const { days, approximate } = nextGap(entry);
  return (
    <>
      Get it right and the next check is in{approximate ? " about" : ""}{" "}
      <span className="num text-ink">{days}</span> {days === 1 ? "day" : "days"}
    </>
  );
}

export function DueList() {
  const [entries, setEntries] = useState<DueEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await fetch("/api/learn/review/due");
        const payload = await response.json().catch(() => null);
        if (!live) return;
        if (!response.ok) {
          const message = isRecord(payload) ? str(payload.error) : null;
          throw new Error(message ?? "Could not read today's review queue.");
        }
        const list = pickArray(payload);
        if (list === null) {
          throw new Error("Could not read today's review queue. Reload the page.");
        }
        setEntries(
          list
            .map(toEntry)
            .filter((entry): entry is DueEntry => entry !== null),
        );
      } catch (e) {
        if (!live) return;
        setError(
          e instanceof Error
            ? e.message
            : "Could not read today's review queue. Reload the page.",
        );
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">Due today</h2>
        <p className="mt-2 text-sm text-flag" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (entries === null) {
    return (
      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">Due today</h2>
        <p className="mt-2 text-sm text-slate" role="status">
          Reading your queue.
        </p>
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">Due today</h2>
        <p className="mt-2 max-w-md text-sm text-slate">
          Nothing due. Waiting is doing something here. The gap is what makes
          the next check worth taking.
        </p>
      </section>
    );
  }

  return (
    <section className="plane p-5">
      <h2 className="font-display text-xl font-extrabold">Due today</h2>
      <p className="mt-1 text-sm text-slate">
        <span className="num text-ink">{entries.length}</span>{" "}
        {entries.length === 1 ? "item" : "items"} to bring back from memory.
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {entries.map((entry) => (
          <li key={entry.key} className="plane-sm p-4">
            {entry.stem ? (
              <p className="font-semibold leading-snug"><MathText text={entry.stem} /></p>
            ) : (
              <p className="font-semibold leading-snug">
                {entry.topic ?? "An item you have seen before"}
              </p>
            )}
            {(entry.subject || entry.topic) && (
              <p className="mt-1 text-xs uppercase tracking-wide text-slate">
                {[entry.subject, entry.topic].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="mt-2 text-sm text-slate">
              {entry.intervalDays !== null && (
                <>
                  Last gap <span className="num text-ink">{entry.intervalDays}</span>{" "}
                  {entry.intervalDays === 1 ? "day" : "days"} ·{" "}
                </>
              )}
              <GapCopy entry={entry} />
            </p>
            {entry.daysOverdue !== null && entry.daysOverdue > 0 && (
              <p className="mt-1 text-xs text-slate">
                <span className="num text-ink">{entry.daysOverdue}</span>{" "}
                {entry.daysOverdue === 1 ? "day" : "days"} past its check date.
                Later is harder, which is the point.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
