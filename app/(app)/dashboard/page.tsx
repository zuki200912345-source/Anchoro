import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { AchievementGrid } from "@/components/achievements/grid";
import { CategoryBars, CategoryRadar } from "@/components/dashboard/charts";
import { CalendarHeatmap } from "@/components/dashboard/heatmap";
import { ProxyNote } from "@/components/research/proxy-note";
import { CATEGORY_LABELS, type Category } from "@/lib/types";

export const metadata = { title: "Skill ratings" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const [{ data: ratings }, { data: attempts }, { data: unlocked }] =
    await Promise.all([
      supabase.from("category_ratings").select("*").eq("user_id", user.id),
      supabase
        .from("attempts")
        .select("category, correct, hints_used, time_ms, created_at")
        .eq("user_id", user.id)
        .gte("created_at", since90),
      supabase.from("achievements").select("achievement_key").eq("user_id", user.id),
    ]);

  const rows = attempts ?? [];

  // The two headline dimensions, shown with their sample sizes (Feature F/G):
  // never a single composite (R1). Unaided = solved without any hint.
  const total = rows.length;
  const unaided = rows.filter((a) => a.hints_used === 0);
  const unaidedCorrect = unaided.filter((a) => a.correct).length;
  const unaidedAccuracy = unaided.length
    ? Math.round((unaidedCorrect / unaided.length) * 100)
    : null;
  const withHints = rows.filter((a) => a.hints_used > 0).length;
  const hintReliance = total ? Math.round((withHints / total) * 100) : null;

  const accuracyPct = total
    ? Math.round((rows.filter((a) => a.correct).length / total) * 100)
    : 0;

  const noHintTimes = unaided.map((a) => a.time_ms).sort((a, b) => a - b);
  const thinkTime = noHintTimes.length
    ? Math.round(noHintTimes[Math.floor(noHintTimes.length / 2)] / 1000)
    : null;

  const perCategory = (predicate: (a: (typeof rows)[number]) => boolean) => {
    const byCat = new Map<Category, { hit: number; total: number }>();
    for (const a of rows) {
      const e = byCat.get(a.category) ?? { hit: 0, total: 0 };
      e.total += 1;
      if (predicate(a)) e.hit += 1;
      byCat.set(a.category, e);
    }
    return [...byCat.entries()].map(([category, e]) => ({
      category,
      value: e.total ? (e.hit / e.total) * 100 : 0,
    }));
  };

  const sortedRatings = [...(ratings ?? [])].sort((a, b) => b.rating - a.rating);
  const strengths = sortedRatings.slice(0, 2);
  const weaknesses = sortedRatings.slice(-2).reverse();

  const heatCounts: Record<string, number> = {};
  for (const a of rows) {
    const day = a.created_at.slice(0, 10);
    heatCounts[day] = (heatCounts[day] ?? 0) + 1;
  }

  const unlockedKeys = new Set((unlocked ?? []).map((a) => a.achievement_key));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        Skill ratings
      </h1>

      {/* No composite score (R1). The headline progress view is the
          independence profile; this page is the per-skill detail below it. */}
      <section className="plane p-5">
        <p className="text-sm leading-relaxed">
          Anchor does not reduce your progress to one number. A single score
          mixing accuracy, speed, hints and memory is not a real measurement of
          anything. Your independence profile keeps the parts separate.
        </p>
        <Link
          href="/independence"
          className="mt-3 inline-flex items-center rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-semibold text-chalk hover:bg-ink/85"
        >
          See your independence profile
        </Link>
      </section>

      {/* The two dimensions that matter most, each with its sample size. */}
      <div className="grid grid-cols-2 gap-4">
        <section className="plane p-4">
          <p className="num font-display text-3xl font-extrabold">
            {unaidedAccuracy === null ? "—" : `${unaidedAccuracy}%`}
          </p>
          <p className="text-sm text-slate">
            solved yourself, and right
            {unaided.length > 0 && (
              <>
                {" "}
                <span className="num">
                  ({unaidedCorrect}/{unaided.length})
                </span>
              </>
            )}
          </p>
          {unaided.length > 0 && (
            <CategoryBars rows={perCategory((a) => a.hints_used === 0 && a.correct)} />
          )}
        </section>
        <section className="plane p-4">
          <p className="num font-display text-3xl font-extrabold">
            {hintReliance === null ? "—" : `${hintReliance}%`}
          </p>
          <p className="text-sm text-slate">
            needed a hint
            {total > 0 && (
              <>
                {" "}
                <span className="num">
                  ({withHints}/{total})
                </span>
              </>
            )}
          </p>
          {total > 0 && (
            <CategoryBars rows={perCategory((a) => a.hints_used > 0)} hue="gold" />
          )}
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <section className="plane p-4">
          <p className="num font-display text-3xl font-extrabold">
            {accuracyPct}%
          </p>
          <p className="text-sm text-slate">accuracy, hints and all</p>
        </section>
        <section className="plane p-4">
          <p className="num font-display text-3xl font-extrabold">
            {thinkTime !== null ? `${thinkTime}s` : "—"}
          </p>
          <p className="text-sm text-slate">median think time, unaided</p>
        </section>
      </div>

      <ProxyNote variant="block">
        These are counts of what you did in Anchor over the last 90 days. They
        move as you play, and small samples wobble.
      </ProxyNote>

      {/* Radar of the six per-skill ratings — six separate ratings, not a
          composite, so they survive R1. */}
      <section className="plane p-4">
        <h2 className="text-sm font-semibold">Six skills, rated separately</h2>
        <CategoryRadar
          ratings={(ratings ?? []).map((r) => ({
            category: r.category,
            rating: r.rating,
          }))}
        />
        <ProxyNote>
          Each skill has its own chess-style rating. There is no combined number.
        </ProxyNote>
      </section>

      {/* Strengths / weaknesses */}
      <div className="grid grid-cols-2 gap-4">
        <section className="plane p-4">
          <h2 className="text-sm font-semibold">Strong</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {strengths.map((r) => (
              <li key={r.category} className="flex justify-between">
                <span>{CATEGORY_LABELS[r.category]}</span>
                <span className="num">{r.rating}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="plane p-4">
          <h2 className="text-sm font-semibold">Work on</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {weaknesses.map((r) => (
              <li key={r.category} className="flex justify-between">
                <span>{CATEGORY_LABELS[r.category]}</span>
                <span className="num">{r.rating}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Calendar heatmap */}
      <section className="plane p-4">
        <h2 className="mb-3 text-sm font-semibold">Last 90 days</h2>
        <CalendarHeatmap counts={heatCounts} />
      </section>

      {/* Achievements */}
      <section className="plane p-4">
        <h2 className="mb-3 text-sm font-semibold">Achievements</h2>
        <AchievementGrid defs={ACHIEVEMENTS} unlockedKeys={[...unlockedKeys]} />
      </section>
    </div>
  );
}
