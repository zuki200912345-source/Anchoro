import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/streak";
import { PUZZLE_LABELS, type SessionSlot } from "@/lib/types";
import { BlockMeter } from "@/components/ui/think-timer";
import { StartSessionButton } from "./start-button";
import { MidnightCountdown } from "./countdown";
import { ChallengeCta } from "@/components/share/challenge-cta";
import Link from "next/link";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware guards this

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, streak_current, streak_freezes, display_name, friend_code")
    .eq("id", user.id)
    .single();
  const today = localDate(profile?.timezone ?? "UTC");

  const { data: session } = await supabase
    .from("sessions")
    .select("id, status, puzzle_seeds, xp_earned, feedback, accuracy")
    .eq("user_id", user.id)
    .eq("type", "daily")
    .eq("date", today)
    .maybeSingle();

  const { count: answered } = session
    ? await supabase
        .from("attempts")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session.id)
    : { count: 0 };

  const firstName = profile?.display_name?.split(" ")[0] ?? "you";

  if (!session) {
    return (
      <div className="flex flex-col gap-6">
        <section className="plane p-6">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            Today&apos;s five.
          </h1>
          <p className="mt-2 max-w-sm text-slate">
            Five puzzles picked for where you are weakest, {firstName}. No help
            for the first 45 seconds of each.
          </p>
          <div className="mt-5">
            <StartSessionButton label="Start session" />
          </div>
        </section>
        <StreakCard
          streak={profile?.streak_current ?? 0}
          freezes={profile?.streak_freezes ?? 0}
        />
        <ChallengeCta friendCode={profile?.friend_code} />
      </div>
    );
  }

  if (session.status === "in_progress") {
    const slots = session.puzzle_seeds as SessionSlot[];
    return (
      <div className="flex flex-col gap-6">
        <section className="plane p-6">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            Session started.
          </h1>
          <p className="mt-2 text-slate">
            <span className="num text-ink">{answered ?? 0}/5</span> answered.
            The clock only runs while a puzzle is open.
          </p>
          <ol className="mt-4 flex flex-wrap gap-2">
            {slots.map((s, i) => (
              <li
                key={i}
                className={`plane-sm px-3 py-1.5 text-sm ${i < (answered ?? 0) ? "opacity-50" : ""}`}
              >
                {PUZZLE_LABELS[s.type]}
              </li>
            ))}
          </ol>
          <div className="mt-5">
            <StartSessionButton label="Continue session" sessionId={session.id} />
          </div>
        </section>
        <StreakCard
          streak={profile?.streak_current ?? 0}
          freezes={profile?.streak_freezes ?? 0}
        />
      </div>
    );
  }

  // Complete: recap summary + countdown, no replay.
  return (
    <div className="flex flex-col gap-6">
      <section className="plane p-6">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Done for today.
        </h1>
        <p className="mt-2 text-slate">
          <span className="num text-ink">
            {Math.round((session.accuracy ?? 0) * 5)}/5
          </span>{" "}
          solved, <span className="num text-ink">{session.xp_earned}</span> XP
          banked.
        </p>
        {session.feedback && (
          <p className="mt-3 max-w-md text-sm leading-relaxed">{session.feedback}</p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Link
            href={`/session/${session.id}`}
            className="text-sm font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
          >
            See the full recap
          </Link>
        </div>
      </section>
      <section className="plane p-6">
        <p className="text-sm text-slate">Tomorrow&apos;s five in</p>
        <MidnightCountdown />
      </section>
      <ChallengeCta friendCode={profile?.friend_code} />
      <StreakCard
        streak={profile?.streak_current ?? 0}
        freezes={profile?.streak_freezes ?? 0}
      />
    </div>
  );
}

// The streak counts days you did retrieval, not days you opened the app.
// RESEARCH-SPEC R4 and A7 are explicit: a usage streak is exactly the thing
// that must not be rewarded, because completion-contingent rewards erode the
// motivation the product exists to protect. So the count is tied to attempts,
// and the copy says plainly that showing up is not the measure.
function StreakCard({ streak, freezes }: { streak: number; freezes: number }) {
  return (
    <section className="plane flex items-center justify-between p-5">
      <div>
        <p className="num font-display text-2xl font-extrabold">{streak}</p>
        <p className="text-sm text-slate">
          Days you practised recall
          {freezes > 0 && (
            <>
              {" · "}
              <span className="num">{freezes}</span> freeze{freezes === 1 ? "" : "s"} banked
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-slate">
          Counts attempts, not opens. Turning up is not the point.
        </p>
      </div>
      <BlockMeter
        filled={Math.min(16, streak)}
        size="md"
        label={`${streak} days of recall practice`}
      />
    </section>
  );
}
