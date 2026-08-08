"use client";

// "Challenge a friend" plane. Mount on /today and /profile, passing the
// signed-in user's friend code so shared links carry their ?ref=.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ShareButton } from "@/components/share/share-button";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";

const selectStyle =
  "min-h-11 rounded-(--radius-ctl) border border-ink bg-chalk px-3 py-2 text-sm text-ink";

export function ChallengeCta({ friendCode }: { friendCode?: string }) {
  const [category, setCategory] = useState<Category>("pattern");
  const [difficulty, setDifficulty] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; url: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, difficulty }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not create the challenge.");
      setCreated({ code: d.code, url: d.url });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not create the challenge. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const linkWithRef = created
    ? friendCode
      ? `${created.url}?ref=${encodeURIComponent(friendCode)}`
      : created.url
    : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkWithRef);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copying failed. Select the link text and copy it yourself.");
    }
  };

  return (
    <section className="plane p-5">
      <h2 className="font-display text-xl font-extrabold tracking-tight">
        Challenge a friend
      </h2>

      {!created ? (
        <>
          <p className="mt-1 text-sm text-slate">
            Same five puzzles, same seeds. The link lasts{" "}
            <span className="num text-ink">7</span> days.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Category
              <select
                className={selectStyle}
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Difficulty
              <select
                className={`num ${selectStyle}`}
                value={difficulty}
                onChange={(e) => setDifficulty(Number(e.target.value))}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={create} disabled={busy}>
              {busy ? "Creating" : "Create challenge"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate">
            Challenge created. Anyone opening the link plays your exact five.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="plane-sm num min-h-11 flex-1 basis-52 content-center overflow-hidden px-3 py-2 text-xs break-all">
              {linkWithRef}
            </span>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex min-h-11 items-center justify-center rounded-(--radius-ctl) border border-ink bg-chalk px-4 py-2 text-sm font-semibold hover:bg-paper"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <div className="mt-3">
            <ShareButton
              title="Anchor challenge"
              text={`${CATEGORY_LABELS[category]} at difficulty ${difficulty}. Same five puzzles. Beat my score.`}
              url={created.url}
              friendCode={friendCode}
            />
          </div>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="mt-3 text-sm font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
          >
            Create another
          </button>
        </>
      )}
      {error && <p className="mt-2 text-sm text-flag">{error}</p>}
    </section>
  );
}
