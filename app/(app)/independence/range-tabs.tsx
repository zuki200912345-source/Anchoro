"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { WINDOWS, parseWindow } from "./window";

// The window lives in the URL so the server fetches for it; this bar only
// reflects it. Same pattern as the leaderboard tabs.
export function RangeTabs() {
  const active = parseWindow(useSearchParams().get("days"));

  return (
    <nav aria-label="Window" className="plane-sm p-1">
      <ul className="flex">
        {WINDOWS.map((days) => {
          const current = days === active;
          return (
            <li key={days} className="flex-1">
              <Link
                href={`/independence?days=${days}`}
                scroll={false}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center gap-1 rounded-[2px] px-1 text-sm font-semibold transition-colors ${
                  current ? "bg-ink text-chalk" : "text-slate hover:text-ink"
                }`}
              >
                <span className="num">{days}</span> days
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
