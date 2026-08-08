"use client";

// X1 — the XP lines are shown as information, not as a payout. Deci et al.
// 1999 found competence feedback was the one reward type that raised intrinsic
// motivation, so each line leads with the behaviour and keeps the number as a
// footnote in the margin.
//
// R4/§10 — nothing here can be earned by finishing, and nothing by finishing
// fast. Both facts are stated on the panel so the incentive is legible.

import type { XpAward } from "./types";

export function XpBreakdown({ xp }: { xp: XpAward }) {
  const earned = xp.lines.filter((l) => l.amount > 0);
  const zeroed = xp.lines.filter((l) => l.amount === 0);

  return (
    <section className="plane p-5" aria-labelledby="xp-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="xp-heading" className="font-display text-base font-extrabold">
          What scored
        </h2>
        <span className="num text-sm font-semibold">+{xp.total} xp</span>
      </div>

      {earned.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {earned.map((line) => (
            <li
              key={line.key}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span>{line.label}</span>
              <span className="num shrink-0 text-slate">+{line.amount}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate">
          Nothing scored on this one.
        </p>
      )}

      {zeroed.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {zeroed.map((line) => (
            <li
              key={line.key}
              className="flex items-baseline justify-between gap-3 text-sm text-slate"
            >
              <span>{line.label}</span>
              <span className="num shrink-0">+{line.amount}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-xs text-slate">
        These score how the work went, not that it got finished, and never how
        fast. Neither of those is on the list.
      </p>
    </section>
  );
}
