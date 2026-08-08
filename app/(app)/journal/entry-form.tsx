"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// N4 — writing an entry after a wrong answer. Two questions, both in the
// student's own words: what went wrong, and what to do next time. Nothing is
// generated for them here.

export interface OpenAttempt {
  id: string;
  stem: string;
  tag: string | null;
}

const field =
  "w-full rounded-(--radius-ctl) border border-ink bg-chalk px-3 py-2.5 text-sm text-ink placeholder:text-slate";

export function JournalForm({
  attempts,
  preselected,
}: {
  attempts: OpenAttempt[];
  preselected: string | null;
}) {
  const router = useRouter();

  const known = attempts.some((entry) => entry.id === preselected);
  const options: OpenAttempt[] =
    preselected && !known
      ? [{ id: preselected, stem: "The item you came from", tag: null }, ...attempts]
      : attempts;

  const [attemptId, setAttemptId] = useState(preselected ?? options[0]?.id ?? "");
  const [wrong, setWrong] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (options.length === 0) {
    return (
      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">New entry</h2>
        <p className="mt-2 text-sm text-slate">
          Nothing to write up. Entries attach to an answer you got wrong, so this
          fills in after your next session.
        </p>
      </section>
    );
  }

  const save = async () => {
    if (wrong.trim().length === 0) {
      setError("Write what went wrong before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/learn/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemAttemptId: attemptId,
          whatWentWrong: wrong.trim(),
          whatToDoNext: next.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Could not save the entry.");
      }
      setWrong("");
      setNext("");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the entry. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="plane p-5">
      <h2 className="font-display text-xl font-extrabold">New entry</h2>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="journal-attempt" className="text-sm font-semibold">
            Which one
          </label>
          <select
            id="journal-attempt"
            value={attemptId}
            onChange={(event) => setAttemptId(event.target.value)}
            className={`${field} min-h-11`}
          >
            {options.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.stem.length > 70 ? `${entry.stem.slice(0, 70)}…` : entry.stem}
                {entry.tag ? ` · ${entry.tag}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="journal-wrong" className="text-sm font-semibold">
            What went wrong
          </label>
          <p className="mb-1 text-xs text-slate">
            Your words, not the app&apos;s. What were you thinking when you
            answered?
          </p>
          <textarea
            id="journal-wrong"
            rows={4}
            value={wrong}
            onChange={(event) => setWrong(event.target.value)}
            placeholder="I read the sign the wrong way round and subtracted instead of adding."
            className={field}
          />
        </div>

        <div>
          <label htmlFor="journal-next" className="text-sm font-semibold">
            What to do next time
          </label>
          <p className="mb-1 text-xs text-slate">One concrete move. Optional.</p>
          <textarea
            id="journal-next"
            rows={3}
            value={next}
            onChange={(event) => setNext(event.target.value)}
            placeholder="Check the sign before I start rearranging."
            className={field}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={save} disabled={busy} className="self-start">
            {busy ? "Saving" : "Save entry"}
          </Button>
          {error && (
            <p className="text-sm text-flag" role="alert">
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="text-sm text-slate" role="status">
              Saved. It comes back if the same mistake does.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
