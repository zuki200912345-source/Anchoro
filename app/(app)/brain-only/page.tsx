import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { asResearchAdmin } from "@/lib/research/items";
import {
  MIN_SAMPLE,
  wilsonInterval,
  type IndependenceDailyRow,
} from "@/lib/research/independence";
import { PROXY_DISCLAIMER } from "@/lib/research/types";
import { BrainOnlyRunner } from "./runner";

// Feature E — Brain-Only mode.
//
// A scheduled AI-free session. There is no hint control, no tutor entry point
// and no solution button anywhere on this route: E1 asks for the assistance to
// be absent, not disabled. The keys arrive after the session, on the self-check
// screen (E2). Nothing on this page displays or ranks by time (E6).

export const metadata = { title: "Brain-only" };

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function asRows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Row => typeof row === "object" && row !== null);
}

function toDailyRow(row: Row): IndependenceDailyRow | null {
  const day = str(row.day);
  if (!day) return null;
  return {
    day,
    unaided_attempts: int(row.unaided_attempts),
    unaided_correct: int(row.unaided_correct),
    delayed_retention_due: int(row.delayed_retention_due),
    delayed_retention_correct: int(row.delayed_retention_correct),
    transfer_attempts: int(row.transfer_attempts),
    transfer_correct: int(row.transfer_correct),
    total_attempts: int(row.total_attempts),
    hints_requested: int(row.hints_requested),
    solutions_revealed: int(row.solutions_revealed),
    skipped: int(row.skipped),
    median_think_ms: null,
    calibration_error: null,
    self_explanations: int(row.self_explanations),
    assisted_correct: int(row.assisted_correct),
    assisted_attempts: int(row.assisted_attempts),
  };
}

interface Arm {
  correct: number;
  attempts: number;
  /** Null below the sample floor — a rate from three attempts is noise. */
  pct: number | null;
  ci: number | null;
}

function arm(correct: number, attempts: number): Arm {
  if (attempts < MIN_SAMPLE) return { correct, attempts, pct: null, ci: null };
  return {
    correct,
    attempts,
    pct: Math.round((correct / attempts) * 100),
    ci: Math.round(wilsonInterval(correct, attempts)),
  };
}

const sum = (rows: IndependenceDailyRow[], pick: (r: IndependenceDailyRow) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

export default async function BrainOnlyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware guards this

  // The generated Database type predates the research migration; this read runs
  // as the signed-in user, so RLS still scopes every row.
  const read = asResearchAdmin(supabase);

  const [profileResult, sessionResult, dailyResult] = await Promise.all([
    read.from("profiles").select("ai_free_streak, ai_free_longest").eq("id", user.id).limit(1),
    read
      .from("brain_only_sessions")
      .select("id, scheduled_for, completed_at, items_total, items_correct, self_checked")
      .eq("user_id", user.id)
      .order("scheduled_for", { ascending: false })
      .limit(10),
    read
      .from("independence_daily")
      .select(
        "day, unaided_attempts, unaided_correct, delayed_retention_due, delayed_retention_correct, transfer_attempts, transfer_correct, total_attempts, hints_requested, solutions_revealed, skipped, self_explanations, assisted_correct, assisted_attempts",
      )
      .eq("user_id", user.id)
      .order("day", { ascending: false })
      .limit(28),
  ]);

  const profile = asRows(profileResult.data)[0];
  const streak = int(profile?.ai_free_streak);
  const longest = int(profile?.ai_free_longest);

  const sessions = asRows(sessionResult.data);
  const daily = asRows(dailyResult.data)
    .map(toDailyRow)
    .filter((row): row is IndependenceDailyRow => row !== null);

  const unaided = arm(
    sum(daily, (r) => r.unaided_correct),
    sum(daily, (r) => r.unaided_attempts),
  );
  const assisted = arm(
    sum(daily, (r) => r.assisted_correct),
    sum(daily, (r) => r.assisted_attempts),
  );
  const gap =
    unaided.pct !== null && assisted.pct !== null ? assisted.pct - unaided.pct : null;
  const gapSample = Math.min(unaided.attempts, assisted.attempts);

  const finishedCount = sessions.filter((row) => str(row.completed_at) !== null).length;

  return (
    <div className="flex flex-col gap-6">
      <section className="plane p-6">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Brain-only mode.
        </h1>
        <p className="mt-2 max-w-md text-slate">
          A short set with the AI switched off. Same idea as training without the
          machines: you find out what you can do on your own. Answers are checked
          against the key afterwards, not during.
        </p>
        <ul className="mt-4 flex flex-col gap-1.5 text-sm text-slate">
          <li>No hints, no tutor, no worked solutions while you work.</li>
          <li>
            <span className="num text-ink">5</span> items, about{" "}
            <span className="num text-ink">5</span> minutes.
          </li>
          <li>Finishing counts. How fast you finish does not.</li>
        </ul>
      </section>

      <BrainOnlyRunner />

      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">AI-free streak</h2>
        <div className="mt-3 flex items-end gap-6">
          <div>
            <p className="num font-display text-4xl font-extrabold">{streak}</p>
            <p className="text-sm text-slate">sessions in a row</p>
          </div>
          <div>
            <p className="num font-display text-2xl font-extrabold">{longest}</p>
            <p className="text-sm text-slate">Longest run</p>
          </div>
        </div>
        <p className="mt-3 max-w-md text-sm text-slate">
          The run continues while you take no hint and no worked solution between
          brain-only sessions. Taking help is not a failure — it just starts the
          count again.
        </p>
      </section>

      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">
          Unaided against assisted
        </h2>
        <p className="mt-1 max-w-md text-sm text-slate">
          Last <span className="num text-ink">28</span> days of attempts, split by
          whether you had help.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-4">
          <ArmFigure
            label="Unaided accuracy"
            arm={unaided}
            note="Solved with no hint and no worked solution."
          />
          <ArmFigure
            label="Assisted accuracy"
            arm={assisted}
            note="Solved with at least one hint available."
          />
        </dl>

        <div className="plane-sm mt-4 p-4">
          <p className="text-sm font-semibold">Assisted minus unaided</p>
          {gap === null ? (
            <p className="mt-1 text-sm text-slate">
              Not enough attempts on both sides yet. Needs at least{" "}
              <span className="num text-ink">{MIN_SAMPLE}</span> in each, and you
              have <span className="num text-ink">{gapSample}</span> in the
              smaller one.
            </p>
          ) : (
            <>
              <p className="num font-display text-2xl font-extrabold">
                {gap > 0 ? "+" : ""}
                {gap} pts
              </p>
              <p className="mt-1 max-w-md text-sm text-slate">
                {gap > 0
                  ? "Your results lean on the help by this much. Closing the difference is what brain-only sessions are for."
                  : "You are performing as well alone as you do with help."}{" "}
                Based on <span className="num text-ink">{gapSample}</span>{" "}
                attempts in the smaller group.
              </p>
            </>
          )}
        </div>

        <p className="mt-3 text-xs text-slate">{PROXY_DISCLAIMER}</p>
      </section>

      <section className="plane p-5">
        <h2 className="font-display text-xl font-extrabold">Past sessions</h2>
        {sessions.length === 0 ? (
          <p className="mt-2 text-sm text-slate">
            No brain-only sessions yet. The first one sets the baseline.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate">
              <span className="num text-ink">{finishedCount}</span> finished.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {sessions.map((row) => {
                const id = str(row.id) ?? "";
                const done = str(row.completed_at) !== null;
                return (
                  <li
                    key={id}
                    className="plane-sm flex items-center justify-between gap-3 p-3"
                  >
                    <span className="num text-sm">{str(row.scheduled_for)}</span>
                    <span className="text-sm text-slate">
                      {done ? (
                        <>
                          <span className="num text-ink">
                            {int(row.items_correct)}
                          </span>
                          <span className="text-slate">/</span>
                          <span className="num text-ink">{int(row.items_total)}</span>{" "}
                          unaided
                          {row.self_checked === true ? " · self-checked" : ""}
                        </>
                      ) : (
                        "not finished"
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="mt-3 text-sm text-slate">
          Got one wrong? Write down what happened in your{" "}
          <Link
            href="/journal"
            className="font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
          >
            error journal
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function ArmFigure({
  label,
  arm,
  note,
}: {
  label: string;
  arm: Arm;
  note: string;
}) {
  return (
    <div>
      <dt className="text-sm font-semibold">{label}</dt>
      <dd>
        {arm.pct === null ? (
          <p className="mt-1 text-sm text-slate">
            Needs <span className="num text-ink">{MIN_SAMPLE}</span> attempts. You
            have <span className="num text-ink">{arm.attempts}</span>.
          </p>
        ) : (
          <>
            <p className="num font-display text-3xl font-extrabold">{arm.pct}%</p>
            <p className="text-sm text-slate">
              <span className="num">±{arm.ci}</span> pts, n=
              <span className="num">{arm.attempts}</span>
            </p>
          </>
        )}
        <p className="mt-1 text-xs text-slate">{note}</p>
      </dd>
    </div>
  );
}
