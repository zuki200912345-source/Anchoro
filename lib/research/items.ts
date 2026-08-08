import "server-only";
import { ITEM_KINDS, type ItemKind, type PublicItem } from "@/lib/research/types";

// Item selection for the daily set (A1, A2), the spaced-retrieval queue (N8),
// interleaving (N7) and transfer challenges (N6).
//
// Everything here runs server-side with the service-role client. The verified
// answer key, rubric, worked solution and misconception list are read only when
// grading or grounding needs them; the client receives PublicItem and nothing
// else. `toPublicItem` is the single place that stripping happens.

// ---------------------------------------------------------------------------
// Client surface
//
// The generated Database type predates the research migration, so this module
// describes the exact query surface it uses instead of the full generated
// client. The service-role client satisfies it structurally, and tests can
// supply a small in-memory stand-in.
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean;

export interface ResearchQuery
  extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(column: string, value: QueryValue): ResearchQuery;
  lte(column: string, value: QueryValue): ResearchQuery;
  in(column: string, values: readonly string[]): ResearchQuery;
  order(column: string, options?: { ascending?: boolean }): ResearchQuery;
  limit(count: number): ResearchQuery;
}

export interface ResearchTable {
  select(columns: string): ResearchQuery;
}

export interface ResearchAdmin {
  from(table: string): ResearchTable;
}

/**
 * The service-role client satisfies `ResearchAdmin` at runtime, but its
 * generated generics are too deep for TypeScript to compare structurally
 * (TS2589). Routes pass it through here so the cast lives in exactly one place:
 *   selectDailySet(asResearchAdmin(createAdminClient()), userId)
 */
export function asResearchAdmin(client: object): ResearchAdmin {
  return client as unknown as ResearchAdmin;
}

// ---------------------------------------------------------------------------
// Rows and the one stripping point
// ---------------------------------------------------------------------------

/** A row of `items`. The secret columns are optional: selection never asks for
 *  them, grading and hint grounding do. */
export interface ItemRow {
  id: string;
  kind: ItemKind;
  subject: string;
  topic: string;
  skill: string;
  difficulty: number;
  stem: string;
  year_group?: string | null;
  variant_of?: string | null;
  verified?: boolean;
  source?: string;
  distractors?: unknown;
  answer_key?: unknown;
  rubric?: unknown;
  worked_solution?: string | null;
  common_misconceptions?: unknown;
  created_at?: string;
}

/** The exact shape a client is allowed to see. */
export const PUBLIC_ITEM_FIELDS = [
  "id",
  "kind",
  "subject",
  "topic",
  "skill",
  "difficulty",
  "stem",
  "distractors",
] as const;

/** Never leaves the server (I3). Asserted in the tests, field by field. */
export const SECRET_ITEM_FIELDS = [
  "answer_key",
  "rubric",
  "worked_solution",
  "common_misconceptions",
] as const;

/** Columns selection reads. `variant_of` is needed for transfer lineage and is
 *  dropped again by `toPublicItem`. */
export const ITEM_SELECT =
  "id, kind, subject, topic, skill, difficulty, stem, distractors, variant_of, year_group, verified";

/**
 * The only place an item row becomes client-safe. Allow-list, not delete-list:
 * a new secret column added to `items` cannot leak by being forgotten here.
 */
export function toPublicItem(row: ItemRow): PublicItem {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    topic: row.topic,
    skill: row.skill,
    difficulty: row.difficulty,
    stem: row.stem,
    distractors: toStringArray(row.distractors),
  };
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
    else if (typeof entry === "number") out.push(String(entry));
  }
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const MAX_POOL = 120;
const MAX_HISTORY = 200;
const MAX_LINEAGE_DEPTH = 3;

type Record0 = Record<string, unknown>;

async function fetchRows(query: ResearchQuery, what: string): Promise<Record0[]> {
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Could not read ${what}: ${error.message}. Check the service-role key and that the research migration has run.`,
    );
  }
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record0 => typeof row === "object" && row !== null);
}

function asItemRow(row: Record0): ItemRow | null {
  const { id, kind, subject, topic, skill, difficulty, stem } = row;
  if (typeof id !== "string") return null;
  if (typeof kind !== "string" || !(ITEM_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof subject !== "string" || typeof topic !== "string" || typeof skill !== "string") {
    return null;
  }
  if (typeof difficulty !== "number" || typeof stem !== "string") return null;
  return {
    id,
    kind: kind as ItemKind,
    subject,
    topic,
    skill,
    difficulty,
    stem,
    year_group: typeof row.year_group === "string" ? row.year_group : null,
    variant_of: typeof row.variant_of === "string" ? row.variant_of : null,
    verified: row.verified === true,
    distractors: row.distractors,
  };
}

function asItemRows(rows: Record0[]): ItemRow[] {
  const out: ItemRow[] = [];
  for (const row of rows) {
    const item = asItemRow(row);
    if (item) out.push(item);
  }
  return out;
}

/** Item ids this user has already met, most recent first. */
async function seenItemIds(admin: ResearchAdmin, userId: string): Promise<string[]> {
  const rows = await fetchRows(
    admin
      .from("item_attempts")
      .select("item_id, started_at")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(MAX_HISTORY),
    "your attempt history",
  );
  const seen: string[] = [];
  for (const row of rows) {
    if (typeof row.item_id === "string" && !seen.includes(row.item_id)) seen.push(row.item_id);
  }
  return seen;
}

async function fetchItemsByIds(admin: ResearchAdmin, ids: string[]): Promise<ItemRow[]> {
  if (ids.length === 0) return [];
  const rows = await fetchRows(
    admin.from("items").select(ITEM_SELECT).in("id", ids.slice(0, MAX_POOL)),
    "the item bank",
  );
  return asItemRows(rows).filter((item) => item.verified !== false);
}

/**
 * Skills the user has prior exposure to, strongest first. N6 requires prior
 * exposure to the parent skill before a transfer item is worth serving.
 */
async function exposedSkills(admin: ResearchAdmin, seen: string[]): Promise<string[]> {
  const items = await fetchItemsByIds(admin, seen);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.skill, (counts.get(item.skill) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([skill]) => skill);
}

// ---------------------------------------------------------------------------
// N8 — spaced retrieval queue
// ---------------------------------------------------------------------------

export interface DueReview {
  itemId: string;
  dueOn: string;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export function isoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Reviews whose `due_on` has arrived, oldest first (N8). */
export async function dueReviews(
  admin: ResearchAdmin,
  userId: string,
  limit: number,
  today: string = isoDate(),
): Promise<DueReview[]> {
  if (limit <= 0) return [];
  const rows = await fetchRows(
    admin
      .from("reviews")
      .select("item_id, due_on, interval_days, repetitions, lapses")
      .eq("user_id", userId)
      .lte("due_on", today)
      .order("due_on", { ascending: true })
      .limit(limit),
    "your review queue",
  );
  const out: DueReview[] = [];
  for (const row of rows) {
    if (typeof row.item_id !== "string" || typeof row.due_on !== "string") continue;
    out.push({
      itemId: row.item_id,
      dueOn: row.due_on,
      intervalDays: typeof row.interval_days === "number" ? row.interval_days : 1,
      repetitions: typeof row.repetitions === "number" ? row.repetitions : 0,
      lapses: typeof row.lapses === "number" ? row.lapses : 0,
    });
  }
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// N6 — transfer challenges
// ---------------------------------------------------------------------------

/**
 * A transfer item whose `variant_of` chain shares `skill`: either the item is
 * tagged with the skill itself, or it descends from an item that is. Items the
 * user has already met are skipped.
 */
export async function selectTransferVariant(
  admin: ResearchAdmin,
  userId: string,
  skill: string,
  opts: { excludeIds?: readonly string[]; seen?: readonly string[] } = {},
): Promise<PublicItem | null> {
  const seen = new Set(opts.seen ?? (await seenItemIds(admin, userId)));
  for (const id of opts.excludeIds ?? []) seen.add(id);

  const roots = asItemRows(
    await fetchRows(
      admin
        .from("items")
        .select(ITEM_SELECT)
        .eq("skill", skill)
        .order("difficulty", { ascending: true })
        .limit(MAX_POOL),
      "the item bank",
    ),
  ).filter((item) => item.verified !== false);

  const candidates: ItemRow[] = roots.filter((item) => item.kind === "transfer");
  const visited = new Set<string>(roots.map((item) => item.id));
  let frontier = roots.map((item) => item.id);

  for (let depth = 0; depth < MAX_LINEAGE_DEPTH && frontier.length > 0; depth += 1) {
    const children = asItemRows(
      await fetchRows(
        admin
          .from("items")
          .select(ITEM_SELECT)
          .in("variant_of", frontier.slice(0, MAX_POOL))
          .order("difficulty", { ascending: true })
          .limit(MAX_POOL),
        "the item bank",
      ),
    ).filter((item) => item.verified !== false && !visited.has(item.id));

    for (const child of children) visited.add(child.id);
    for (const child of children) {
      if (child.kind === "transfer") candidates.push(child);
    }
    frontier = children.map((item) => item.id);
  }

  const chosen = candidates
    .filter((item) => !seen.has(item.id))
    .sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id))[0];

  return chosen ? toPublicItem(chosen) : null;
}

// ---------------------------------------------------------------------------
// N7 / A2 — interleaving
// ---------------------------------------------------------------------------

export interface Interleavable {
  skill: string;
  /** Lower runs earlier. Due reviews are 0 (N8). */
  priority: number;
}

/**
 * Orders a set so no two consecutive entries share a skill (N7, A2), keeping
 * lower priorities as early as the no-repeat rule allows.
 *
 * When only same-skill entries remain, they are dropped rather than placed back
 * to back: a shorter set beats a blocked one, because blocking is the whole
 * point of interleaving.
 */
export function interleaveBySkill<T extends Interleavable>(entries: readonly T[]): T[] {
  const remaining = entries.map((entry, index) => ({ entry, index }));
  const left = new Map<string, number>();
  for (const { entry } of remaining) left.set(entry.skill, (left.get(entry.skill) ?? 0) + 1);

  const out: T[] = [];
  let lastSkill: string | null = null;

  while (remaining.length > 0) {
    let pick = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i].entry;
      if (candidate.skill === lastSkill) continue;
      if (pick === -1) {
        pick = i;
        continue;
      }
      const best = remaining[pick].entry;
      if (candidate.priority !== best.priority) {
        if (candidate.priority < best.priority) pick = i;
        continue;
      }
      // Same priority: run down the skill with the most entries left, which is
      // what keeps a long run of one skill from dead-ending the set.
      const candidateLeft = left.get(candidate.skill) ?? 0;
      const bestLeft = left.get(best.skill) ?? 0;
      if (candidateLeft > bestLeft) pick = i;
    }
    if (pick === -1) break;

    const [taken] = remaining.splice(pick, 1);
    out.push(taken.entry);
    left.set(taken.entry.skill, (left.get(taken.entry.skill) ?? 1) - 1);
    lastSkill = taken.entry.skill;
  }

  return out;
}

// ---------------------------------------------------------------------------
// A1 — the daily set
// ---------------------------------------------------------------------------

export type DailySetSource = "review" | "transfer" | "new";

const SOURCE_PRIORITY: Record<DailySetSource, number> = { review: 0, transfer: 1, new: 2 };

/** Rough time per item, used only to keep the set inside 5–10 minutes (A1). */
const BASE_SECONDS: Record<ItemKind, number> = {
  retrieval: 35,
  practice: 50,
  reasoning: 70,
  transfer: 85,
};

export function estimateSeconds(kind: ItemKind, difficulty: number): number {
  const d = Math.min(10, Math.max(1, Math.round(difficulty)));
  return BASE_SECONDS[kind] + (d - 1) * 6;
}

export interface DailySetEntry extends Interleavable {
  item: PublicItem;
  source: DailySetSource;
  /** Set for review entries only (N8). */
  dueOn: string | null;
  estimatedSeconds: number;
}

export interface DailySet {
  entries: DailySetEntry[];
  estimatedSeconds: number;
  estimatedMinutes: number;
  reviewCount: number;
  newCount: number;
  transferCount: number;
  skills: string[];
}

export interface DailySetOptions {
  subject?: string;
  topic?: string;
  /** Hard cap on items. Defaults to 8; clamped to 3–12. */
  size?: number;
  /** Time budget in minutes. Defaults to 8; clamped to the 5–10 of A1. */
  targetMinutes?: number;
  /** ISO date, injectable so the review queue is testable. */
  today?: string;
  /** Off only for modes that must not mix in a transfer item. */
  includeTransfer?: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A 5–10 minute set (A1): due reviews first (N8), then unseen curriculum items,
 * with one transfer item when the user has prior exposure to its parent skill
 * (N6). The result is interleaved so problem types alternate (N7, A2).
 */
export async function selectDailySet(
  admin: ResearchAdmin,
  userId: string,
  opts: DailySetOptions = {},
): Promise<DailySet> {
  const today = opts.today ?? isoDate();
  const size = clamp(Math.round(opts.size ?? 8), 3, 12);
  const budget = clamp(Math.round(opts.targetMinutes ?? 8), 5, 10) * 60;

  const seen = await seenItemIds(admin, userId);
  const seenSet = new Set(seen);

  // 1. Due reviews, in due order (N8).
  const due = await dueReviews(admin, userId, size, today);
  const dueById = new Map(due.map((review) => [review.itemId, review]));
  const reviewItems = await fetchItemsByIds(
    admin,
    due.map((review) => review.itemId),
  );
  const reviewRows = due
    .map((review) => reviewItems.find((item) => item.id === review.itemId))
    .filter((item): item is ItemRow => Boolean(item));

  // 2. New curriculum items the user has not met.
  let pool = admin.from("items").select(ITEM_SELECT).eq("verified", true);
  if (opts.subject) pool = pool.eq("subject", opts.subject);
  if (opts.topic) pool = pool.eq("topic", opts.topic);
  // Transfer items are deliberately not in the general pool: N6 only counts as
  // transfer when the strategy is already known, so they arrive through the
  // exposure-gated path below and nowhere else.
  const candidates = asItemRows(
    await fetchRows(pool.order("difficulty", { ascending: true }).limit(MAX_POOL), "the item bank"),
  ).filter(
    (item) => item.kind !== "transfer" && !seenSet.has(item.id) && !dueById.has(item.id),
  );

  const reviewSkills = new Set(reviewRows.map((item) => item.skill));
  const newRows = [...candidates].sort(
    (a, b) =>
      Number(reviewSkills.has(a.skill)) - Number(reviewSkills.has(b.skill)) ||
      a.difficulty - b.difficulty ||
      a.id.localeCompare(b.id),
  );

  // 3. One transfer item, but only against a skill the user has already met (N6).
  let transfer: PublicItem | null = null;
  if (opts.includeTransfer !== false && seen.length > 0) {
    const skills = await exposedSkills(admin, seen);
    for (const skill of skills.slice(0, 3)) {
      transfer = await selectTransferVariant(admin, userId, skill, {
        seen,
        excludeIds: due.map((review) => review.itemId),
      });
      if (transfer) break;
    }
  }

  // 4. Fill to the time budget: reviews, then the transfer item, then new items.
  const chosen: DailySetEntry[] = [];
  let seconds = 0;
  const fits = (extra: number) => chosen.length < size && seconds + extra <= budget;

  const push = (
    item: PublicItem,
    source: DailySetSource,
    dueOn: string | null,
  ): boolean => {
    const cost = estimateSeconds(item.kind, item.difficulty);
    if (!fits(cost) || chosen.some((entry) => entry.item.id === item.id)) return false;
    chosen.push({
      item,
      source,
      dueOn,
      estimatedSeconds: cost,
      skill: item.skill,
      priority: SOURCE_PRIORITY[source],
    });
    seconds += cost;
    return true;
  };

  for (const row of reviewRows) push(toPublicItem(row), "review", dueById.get(row.id)?.dueOn ?? null);
  if (transfer) push(transfer, "transfer", null);
  for (const row of newRows) {
    if (chosen.length >= size) break;
    push(toPublicItem(row), "new", null);
  }

  // 5. Interleave (N7, A2).
  const entries = interleaveBySkill(chosen);
  const total = entries.reduce((sum, entry) => sum + entry.estimatedSeconds, 0);

  return {
    entries,
    estimatedSeconds: total,
    estimatedMinutes: Math.max(1, Math.round(total / 60)),
    reviewCount: entries.filter((entry) => entry.source === "review").length,
    newCount: entries.filter((entry) => entry.source === "new").length,
    transferCount: entries.filter((entry) => entry.source === "transfer").length,
    skills: [...new Set(entries.map((entry) => entry.skill))],
  };
}
