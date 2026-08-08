import { Fragment } from "react";
import type { AchievementDef } from "@/lib/achievements";

// Achievement grid (§6): earned items as gold blocks, locked items as
// silhouettes that show only the hint. Presentational and client-safe — the
// import above is type-only, so the server-only module never enters a client
// bundle. 2 columns at 390px, 4 from the sm breakpoint.

interface AchievementGridProps {
  defs: AchievementDef[];
  unlockedKeys: string[];
}

// Design rule: every numeral gets the data face, including numbers inside
// achievement copy ("solve 50 puzzles").
function WithNums({ text }: { text: string }) {
  const parts = text.split(/(\d+)/);
  return (
    <>
      {parts.map((part, i) =>
        /^\d+$/.test(part) ? (
          <span key={i} className="num">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function AchievementGrid({ defs, unlockedKeys }: AchievementGridProps) {
  const earned = new Set(unlockedKeys);

  if (defs.length === 0) {
    return (
      <p className="text-sm text-slate">
        Achievements land here after your first session.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {defs.map((d) => {
        const got = earned.has(d.key);
        if (got) {
          return (
            <li
              key={d.key}
              className="plane-sm flex flex-col gap-1.5 p-3"
              aria-label={`${d.name}: earned. ${d.description}`}
            >
              <span
                aria-hidden="true"
                className="block size-8 rounded-[2px] border border-ink bg-gold"
              />
              <span className="font-display text-sm font-bold leading-tight">
                {d.name}
              </span>
              <span className="text-xs leading-snug text-slate">
                <WithNums text={d.description} />
              </span>
            </li>
          );
        }
        return (
          <li
            key={d.key}
            className="flex flex-col gap-1.5 rounded-[2px] border border-dashed border-slate/70 p-3"
            aria-label={`not earned yet. ${d.hint}`}
          >
            <span
              aria-hidden="true"
              className="block size-8 rounded-[2px] border border-dashed border-slate bg-chalk"
            />
            <span
              aria-hidden="true"
              className="font-display text-sm font-bold leading-tight text-slate"
            >
              ———
            </span>
            <span className="text-xs leading-snug text-slate">
              <WithNums text={d.hint} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
