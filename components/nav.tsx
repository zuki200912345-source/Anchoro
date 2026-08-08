"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/wordmark";
import { BlockMeter } from "@/components/ui/think-timer";

// Small geometric glyphs in currentColor. The block motif, not icon fonts.
function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden fill="currentColor">
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1" />
      <rect x="11" y="2.5" width="6.5" height="6.5" rx="1" />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1" />
      <rect x="11" y="11" width="6.5" height="6.5" rx="1" />
    </svg>
  );
}

// A single filled block over an outline — the attempt-first "think first" mark.
function AttemptIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden fill="currentColor">
      <rect x="3" y="3" width="14" height="14" rx="1.5" opacity="0.28" />
      <rect x="3" y="10" width="7" height="7" rx="1" />
    </svg>
  );
}

// Stacked cards — the spaced-review pile.
function ReviewIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden fill="currentColor">
      <rect x="4" y="5" width="12" height="4" rx="1" opacity="0.4" />
      <rect x="4" y="11" width="12" height="4" rx="1" />
    </svg>
  );
}

function BarsIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden fill="currentColor">
      <rect x="3" y="10.5" width="4" height="6.5" rx="0.5" />
      <rect x="8" y="5" width="4" height="12" rx="0.5" />
      <rect x="13" y="8" width="4" height="9" rx="0.5" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden fill="currentColor">
      <circle cx="10" cy="10" r="7" />
    </svg>
  );
}

// The five primary destinations. /learn is the flagship (the attempt-first
// engine), so it leads. /independence replaces the old composite-score
// dashboard as the headline progress view (RESEARCH-SPEC R1).
const PRIMARY = [
  { href: "/learn", label: "Learn", Icon: AttemptIcon },
  { href: "/review", label: "Review", Icon: ReviewIcon },
  { href: "/today", label: "Today", Icon: GridIcon },
  { href: "/independence", label: "Progress", Icon: BarsIcon },
  { href: "/profile", label: "Profile", Icon: CircleIcon },
] as const;

// Reachable, but secondary — a scrollable strip so a phone is never crowded.
const SECONDARY = [
  { href: "/practice", label: "Practice" },
  { href: "/brain-only", label: "Brain-only" },
  { href: "/journal", label: "Error journal" },
  { href: "/dashboard", label: "Skill ratings" },
  { href: "/leaderboard", label: "Most improved" },
  { href: "/about-the-evidence", label: "The evidence" },
] as const;

export interface NavProps {
  displayName: string;
  avatarEmoji: string | null;
  streak: number;
}

// The bar shows the retrieval-attempt streak, not a usage streak: A7 and R4
// are explicit that showing up is not what gets rewarded.
function StreakCounter({ streak }: { streak: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="num text-sm font-semibold">{streak}</span>
      <BlockMeter
        filled={Math.min(16, streak)}
        size="sm"
        label={`${streak} day retrieval streak`}
      />
      <span className="text-xs text-slate">Retrieval days</span>
    </div>
  );
}

function SecondaryStrip({
  isActive,
}: {
  isActive: (href: string) => boolean;
}) {
  return (
    <nav
      aria-label="More"
      className="overflow-x-auto border-b border-ink/10 bg-paper/60"
    >
      <ul className="mx-auto flex w-max gap-1 px-4 py-1.5">
        {SECONDARY.map(({ href, label }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-(--radius-ctl) px-2.5 py-1 text-xs font-semibold ${
                  active ? "bg-ink text-chalk" : "text-slate hover:text-ink"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Nav({ displayName, avatarEmoji, streak }: NavProps) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Mobile: quiet top strip, wordmark + streak. */}
      <header className="flex h-12 items-center justify-between px-4 sm:hidden">
        <Link href="/today" aria-label="Anchor home">
          <Wordmark />
        </Link>
        <StreakCounter streak={streak} />
      </header>

      {/* Mobile: secondary destinations scroll horizontally under the strip. */}
      <div className="sm:hidden">
        <SecondaryStrip isActive={isActive} />
      </div>

      {/* Mobile: fixed bottom tab bar, five primary destinations. */}
      <nav
        aria-label="Primary"
        className="plane-sm fixed inset-x-3 bottom-3 z-40 sm:hidden"
      >
        <ul className="flex">
          {PRIMARY.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 ${
                    active ? "text-ink" : "text-slate"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`size-1 rounded-[1px] ${
                      active ? "bg-flag" : "bg-transparent"
                    }`}
                  />
                  <Icon />
                  <span className="text-[10px] font-semibold leading-none">
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* sm+: top bar. Wordmark left, primary tabs centre, identity right. */}
      <header className="sticky top-0 z-40 hidden border-b border-ink bg-chalk sm:block">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
          <Link href="/today" aria-label="Anchor home">
            <Wordmark />
          </Link>
          <nav aria-label="Primary">
            <ul className="flex items-center gap-1">
              {PRIMARY.map(({ href, label }) => {
                const active = isActive(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-1.5 px-3 text-sm font-semibold ${
                        active ? "text-ink" : "text-slate hover:text-ink"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`size-1.5 rounded-[1px] ${
                          active ? "bg-flag" : "bg-transparent"
                        }`}
                      />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              {avatarEmoji ? <span aria-hidden>{avatarEmoji}</span> : null}
              <span className="max-w-28 truncate text-sm font-semibold">
                {displayName}
              </span>
            </div>
            <StreakCounter streak={streak} />
          </div>
        </div>
      </header>

      {/* sm+: secondary destinations under the top bar. */}
      <div className="sticky top-14 z-30 hidden sm:block">
        <SecondaryStrip isActive={isActive} />
      </div>
    </>
  );
}
