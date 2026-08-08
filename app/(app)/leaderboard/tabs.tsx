"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LEADERBOARD_TABS, type LeaderboardTab } from "./board";

// Tab bar. The active tab lives in the URL so the server fetches per tab;
// this component just reflects it and swaps instantly on navigation.
export function LeaderboardTabs() {
  const params = useSearchParams();
  const raw = params.get("tab") ?? "improved";
  const active: LeaderboardTab = (
    LEADERBOARD_TABS as readonly string[]
  ).includes(raw)
    ? (raw as LeaderboardTab)
    : "improved";

  return (
    <nav aria-label="Leaderboard tabs" className="plane-sm p-1">
      <ul className="flex">
        {LEADERBOARD_TABS.map((tab) => {
          const current = tab === active;
          return (
            <li key={tab} className="flex-1">
              <Link
                href={`/leaderboard?tab=${tab}`}
                scroll={false}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center rounded-[2px] px-1 text-sm font-semibold transition-colors ${
                  current ? "bg-ink text-chalk" : "text-slate hover:text-ink"
                }`}
              >
                {tab}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
