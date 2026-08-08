import Link from "next/link";

// Shared shapes and presentational pieces for the leaderboard. No hooks here;
// everything renders on the server. Tab state lives in the URL (?tab=&page=).

export const PAGE_SIZE = 50;

// RESEARCH-SPEC R3: absolute top-score boards are on the Do-Not-Build list
// (they demotivate low and median performers — Hanus & Fox 2015). The boards
// that survive are improvement and independence, opt-in and skill-banded.
export const LEADERBOARD_TABS = ["improved", "independence", "friends"] as const;
export type LeaderboardTab = (typeof LEADERBOARD_TABS)[number];

export interface BoardRow {
  id: string;
  rank: number;
  name: string;
  avatarEmoji: string | null;
  metric: number;
  streak: number;
}

// The block motif at its smallest: a 4-cell streak glyph.
function StreakBlocks({ streak }: { streak: number }) {
  const filled = Math.min(4, streak);
  return (
    <span aria-hidden className="grid grid-cols-2 gap-px">
      {Array.from({ length: 4 }, (_, i) => (
        <span
          key={i}
          className={`size-1.5 rounded-[1px] ${
            i < filled ? "bg-flag" : "border border-slate/50 bg-transparent"
          }`}
        />
      ))}
    </span>
  );
}

function Row({
  row,
  highlight,
  metricLabel,
}: {
  row: BoardRow;
  highlight: boolean;
  metricLabel: string;
}) {
  return (
    <li
      aria-label={`rank ${row.rank}: ${row.name}, ${metricLabel} ${row.metric}, ${row.streak} day streak`}
      className={`flex min-h-11 items-center gap-3 px-3 py-1 ${
        highlight
          ? "rounded-[2px] border border-ink bg-gold/10"
          : "border-b border-ink/10 last:border-b-0"
      }`}
    >
      <span aria-hidden className="num w-8 shrink-0 text-right text-xs text-slate">
        {row.rank}
      </span>
      {row.avatarEmoji ? (
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center text-base"
        >
          {row.avatarEmoji}
        </span>
      ) : (
        <span
          aria-hidden
          className="size-8 shrink-0 rounded-[2px] border border-slate/40 bg-chalk"
        />
      )}
      <span aria-hidden className="min-w-0 flex-1 truncate text-sm font-semibold">
        {row.name}
      </span>
      <span aria-hidden className="num w-16 shrink-0 text-right text-sm">
        {row.metric}
      </span>
      <span
        aria-hidden
        className="flex w-14 shrink-0 items-center justify-end gap-1.5"
      >
        <span className="num text-xs">{row.streak}</span>
        <StreakBlocks streak={row.streak} />
      </span>
    </li>
  );
}

export function Board({
  rows,
  pinned,
  meId,
  metricLabel,
}: {
  rows: BoardRow[];
  pinned: BoardRow | null;
  meId: string;
  metricLabel: string;
}) {
  return (
    <section className="plane overflow-hidden">
      <div
        aria-hidden
        className="flex items-center gap-3 border-b border-ink/15 px-3 py-2 text-xs text-slate"
      >
        <span className="w-8 shrink-0 text-right">#</span>
        <span className="size-8 shrink-0" />
        <span className="min-w-0 flex-1">name</span>
        <span className="w-16 shrink-0 text-right">{metricLabel}</span>
        <span className="w-14 shrink-0 text-right">streak</span>
      </div>
      <ol aria-label={`ranked by ${metricLabel}`}>
        {rows.map((r) => (
          <Row
            key={r.id}
            row={r}
            highlight={r.id === meId}
            metricLabel={metricLabel}
          />
        ))}
      </ol>
      {pinned && (
        <div className="border-t border-dashed border-slate/60 p-1">
          <ol aria-label="your rank">
            <Row row={pinned} highlight metricLabel={metricLabel} />
          </ol>
        </div>
      )}
    </section>
  );
}

export function Pager({
  tab,
  page,
  total,
}: {
  tab: LeaderboardTab;
  page: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1 && page <= 1) return null;

  const live =
    "plane-sm inline-flex min-h-11 items-center px-4 text-sm font-semibold hover:bg-paper";
  const dead =
    "plane-sm inline-flex min-h-11 items-center px-4 text-sm font-semibold opacity-40";
  const href = (p: number) => `/leaderboard?tab=${tab}&page=${p}`;

  return (
    <nav aria-label="Leaderboard pages" className="flex items-center justify-between">
      {page > 1 ? (
        <Link href={href(page - 1)} scroll={false} className={live}>
          Previous
        </Link>
      ) : (
        <span aria-disabled="true" className={dead}>
          Previous
        </span>
      )}
      <span className="text-xs text-slate">
        page <span className="num">{page}</span> of{" "}
        <span className="num">{pages}</span>
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} scroll={false} className={live}>
          Next
        </Link>
      ) : (
        <span aria-disabled="true" className={dead}>
          Next
        </span>
      )}
    </nav>
  );
}
