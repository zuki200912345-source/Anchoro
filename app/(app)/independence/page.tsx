import Link from "next/link";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  MIN_SAMPLE,
  assistedUnaidedGap,
  buildProfile,
  trend,
  type IndependenceDailyRow,
} from "@/lib/research/independence";
import {
  calibrationCurve,
  calibrationError,
  calibrationVerdict,
  type CalibrationPoint,
} from "@/lib/research/calibration";
import type { Dimension } from "@/lib/research/types";
import { CalibrationChart } from "@/components/research/calibration-chart";
import { DimensionCard } from "@/components/research/dimension-card";
import { ProxyNote } from "@/components/research/proxy-note";
import { RangeTabs } from "./range-tabs";
import { parseWindow, previousPhrase, windowPhrase } from "./window";

// Feature F (independence profile, F1–F6), Feature G (dependency dashboard,
// G1–G4) and the Feature H calibration view (H3).
//
// Everything on this page is a count of what happened inside Anchor, computed
// deterministically in lib/research (F6). There is no model in the loop and no
// composite figure anywhere — six dimensions, each with its own sample size and
// its own interval, plus the assisted−unaided gap on its own (R1, F1, F5).
//
// Tone is fixed by G3: state the number, attach the definition, offer a next
// action, and never dress a figure up as a verdict on the student.

export const metadata = { title: "Independence" };

const DAY_MS = 86_400_000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Midnight UTC of an ISO day string, so windows can be walked backwards. */
const dayStart = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

function Num({ children }: { children: ReactNode }) {
  return <span className="num">{children}</span>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// One neutral thing that would add to each dimension. Task-focused, never about
// the student (I1), and phrased as an option rather than a correction (G3).
const NEXT_ACTION: Record<Dimension["key"], string> = {
  unaided_accuracy:
    "Finish a set without opening a hint. Those are the items counted here.",
  hint_reliance:
    "Take the first attempt before you open a hint. The gap above tells you whether the hints are doing the work.",
  persistence:
    "When an item stalls, write one line about what you tried before you move on.",
  delayed_retention:
    "Reviews come back a day or more after you first met the item. Clearing them on the day they fall due is what this counts.",
  transfer:
    "Transfer items put a strategy you already have into a context you have not seen. Ask for a transfer set when you want more of them.",
  calibration:
    "State a number before you answer, not after. That rating is the only input this uses.",
};

interface CalibrationAttemptRow {
  confidence_before: number | null;
  outcome: string | null;
  completed_at: string | null;
}

export default async function IndependencePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware guards this

  const days = parseWindow((await searchParams).days);

  // lib/database.types.ts was written against the first migration and does not
  // carry the research tables yet, so this page reads through an untyped client
  // and states the row shapes itself. Both tables are behind a "read own rows"
  // policy, so the user-scoped client is the right one.
  const db = supabase as unknown as SupabaseClient;

  const now = Date.now();
  const today = isoDay(now);
  const fetchStart = isoDay(now - (days * 2 - 1) * DAY_MS);

  const [daily, rated] = await Promise.all([
    db
      .from("independence_daily")
      .select("*")
      .eq("user_id", user.id)
      .gte("day", fetchStart)
      .order("day", { ascending: true }),
    db
      .from("item_attempts")
      .select("confidence_before, outcome, completed_at")
      .eq("user_id", user.id)
      .not("confidence_before", "is", null)
      .not("outcome", "is", null)
      .gte("completed_at", `${fetchStart}T00:00:00.000Z`)
      .limit(1000),
  ]);

  const rows: IndependenceDailyRow[] = daily.data ?? [];
  const profile = buildProfile(rows, days);

  // buildProfile anchors its window on the most recent day with data, so the
  // page splits the same way. Anchoring on today instead would put the profile
  // and everything computed here on different windows after a quiet week.
  const anchor = rows.length > 0 ? rows[rows.length - 1].day : today;
  const windowStart = isoDay(dayStart(anchor) - (days - 1) * DAY_MS);
  const previousStart = isoDay(dayStart(windowStart) - days * DAY_MS);
  const current = rows.filter((r) => r.day >= windowStart);
  const previous = rows.filter(
    (r) => r.day < windowStart && r.day >= previousStart,
  );

  // G1 — today's behavioural facts.
  const todayRow = rows.find((r) => r.day === today) ?? null;
  const todayIndependent =
    todayRow && todayRow.total_attempts > 0
      ? Math.round((todayRow.unaided_correct / todayRow.total_attempts) * 100)
      : null;

  const hintTrend = trend(rows, "hint_reliance", days);
  const thinkMs = median(
    current
      .map((r) => r.median_think_ms)
      .filter((v): v is number => typeof v === "number" && v > 0),
  );

  // M4 — the gap, and where it was one window ago. A trajectory, not a verdict.
  const gap = profile.assistedUnaidedGap;
  const previousGap = assistedUnaidedGap(previous);

  // H3 — calibration over the same window as the dimensions.
  const points: CalibrationPoint[] = ((rated.data ?? []) as CalibrationAttemptRow[])
    .filter(
      (r): r is { confidence_before: number; outcome: string; completed_at: string } =>
        typeof r.confidence_before === "number" &&
        r.outcome !== null &&
        typeof r.completed_at === "string" &&
        r.completed_at.slice(0, 10) >= windowStart,
    )
    .map((r) => ({
      confidence: r.confidence_before,
      correct: r.outcome === "correct",
    }));
  const curve = calibrationCurve(points);
  const verdict = calibrationVerdict(curve);
  const meanError = calibrationError(points);

  const windowText = windowPhrase(days);
  const comparison = previousPhrase(days);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Independence
        </h1>
        <p className="text-sm text-slate">
          What you did inside Anchor over {windowText}: how much came out
          unaided, how much help was used, and how well your confidence matched
          the result. Counts and definitions, no ranking.
        </p>
      </header>

      <RangeTabs />

      {/* G1 — behavioural facts, each with the definition attached. */}
      <section aria-labelledby="facts" className="flex flex-col gap-3">
        <h2
          id="facts"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          Behavioural facts
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Fact
            headline={
              todayIndependent === null ? (
                <>No items finished today yet</>
              ) : (
                <>
                  Today you solved <Num>{todayIndependent}%</Num> independently
                </>
              )
            }
            definition={
              todayRow && todayRow.total_attempts > 0 ? (
                <>
                  Of the <Num>{todayRow.total_attempts}</Num> items you finished
                  today, the share you got right with no hint and no worked
                  solution.
                </>
              ) : (
                <>
                  This counts the items you finish today that you get right with
                  no hint and no worked solution. Start a set and it fills in.
                </>
              )
            }
          />

          <Fact
            headline={
              hintTrend === null ? (
                <>Hint reliance has no comparison yet</>
              ) : Math.abs(hintTrend) < 0.5 ? (
                <>Hint reliance is level {windowText}</>
              ) : (
                <>
                  Hint reliance {hintTrend > 0 ? "up" : "down"}{" "}
                  <Num>{Math.abs(Math.round(hintTrend))}</Num>{" "}
                  {Math.abs(Math.round(hintTrend)) === 1 ? "point" : "points"} over{" "}
                  {windowText}
                </>
              )
            }
            definition={
              hintTrend === null ? (
                <>
                  Hint reliance is the share of items where you asked for at least
                  one hint. A comparison needs at least <Num>{MIN_SAMPLE}</Num>{" "}
                  items in {windowText} and in {comparison}.
                </>
              ) : (
                <>
                  Hint reliance is the share of items where you asked for at least
                  one hint. This is the change against {comparison}, measured in
                  percentage points. One point is one item in a hundred, not one
                  percent of the old figure.
                </>
              )
            }
          />

          <Fact
            headline={
              thinkMs === null ? (
                <>No think time recorded yet</>
              ) : (
                <>
                  You think for <Num>{Math.round(thinkMs / 1000)}s</Num> before
                  asking
                </>
              )
            }
            definition={
              <>
                Help-seeking timing: the median gap between the item appearing and
                your first submission or first hint request, taken across the days
                you practised in {windowText}.
              </>
            }
          />
        </div>
      </section>

      {/* R1 / F4 — why there is no headline number. Stated where the numbers are. */}
      <section className="plane p-5" aria-labelledby="no-score">
        <h2
          id="no-score"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          Why there is no single score
        </h2>
        <p className="mt-2 text-sm">
          Anchor does not add these up. Accuracy, time taken, hint use and
          retention are different behaviours, counted over different
          denominators, from samples of different sizes. A composite of them is
          not a validated construct, so one number would state a quantity no
          evidence supports and would bury the sample size that makes each
          figure readable in the first place.
        </p>
        <p className="mt-2 text-sm">
          So you get <Num>6</Num> dimensions, each with its own interval and its
          own count, and nothing that ranks you against anyone else.
        </p>
        <ProxyNote variant="block" className="mt-3">
          Every figure below is a count of what you did in this app over{" "}
          {windowText}.
        </ProxyNote>
      </section>

      {/* M4 — the dependence signal, on its own card. */}
      <section className="plane p-5" aria-labelledby="gap">
        <div className="flex items-start justify-between gap-2">
          <h2
            id="gap"
            className="font-display text-lg font-extrabold tracking-tight"
          >
            Assisted minus unaided
          </h2>
          <span className="shrink-0 bg-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chalk">
            dependence signal
          </span>
        </div>

        {gap === null ? (
          <>
            <p className="mt-2 font-display text-xl font-extrabold leading-tight">
              Not enough data yet — needs <Num>{MIN_SAMPLE}</Num> attempts with
              help and <Num>{MIN_SAMPLE}</Num> without
            </p>
            <p className="mt-1 text-sm text-slate">
              The smaller side currently has <Num>{profile.gapSample}</Num>{" "}
              {profile.gapSample === 1 ? "attempt" : "attempts"}.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="num font-display text-5xl font-extrabold leading-none">
                {gap > 0 ? "+" : ""}
                {Math.round(gap)}
              </span>
              <span className="text-base text-slate">
                {Math.abs(Math.round(gap)) === 1 ? "point" : "points"}
              </span>
            </p>
            <p className="mt-1.5 text-sm text-slate">
              Across {windowText}, the smaller side has{" "}
              <Num>{profile.gapSample}</Num>{" "}
              {profile.gapSample === 1 ? "attempt" : "attempts"}.{" "}
              {previousGap === null ? (
                <>No comparison with {comparison} yet.</>
              ) : (
                <>
                  It was <Num>{previousGap > 0 ? "+" : ""}
                  {Math.round(previousGap)}</Num> over {comparison}.
                </>
              )}
            </p>
          </>
        )}

        <p className="mt-3 text-sm">
          This is how often you are right when help is available, minus how
          often you are right working alone. A wide positive gap means the
          accuracy is leaning on the assistance. A gap near zero means the two
          match, and a negative number means the unaided items are going better
          than the assisted ones. It describes how the work is getting done, not
          how clever anyone is.
        </p>
        <p className="plane-sm mt-3 bg-paper p-2.5 text-sm">
          <span className="font-semibold">Try next. </span>
          Work a set through without opening a hint. The unaided side of this
          comparison is the side short of items, and a wide gap closes from that
          end.
        </p>
        <ProxyNote className="mt-3" />
      </section>

      {/* F1–F5 — the dimensions, side by side, never combined. */}
      <section aria-labelledby="dimensions" className="flex flex-col gap-3">
        <h2
          id="dimensions"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          The six dimensions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {profile.dimensions.map((dimension) => (
            <DimensionCard
              key={dimension.key}
              dimension={dimension}
              comparisonLabel={comparison}
              nextAction={NEXT_ACTION[dimension.key]}
            />
          ))}
        </div>
      </section>

      {/* H3 — predicted against actual, by band. */}
      <section className="plane p-5" aria-labelledby="calibration">
        <h2
          id="calibration"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          Confidence against results
        </h2>
        <p className="mt-2 text-sm text-slate">
          Each point is a band of confidence ratings you gave before answering,
          plotted against how often you turned out to be right in that band.
        </p>
        <div className="mt-3">
          <CalibrationChart bins={curve} />
        </div>
        <p className="mt-3 text-sm">{verdict}</p>
        {meanError !== null && (
          <p className="mt-2 text-sm text-slate">
            Average distance between a rating and the result:{" "}
            <Num>{Math.round(meanError)}</Num> points, from{" "}
            <Num>{points.length}</Num>{" "}
            {points.length === 1 ? "rated item" : "rated items"} in {windowText}.
          </p>
        )}
        <ProxyNote variant="block" className="mt-3">
          Calibration here is the distance between a number you typed and an
          outcome graded against a verified key.
        </ProxyNote>
      </section>

      {/* §15 — the honesty surface, linked from the dashboard that uses it. */}
      <section className="plane p-5" aria-labelledby="evidence">
        <h2
          id="evidence"
          className="font-display text-lg font-extrabold tracking-tight"
        >
          Where these ideas come from
        </h2>
        <p className="mt-2 text-sm">
          Anchor is built on a hypothesis about attempting first and fading
          help, and that hypothesis has evidence behind it with real limits. The
          effect sizes, the studies, and the things the research does not show
          are written out in full.
        </p>
        <Link
          href="/about-the-evidence"
          className="mt-3 inline-flex min-h-11 items-center font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
        >
          Read about the evidence
        </Link>
      </section>
    </div>
  );
}

function Fact({
  headline,
  definition,
}: {
  headline: ReactNode;
  definition: ReactNode;
}) {
  return (
    <section className="plane flex flex-col gap-2 p-4">
      <h3 className="font-display text-lg font-extrabold leading-tight">
        {headline}
      </h3>
      <p className="text-sm text-slate">
        <span className="font-semibold text-ink">What this counts. </span>
        {definition}
      </p>
      <ProxyNote />
    </section>
  );
}
