import Link from "next/link";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  Board,
  Pager,
  PAGE_SIZE,
  LEADERBOARD_TABS,
  type BoardRow,
  type LeaderboardTab,
} from "./board";
import { LeaderboardTabs } from "./tabs";

export const metadata = { title: "Most improved" };

type FriendRow = {
  id: string;
  display_name: string | null;
  avatar_emoji: string | null;
  band?: number;
  independence_pct?: number;
};

// A single band boundary so the page and the SQL agree on the buckets.
const BAND_LABELS = ["Starting out", "Building", "Steady", "Strong"];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware guards this

  const sp = await searchParams;
  const rawTab = typeof sp.tab === "string" ? sp.tab : "improved";
  const tab: LeaderboardTab = (LEADERBOARD_TABS as readonly string[]).includes(
    rawTab,
  )
    ? (rawTab as LeaderboardTab)
    : "improved";
  const parsedPage = typeof sp.page === "string" ? Number.parseInt(sp.page, 10) : 1;
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const from = (page - 1) * PAGE_SIZE;

  const { data: me } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_emoji, leaderboard_opt_in")
    .eq("id", user.id)
    .single();
  if (!me) return null;

  // Opt-in, not opt-out (R3). Friends is exempt — a friend is not a public
  // board, and the existing friends flow already gates on accepted friendship.
  const optedIn = me.leaderboard_opt_in === true && me.display_name !== null;

  let rows: BoardRow[] = [];
  let total = 0;
  let note: string | null = null;
  let empty: string | null = null;
  let errorMsg: string | null = null;
  let showProfileLink = false;
  let bandLabel: string | null = null;
  const metricLabel = tab === "improved" ? "+pts" : tab === "friends" ? "%" : "%";

  if (tab !== "friends" && !optedIn) {
    // The board itself is the opt-in surface: explain, and point to profile.
    note = null;
    empty =
      "You're not on the improvement boards. They're off by default. Turn them " +
      "on from your profile — you'll be compared with people at a similar level, " +
      "over the last seven days, on how much you improved, never on a top score.";
    showProfileLink = true;
  } else if (tab === "improved") {
    // My band, so I only rank against similar starting ability.
    const { data: mine } = await supabase
      .from("most_improved_board")
      .select("*")
      .eq("id", me.id)
      .maybeSingle();
    const band = mine?.band ?? null;
    if (band === null) {
      empty =
        "Not enough to compare yet. Play across two weeks and the improvement " +
        "board can measure the change.";
    } else {
      bandLabel = BAND_LABELS[band - 1] ?? `band ${band}`;
      const { data, count } = await supabase
        .from("most_improved_board")
        .select("*", { count: "exact" })
        .eq("band", band)
        .order("improvement_pct", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      total = count ?? 0;
      rows = (data ?? []).map((r, i) => ({
        id: r.id,
        rank: from + i + 1,
        name: r.display_name,
        avatarEmoji: r.avatar_emoji,
        metric: r.improvement_pct,
        streak: 0,
      }));
      if (rows.length === 0 && page === 1) {
        empty = "Nobody in your band yet. You go first.";
      }
    }
  } else if (tab === "independence") {
    const { data: mine } = await supabase
      .from("independence_board")
      .select("*")
      .eq("id", me.id)
      .maybeSingle();
    const band = mine?.band ?? null;
    if (band === null) {
      empty =
        "Play a few unaided items this week and the independence board can rank you.";
    } else {
      bandLabel = BAND_LABELS[band - 1] ?? `band ${band}`;
      const { data, count } = await supabase
        .from("independence_board")
        .select("*", { count: "exact" })
        .eq("band", band)
        .order("independence_pct", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      total = count ?? 0;
      rows = (data ?? []).map((r, i) => ({
        id: r.id,
        rank: from + i + 1,
        name: r.display_name,
        avatarEmoji: r.avatar_emoji,
        metric: r.independence_pct,
        streak: 0,
      }));
      if (rows.length === 0 && page === 1) {
        empty = "Nobody in your band yet. You go first.";
      }
    }
  } else {
    // Friends — unchanged flow: accepted friendships via the server route.
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = host
      ? `${proto}://${host}`
      : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
    const cookieHeader = (await cookies())
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    let friendRows: FriendRow[] | null = null;
    try {
      const res = await fetch(`${origin}/api/leaderboard/friends`, {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as { rows: FriendRow[] };
        friendRows = body.rows;
      }
    } catch {
      // fall through to the error card
    }

    if (!friendRows) {
      errorMsg = "Friends didn't load. Refresh to retry.";
    } else if (friendRows.length <= 1) {
      empty = "No friends yet. Share your code from your profile.";
      showProfileLink = true;
    } else {
      // Rank friends by their own independence, not a top score.
      const ranked = [...friendRows].sort(
        (a, b) => (b.independence_pct ?? 0) - (a.independence_pct ?? 0),
      );
      total = ranked.length;
      rows = ranked.slice(from, from + PAGE_SIZE).map((r, i) => ({
        id: r.id,
        rank: from + i + 1,
        name: r.display_name ?? "unnamed",
        avatarEmoji: r.avatar_emoji,
        metric: r.independence_pct ?? 0,
        streak: 0,
      }));
    }
  }

  if (!errorMsg && !empty && rows.length === 0) {
    empty = "Nothing this far down. Go back a page.";
  }

  const heading =
    tab === "improved"
      ? "Most improved"
      : tab === "independence"
        ? "Independence"
        : "Friends";

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          {heading}
        </h1>
        <p className="mt-1 text-sm text-slate">
          {tab === "improved"
            ? "How much you moved this week, against people at your level."
            : tab === "independence"
              ? "How often you solved it yourself, against people at your level."
              : "Your friends, by how much they do without help."}
        </p>
      </header>

      <LeaderboardTabs />

      {tab !== "friends" && (
        <p className="text-xs text-slate">
          Last <span className="num">7</span> days
          {bandLabel ? (
            <>
              {" · "}your level: <span className="font-semibold">{bandLabel}</span>
            </>
          ) : null}
          . No speed, no top-score board — those push people down.
        </p>
      )}

      {errorMsg ? (
        <section className="plane p-6">
          <p className="text-sm">{errorMsg}</p>
        </section>
      ) : empty ? (
        <section className="plane p-6">
          <p className="max-w-sm text-sm leading-relaxed">{empty}</p>
          {showProfileLink && (
            <Link
              href="/profile"
              className="mt-3 inline-block text-sm font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
            >
              Open your profile
            </Link>
          )}
        </section>
      ) : (
        <Board rows={rows} pinned={null} meId={me.id} metricLabel={metricLabel} />
      )}

      {!errorMsg && !empty && note && (
        <p className="px-1 text-sm text-slate">{note}</p>
      )}
      {!errorMsg && !empty && <Pager tab={tab} page={page} total={total} />}
    </div>
  );
}
