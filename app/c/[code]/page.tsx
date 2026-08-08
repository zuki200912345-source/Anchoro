// Public challenge page. Anyone with the code can view it (per RLS the
// challenge and its results are world-readable); playing requires an account.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATEGORY_LABELS } from "@/lib/types";
import { Wordmark } from "@/components/wordmark";
import { PlayChallengeButton } from "./play-button";

type Params = Promise<{ code: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { code } = await params;
  return { title: `Challenge ${code.toUpperCase()}` };
}

function timeLeft(expiresAt: string): {
  expired: boolean;
  n: number;
  unit: string;
} {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { expired: true, n: 0, unit: "" };
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1)
    return { expired: false, n: days, unit: days === 1 ? "day" : "days" };
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return { expired: false, n: hours, unit: hours === 1 ? "hour" : "hours" };
}

function fmtTime(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function ChallengePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  if (!/^[A-Z2-9]{4,12}$/.test(code)) notFound();

  const admin = createAdminClient();
  const { data: challenge } = await admin
    .from("challenges")
    .select("id, code, creator_id, category, difficulty, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!challenge) notFound();

  const [{ data: creator }, { data: results }, viewer] = await Promise.all([
    admin
      .from("profiles")
      .select("display_name, avatar_emoji")
      .eq("id", challenge.creator_id)
      .maybeSingle(),
    admin
      .from("challenge_results")
      .select("user_id, score, time_ms, completed_at")
      .eq("challenge_id", challenge.id),
    createClient().then((s) => s.auth.getUser()),
  ]);

  const user = viewer.data.user;
  const rows = (results ?? []).sort(
    (a, b) => b.score - a.score || a.time_ms - b.time_ms,
  );

  // Names and avatars for everyone on the board, in one query.
  const ids = rows.map((r) => r.user_id);
  const { data: players } = ids.length
    ? await admin
        .from("profiles")
        .select("id, display_name, avatar_emoji")
        .in("id", ids)
    : { data: [] };
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  const creatorName = creator?.display_name ?? "A player";
  const viewerResult = user ? rows.find((r) => r.user_id === user.id) : null;
  const left = timeLeft(challenge.expires_at);

  const sp = await searchParams;
  const ref = Array.isArray(sp.ref) ? sp.ref[0] : sp.ref;
  const signupHref = `/auth?mode=signup&next=${encodeURIComponent(`/c/${code}`)}${
    ref ? `&ref=${encodeURIComponent(ref)}` : ""
  }`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-6">
      <header>
        <Link
          href="/"
          className="inline-block rounded-(--radius-ctl)"
          aria-label="Anchor home"
        >
          <Wordmark />
        </Link>
      </header>

      <section className="plane p-6">
        <div className="flex items-center gap-3">
          {creator?.avatar_emoji && (
            <span
              aria-hidden
              className="plane-sm flex size-11 items-center justify-center text-xl"
            >
              {creator.avatar_emoji}
            </span>
          )}
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            {creatorName} set a challenge.
          </h1>
        </div>
        <p className="mt-3 text-sm text-slate">
          {CATEGORY_LABELS[challenge.category]}, difficulty{" "}
          <span className="num text-ink">{challenge.difficulty}</span>. Five
          puzzles, same seeds for everyone.
        </p>
        <p className="mt-1 text-sm text-slate">
          {left.expired ? (
            "Expired. Scores are final."
          ) : (
            <>
              <span className="num text-ink">{left.n}</span> {left.unit} left
            </>
          )}
        </p>

        <div className="mt-5">
          {!user ? (
            left.expired ? (
              <p className="text-sm">
                This challenge expired before you got here. Sign up and set
                your own.{" "}
                <Link
                  href="/auth?mode=signup"
                  className="font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
                >
                  Create an account
                </Link>
              </p>
            ) : (
              <Link
                href={signupHref}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-ink bg-ink px-6 py-3 text-sm font-semibold text-chalk hover:bg-ink/85"
              >
                Sign up and play the same five puzzles
              </Link>
            )
          ) : viewerResult ? (
            <p className="text-sm">
              You scored{" "}
              <span className="num font-semibold">{viewerResult.score}</span> in{" "}
              <span className="num font-semibold">
                {fmtTime(viewerResult.time_ms)}
              </span>
              . Your row is marked below.
            </p>
          ) : left.expired ? (
            <p className="text-sm">
              This challenge expired. Ask {creatorName} for a new code, or set
              your own from your profile.
            </p>
          ) : (
            <PlayChallengeButton code={code} />
          )}
        </div>
      </section>

      <section className="plane p-6">
        <h2 className="font-display text-xl font-extrabold tracking-tight">
          Scores
        </h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-slate">
            Nobody has played it yet. First in sets the bar.
          </p>
        ) : (
          <ol className="mt-3 flex flex-col">
            {rows.map((r, i) => {
              const p = playerById.get(r.user_id);
              const mine = user?.id === r.user_id;
              return (
                <li
                  key={r.user_id}
                  className={`flex min-h-11 items-center gap-3 border-b border-slate/30 px-2 py-2 last:border-b-0 ${
                    mine ? "rounded-(--radius-ctl) bg-gold/25" : ""
                  }`}
                >
                  <span className="num w-6 text-sm text-slate">{i + 1}</span>
                  <span aria-hidden className="text-lg">
                    {p?.avatar_emoji ?? ""}
                  </span>
                  <span className="flex-1 truncate text-sm font-semibold">
                    {p?.display_name ?? "Player"}
                    {mine && (
                      <span className="ml-2 text-xs font-normal text-slate">
                        you
                      </span>
                    )}
                  </span>
                  <span className="num text-sm font-semibold">{r.score}</span>
                  <span className="num w-14 text-right text-sm text-slate">
                    {fmtTime(r.time_ms)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <p className="text-center text-xs text-slate">
        Ranked by score, then by time.
      </p>
    </main>
  );
}
