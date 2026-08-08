"use client";

// Practice picker (§4): choose a category and difficulty. Ratings move,
// XP is halved, the streak is untouched — and the UI says so.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";

export default function PracticePage() {
  const router = useRouter();
  const [category, setCategory] = useState<Category>("pattern");
  const [difficulty, setDifficulty] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "practice", category, difficulty }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not start practice.");
      router.push(`/session/${d.sessionId}`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not start practice. Try again.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Practice
        </h1>
        <p className="mt-1 text-sm text-slate">
          Practice moves your ratings. Half xp. The streak only counts the
          daily session.
        </p>
      </header>

      <section className="plane p-5">
        <h2 className="text-sm font-semibold">Category</h2>
        <div
          role="radiogroup"
          aria-label="category"
          className="mt-3 flex flex-wrap gap-2"
        >
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              onClick={() => setCategory(c)}
              className={`min-h-11 rounded-(--radius-ctl) border px-4 py-2 text-sm font-semibold ${
                category === c
                  ? "border-ink bg-ink text-chalk"
                  : "border-ink bg-chalk text-ink hover:bg-paper"
              }`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <h2 className="mt-6 text-sm font-semibold">Difficulty</h2>
        <div className="mt-3 flex items-center gap-4">
          <Button
            variant="secondary"
            aria-label="lower difficulty"
            onClick={() => setDifficulty((d) => Math.max(1, d - 1))}
            disabled={difficulty <= 1}
          >
            -
          </Button>
          <span className="num w-10 text-center font-display text-2xl font-extrabold">
            {difficulty}
          </span>
          <Button
            variant="secondary"
            aria-label="raise difficulty"
            onClick={() => setDifficulty((d) => Math.min(10, d + 1))}
            disabled={difficulty >= 10}
          >
            +
          </Button>
        </div>

        <div className="mt-6">
          <Button onClick={start} disabled={busy}>
            {busy ? "Setting up" : "Start practice"}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-flag">{error}</p>}
      </section>
    </div>
  );
}
