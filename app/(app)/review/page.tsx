import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { asResearchAdmin } from "@/lib/research/items";
import { MIN_SAMPLE, wilsonInterval } from "@/lib/research/independence";
import { PROXY_DISCLAIMER } from "@/lib/research/types";
import { DueList } from "./due-list";

// N8 / A3 — the spaced retrieval surface. Expanding intervals, shown plainly,
// framed as holding on to what you already learned (A6) rather than as a score.
//
// A7: the streak on this page counts retrieval attempts, not correct answers,
// and says so.

export const metadata = { title: "Review" };

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function asRows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Row => typeof row === "object" && row !== null);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function ReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware guards this

  // The generated Database type predates the research migration. These reads
  // run as the signed-in user, so RLS scopes every row to them.
  const read = asResearchAdmin(supabase);

  const [profileResult, reviewResult, dailyResult] = await Promise.all([
    read.from("profiles").select("retrieval_streak").eq("id", user.id).limit(1),
    read
      .from("reviews")
      .select("item_id, due_on, interval_days, repetitions, lapses")
      .eq("user_id", user.id)
      .order("due_on", { ascending: true })
      .limit(100),
    read
      .from("independence_daily")
      .select("day, delayed_retention_due, delayed_retention_correct")
      .eq("user_id", user.id)
      .order("day", { ascending: false })
      .limit(28),
  ]);

  const retrievalStreak = int(asRows(profileResult.data)[0]?.retrieval_streak);

  const scheduled = asRows(reviewResult.data);
  const now = today();
  const upcoming = scheduled
    .map((row) => ({ dueOn: str(row.due_on), intervalDays: int(row.interval_days, 1) }))
    .filter((row): row is { dueOn: string; intervalDays: number } => row.dueOn !== null)
    .filter((row) => row.dueOn > now)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  const daily = asRows(dailyResult.data);
  const retentionDue = daily.reduce(
    (total, row) => total + int(row.delayed_retention_due),
    0,
  );
  const retentionCorrect = daily.reduce(
    (total, row) => total + int(row.delayed_retention_correct),
    0,
  );
  const retentionPct =
    retentionDue >= MIN_SAMPLE ? Math.round((retentionCorrect / retentionDue) * 100) : null;
  const retentionCi =
    retentionPct === null ? null : Math.round(wilsonInterval(retentionCorrect, retentionDue));

  return (
    <div className="flex flex-col gap-6">
      <section className="plane p-6">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Beat your retention.
        </h1>
        <p className="mt-2 max-w-md text-slate">
          These came up before. The gap since you last saw them is the point:
          recalling something after it has started to fade is what makes it
          stick. The target is what you keep, not a mark out of ten.
        </p>
        <Link
          href="/learn?mode=review"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-ink bg-ink px-6 py-3 text-sm font-semibold text-chalk hover:bg-ink/85 active:translate-x-px active:translate-y-px"
        >
          Start today&apos;s review
        </Link>
      </section>

      <DueList />

      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">Retrieval streak</h2>
        <p className="num font-display mt-2 text-4xl font-extrabold">
          {retrievalStreak}
        </p>
        <p className="mt-1 max-w-md text-sm text-slate">
          Days you turned up and tried to recall something. This counts
          attempts, not correct answers — getting it wrong keeps the streak,
          skipping it does not.
        </p>
      </section>

      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">
          What you have held on to
        </h2>
        {retentionPct === null ? (
          <p className="mt-2 max-w-md text-sm text-slate">
            Needs <span className="num text-ink">{MIN_SAMPLE}</span> delayed
            checks before this says anything. You have{" "}
            <span className="num text-ink">{retentionDue}</span>.
          </p>
        ) : (
          <>
            <p className="num font-display mt-2 text-4xl font-extrabold">
              {retentionPct}%
            </p>
            <p className="text-sm text-slate">
              <span className="num">±{retentionCi}</span> pts, n=
              <span className="num">{retentionDue}</span> delayed checks over the
              last <span className="num">28</span> days
            </p>
          </>
        )}
        <p className="mt-3 text-xs text-slate">{PROXY_DISCLAIMER}</p>
      </section>

      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-slate">
            Nothing scheduled ahead. Items join the schedule the first time you
            answer them.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {upcoming.slice(0, 6).map((row, position) => (
              <li
                key={`${row.dueOn}-${position}`}
                className="plane-sm flex items-center justify-between gap-3 p-3 text-sm"
              >
                <span className="num">{row.dueOn}</span>
                <span className="text-slate">
                  gap of <span className="num text-ink">{row.intervalDays}</span>{" "}
                  {row.intervalDays === 1 ? "day" : "days"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 max-w-md text-sm text-slate">
          Each time you get one right the gap widens: <span className="num">1</span>{" "}
          day, then <span className="num">3</span>, then further out each time.
          Get it wrong and it comes back tomorrow.
        </p>
      </section>
    </div>
  );
}
