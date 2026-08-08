import { createClient } from "@/lib/supabase/server";
import { asResearchAdmin } from "@/lib/research/items";
import { JournalForm, type OpenAttempt } from "./entry-form";
import { MathText } from "@/components/math-text";

// N4 — the error journal. The student writes, in their own words, why the
// error happened and what to do next. Entries come back when the same
// misconception shows up again, because recurrence is the measure.

export const metadata = { title: "Error journal" };

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function asRows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Row => typeof row === "object" && row !== null);
}

interface Entry {
  id: string;
  itemId: string | null;
  stem: string | null;
  tag: string | null;
  whatWentWrong: string;
  whatToDoNext: string | null;
  createdAt: string | null;
  revisitedAt: string | null;
  /** Recorded by the engine when the same misconception came back. */
  flaggedRecurred: boolean;
  /** How many entries in this journal carry the same misconception tag. */
  tagCount: number;
}

const WRONG_OUTCOMES = ["incorrect", "partial", "low_effort"];

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string }>;
}) {
  const { attempt } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware guards this

  // The generated Database type predates the research migration. These reads
  // run as the signed-in user, so RLS scopes every row to them.
  const read = asResearchAdmin(supabase);

  const [entryResult, attemptResult] = await Promise.all([
    read
      .from("error_journal")
      .select(
        "id, item_id, item_attempt_id, misconception_tag, what_went_wrong, what_to_do_next, recurred, revisited_at, created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    read
      .from("item_attempts")
      .select("id, item_id, outcome, misconception_tag, completed_at, started_at")
      .eq("user_id", user.id)
      .in("outcome", WRONG_OUTCOMES)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  const entryRows = asRows(entryResult.data);
  const attemptRows = asRows(attemptResult.data).filter(
    (row) => str(row.completed_at) !== null,
  );

  const itemIds = [
    ...new Set(
      [...entryRows, ...attemptRows]
        .map((row) => str(row.item_id))
        .filter((id): id is string => id !== null),
    ),
  ];

  const stemById = new Map<string, string>();
  if (itemIds.length > 0) {
    const itemResult = await read
      .from("items_public")
      .select("id, stem")
      .in("id", itemIds)
      .limit(itemIds.length);
    for (const row of asRows(itemResult.data)) {
      const id = str(row.id);
      const stem = str(row.stem);
      if (id && stem) stemById.set(id, stem);
    }
  }

  const tagCounts = new Map<string, number>();
  for (const row of entryRows) {
    const tag = str(row.misconception_tag);
    if (tag) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const entries: Entry[] = entryRows
    .map((row) => {
      const id = str(row.id);
      const wrong = str(row.what_went_wrong);
      if (!id || !wrong) return null;
      const itemId = str(row.item_id);
      const tag = str(row.misconception_tag);
      return {
        id,
        itemId,
        stem: itemId ? (stemById.get(itemId) ?? null) : null,
        tag,
        whatWentWrong: wrong,
        whatToDoNext: str(row.what_to_do_next),
        createdAt: str(row.created_at),
        revisitedAt: str(row.revisited_at),
        flaggedRecurred: row.recurred === true,
        tagCount: tag ? (tagCounts.get(tag) ?? 1) : 1,
      } satisfies Entry;
    })
    .filter((entry): entry is Entry => entry !== null);

  const recurring = (entry: Entry) => entry.flaggedRecurred || entry.tagCount > 1;

  // Resurfaced first: an entry whose misconception came back is the one worth
  // reading again.
  const ordered = [...entries].sort((a, b) => {
    const byRecurrence = Number(recurring(b)) - Number(recurring(a));
    if (byRecurrence !== 0) return byRecurrence;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  const journaledAttempts = new Set(
    entryRows.map((row) => str(row.item_attempt_id)).filter(Boolean),
  );

  const open: OpenAttempt[] = attemptRows
    .map((row) => {
      const id = str(row.id);
      if (!id || journaledAttempts.has(id)) return null;
      const itemId = str(row.item_id);
      return {
        id,
        stem: itemId ? (stemById.get(itemId) ?? "An item from an earlier session") : "An item from an earlier session",
        tag: str(row.misconception_tag),
      } satisfies OpenAttempt;
    })
    .filter((row): row is OpenAttempt => row !== null);

  const recurringCount = entries.filter(recurring).length;

  return (
    <div className="flex flex-col gap-6">
      <section className="plane p-6">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Error journal.
        </h1>
        <p className="mt-2 max-w-md text-slate">
          Write down what went wrong in your own words and what you will do
          differently. Entries come back when the same mistake does — that
          repeat is the thing worth watching, not the count of errors.
        </p>
        <p className="mt-3 text-sm text-slate">
          <span className="num text-ink">{entries.length}</span> entries ·{" "}
          <span className="num text-ink">{recurringCount}</span> came back.
        </p>
      </section>

      <JournalForm attempts={open} preselected={attempt ?? null} />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-extrabold">Past entries</h2>
        {ordered.length === 0 ? (
          <p className="plane p-5 text-sm text-slate">
            Nothing written yet. The first entry usually comes right after a
            wrong answer, while you still remember what you were thinking.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ordered.map((entry) => (
              <li key={entry.id} className="plane p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {recurring(entry) && (
                    <span className="plane-sm bg-gold px-2 py-1 text-xs font-semibold">
                      Came back
                      {entry.tagCount > 1 ? (
                        <>
                          {" "}
                          <span className="num">{entry.tagCount}×</span>
                        </>
                      ) : null}
                    </span>
                  )}
                  {entry.tag && (
                    <span className="plane-sm px-2 py-1 text-xs">{entry.tag}</span>
                  )}
                  {entry.createdAt && (
                    <span className="num text-xs text-slate">
                      {entry.createdAt.slice(0, 10)}
                    </span>
                  )}
                </div>

                {entry.stem && (
                  <p className="mt-3 font-semibold leading-snug"><MathText text={entry.stem} /></p>
                )}

                <dl className="mt-3 flex flex-col gap-3 text-sm">
                  <div>
                    <dt className="font-semibold">What went wrong</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-slate">
                      {entry.whatWentWrong}
                    </dd>
                  </div>
                  {entry.whatToDoNext && (
                    <div>
                      <dt className="font-semibold">What to do next</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-slate">
                        {entry.whatToDoNext}
                      </dd>
                    </div>
                  )}
                </dl>

                {entry.revisitedAt && (
                  <p className="mt-3 text-xs text-slate">
                    Last revisited{" "}
                    <span className="num">{entry.revisitedAt.slice(0, 10)}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
