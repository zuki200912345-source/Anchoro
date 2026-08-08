import { describe, expect, it } from "vitest";
import {
  dueReviews,
  estimateSeconds,
  interleaveBySkill,
  isoDate,
  PUBLIC_ITEM_FIELDS,
  SECRET_ITEM_FIELDS,
  selectDailySet,
  selectTransferVariant,
  toPublicItem,
  type ItemRow,
  type ResearchAdmin,
  type ResearchQuery,
} from "../items";

// ---------------------------------------------------------------------------
// In-memory stand-in for the service-role client. Supports exactly the query
// surface items.ts uses: select / eq / lte / in / order / limit / await.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function query(rows: Row[]): ResearchQuery {
  return {
    eq: (column, value) => query(rows.filter((row) => row[column] === value)),
    lte: (column, value) =>
      query(rows.filter((row) => compare(row[column], value) <= 0)),
    in: (column, values) =>
      query(rows.filter((row) => values.includes(String(row[column])))),
    order: (column, options) => {
      const direction = options?.ascending === false ? -1 : 1;
      return query([...rows].sort((a, b) => compare(a[column], b[column]) * direction));
    },
    limit: (count) => query(rows.slice(0, count)),
    then: (onfulfilled, onrejected) =>
      Promise.resolve<{ data: unknown; error: { message: string } | null }>({
        data: rows,
        error: null,
      }).then(onfulfilled, onrejected),
  };
}

function fakeAdmin(tables: Record<string, Row[]>): ResearchAdmin {
  return {
    from: (table) => ({ select: () => query(tables[table] ?? []) }),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let counter = 0;

function item(overrides: Partial<Row> & { skill: string }): Row {
  counter += 1;
  return {
    id: `item-${String(counter).padStart(3, "0")}`,
    kind: "retrieval",
    subject: "maths",
    topic: "algebra",
    difficulty: 3,
    stem: "Solve for x.",
    distractors: null,
    variant_of: null,
    year_group: "10",
    verified: true,
    answer_key: { value: 7, steps: ["subtract 3", "divide by 2"] },
    rubric: { criteria: ["isolates x"] },
    worked_solution: "2x + 3 = 17, so x = 7.",
    common_misconceptions: { sign_flip: "Drops the sign when moving a term." },
    ...overrides,
  };
}

function attemptRow(itemId: string, startedAt: string): Row {
  return { item_id: itemId, user_id: "u1", started_at: startedAt };
}

function reviewRow(itemId: string, dueOn: string): Row {
  return {
    user_id: "u1",
    item_id: itemId,
    due_on: dueOn,
    interval_days: 3,
    repetitions: 2,
    lapses: 0,
  };
}

const TODAY = "2026-08-05";

// ---------------------------------------------------------------------------
// toPublicItem — the single stripping point (I3)
// ---------------------------------------------------------------------------

describe("toPublicItem", () => {
  const row: ItemRow = {
    id: "i1",
    kind: "reasoning",
    subject: "maths",
    topic: "linear equations",
    skill: "solve-linear",
    difficulty: 6,
    stem: "Solve 2x + 3 = 17.",
    year_group: "10",
    variant_of: "i0",
    verified: true,
    source: "authored",
    distractors: ["5", "6", 7],
    answer_key: { value: 7 },
    rubric: { criteria: ["isolates x"] },
    worked_solution: "Subtract 3, divide by 2.",
    common_misconceptions: { sign_flip: "Drops the sign." },
    created_at: "2026-08-01T00:00:00Z",
  };

  it("returns exactly the public field list and nothing else", () => {
    const publicItem = toPublicItem(row);
    expect(Object.keys(publicItem).sort()).toEqual([...PUBLIC_ITEM_FIELDS].sort());
  });

  it("strips every secret field by name", () => {
    const publicItem = toPublicItem(row) as unknown as Record<string, unknown>;
    for (const field of SECRET_ITEM_FIELDS) {
      expect(Object.keys(publicItem)).not.toContain(field);
      expect(publicItem[field]).toBeUndefined();
    }
    expect(SECRET_ITEM_FIELDS).toEqual([
      "answer_key",
      "rubric",
      "worked_solution",
      "common_misconceptions",
    ]);
  });

  it("drops server-side bookkeeping columns too", () => {
    const publicItem = toPublicItem(row) as unknown as Record<string, unknown>;
    for (const field of ["variant_of", "verified", "source", "year_group", "created_at"]) {
      expect(Object.keys(publicItem)).not.toContain(field);
    }
  });

  it("keeps the fields the client needs and normalises distractors", () => {
    const publicItem = toPublicItem(row);
    expect(publicItem.id).toBe("i1");
    expect(publicItem.stem).toBe("Solve 2x + 3 = 17.");
    expect(publicItem.distractors).toEqual(["5", "6", "7"]);
    expect(toPublicItem({ ...row, distractors: null }).distractors).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// N7 / A2 — interleaving
// ---------------------------------------------------------------------------

describe("interleaveBySkill", () => {
  it("never places two entries of the same skill back to back", () => {
    const pool = [
      { skill: "a", priority: 0 },
      { skill: "a", priority: 0 },
      { skill: "a", priority: 0 },
      { skill: "b", priority: 2 },
      { skill: "c", priority: 2 },
      { skill: "b", priority: 2 },
    ];
    const out = interleaveBySkill(pool);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].skill).not.toBe(out[i - 1].skill);
    }
    expect(out.length).toBe(pool.length);
  });

  it("keeps lower priorities as early as the no-repeat rule allows", () => {
    const out = interleaveBySkill([
      { skill: "x", priority: 0, id: "review-1" },
      { skill: "x", priority: 0, id: "review-2" },
      { skill: "y", priority: 2, id: "new-1" },
      { skill: "z", priority: 2, id: "new-2" },
    ]);
    expect(out.map((e) => e.id)).toEqual(["review-1", "new-1", "review-2", "new-2"]);
  });

  it("drops trailing same-skill entries rather than repeating a skill", () => {
    const out = interleaveBySkill([
      { skill: "a", priority: 0 },
      { skill: "a", priority: 0 },
      { skill: "a", priority: 0 },
      { skill: "b", priority: 1 },
    ]);
    expect(out.map((e) => e.skill)).toEqual(["a", "b", "a"]);
  });

  it("handles empty and single-entry sets", () => {
    expect(interleaveBySkill([])).toEqual([]);
    expect(interleaveBySkill([{ skill: "a", priority: 0 }])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// N8 — the review queue
// ---------------------------------------------------------------------------

describe("dueReviews", () => {
  const admin = fakeAdmin({
    reviews: [
      reviewRow("i-late", "2026-08-01"),
      reviewRow("i-today", TODAY),
      reviewRow("i-future", "2026-08-09"),
      { ...reviewRow("i-other-user", "2026-08-01"), user_id: "u2" },
    ],
  });

  it("returns only reviews due on or before today, oldest first", async () => {
    const due = await dueReviews(admin, "u1", 10, TODAY);
    expect(due.map((r) => r.itemId)).toEqual(["i-late", "i-today"]);
    expect(due[0].dueOn).toBe("2026-08-01");
  });

  it("scopes to the user and honours the limit", async () => {
    const due = await dueReviews(admin, "u1", 1, TODAY);
    expect(due).toHaveLength(1);
    expect(due[0].itemId).toBe("i-late");
    expect(await dueReviews(admin, "u1", 0, TODAY)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// N6 — transfer lineage
// ---------------------------------------------------------------------------

describe("selectTransferVariant", () => {
  const parent = item({ id: "p1", skill: "ratio-reasoning", kind: "reasoning" });
  const childTransfer = item({
    id: "t1",
    skill: "ratio-in-recipes",
    kind: "transfer",
    variant_of: "p1",
    difficulty: 5,
  });
  const grandchildTransfer = item({
    id: "t2",
    skill: "ratio-in-maps",
    kind: "transfer",
    variant_of: "t1",
    difficulty: 4,
  });
  const directTransfer = item({
    id: "t3",
    skill: "ratio-reasoning",
    kind: "transfer",
    difficulty: 8,
  });
  const unrelatedTransfer = item({ id: "t4", skill: "photosynthesis", kind: "transfer" });
  const nonTransferChild = item({
    id: "n1",
    skill: "ratio-drill",
    kind: "practice",
    variant_of: "p1",
  });

  const rows = [
    parent,
    childTransfer,
    grandchildTransfer,
    directTransfer,
    unrelatedTransfer,
    nonTransferChild,
  ];

  it("finds a transfer item whose variant_of chain shares the skill", async () => {
    const admin = fakeAdmin({ items: rows, item_attempts: [] });
    const picked = await selectTransferVariant(admin, "u1", "ratio-reasoning");
    // Lowest difficulty of the lineage transfers: t2 (4) beats t1 (5) and t3 (8).
    expect(picked?.id).toBe("t2");
    expect(picked?.kind).toBe("transfer");
  });

  it("walks more than one link of the variant_of chain", async () => {
    const admin = fakeAdmin({
      items: rows,
      item_attempts: [attemptRow("t2", "2026-08-01T09:00:00Z")],
    });
    const picked = await selectTransferVariant(admin, "u1", "ratio-reasoning");
    expect(picked?.id).toBe("t1");
  });

  it("never returns an item outside the skill lineage", async () => {
    const admin = fakeAdmin({
      items: rows,
      item_attempts: [
        attemptRow("t1", "2026-08-01T09:00:00Z"),
        attemptRow("t2", "2026-08-01T09:00:00Z"),
        attemptRow("t3", "2026-08-01T09:00:00Z"),
      ],
    });
    expect(await selectTransferVariant(admin, "u1", "ratio-reasoning")).toBeNull();
  });

  it("never returns a non-transfer descendant", async () => {
    const admin = fakeAdmin({ items: [parent, nonTransferChild], item_attempts: [] });
    expect(await selectTransferVariant(admin, "u1", "ratio-reasoning")).toBeNull();
  });

  it("returns a client-safe item with no key on it", async () => {
    const admin = fakeAdmin({ items: rows, item_attempts: [] });
    const picked = await selectTransferVariant(admin, "u1", "ratio-reasoning");
    expect(Object.keys(picked ?? {}).sort()).toEqual([...PUBLIC_ITEM_FIELDS].sort());
  });
});

// ---------------------------------------------------------------------------
// A1 / A2 / N6 / N7 / N8 — the daily set
// ---------------------------------------------------------------------------

describe("selectDailySet", () => {
  const reviewA = item({ id: "r1", skill: "fractions" });
  const reviewB = item({ id: "r2", skill: "ratios" });
  const newA = item({ id: "n1", skill: "vectors", difficulty: 2 });
  const newB = item({ id: "n2", skill: "graphs", difficulty: 3 });
  const newC = item({ id: "n3", skill: "primes", difficulty: 4 });

  const base = {
    items: [reviewA, reviewB, newA, newB, newC],
    item_attempts: [
      attemptRow("r1", "2026-08-01T09:00:00Z"),
      attemptRow("r2", "2026-08-02T09:00:00Z"),
    ],
    reviews: [reviewRow("r1", "2026-08-01"), reviewRow("r2", TODAY), reviewRow("n3", "2026-09-01")],
  };

  it("puts due reviews first and leaves items not yet due alone", async () => {
    const set = await selectDailySet(fakeAdmin(base), "u1", { today: TODAY });
    expect(set.entries.slice(0, 2).map((e) => e.item.id)).toEqual(["r1", "r2"]);
    expect(set.entries.slice(0, 2).every((e) => e.source === "review")).toBe(true);
    expect(set.reviewCount).toBe(2);
    expect(set.entries[0].dueOn).toBe("2026-08-01");
    // n3 is scheduled for September, so it is a new item today, not a review.
    expect(set.entries.find((e) => e.item.id === "n3")?.source).toBe("new");
  });

  it("never repeats a skill back to back", async () => {
    const sameSkill = [
      item({ id: "s1", skill: "fractions", difficulty: 1 }),
      item({ id: "s2", skill: "fractions", difficulty: 2 }),
      item({ id: "s3", skill: "fractions", difficulty: 3 }),
      item({ id: "s4", skill: "ratios", difficulty: 1 }),
      item({ id: "s5", skill: "ratios", difficulty: 2 }),
      item({ id: "s6", skill: "areas", difficulty: 1 }),
    ];
    const set = await selectDailySet(
      fakeAdmin({ items: sameSkill, item_attempts: [], reviews: [] }),
      "u1",
      { today: TODAY },
    );
    expect(set.entries.length).toBeGreaterThan(3);
    for (let i = 1; i < set.entries.length; i += 1) {
      expect(set.entries[i].skill).not.toBe(set.entries[i - 1].skill);
    }
  });

  it("excludes items the user has already met from the new pool", async () => {
    const set = await selectDailySet(fakeAdmin(base), "u1", { today: TODAY });
    const newIds = set.entries.filter((e) => e.source === "new").map((e) => e.item.id);
    expect(newIds).not.toContain("r1");
    expect(newIds).not.toContain("r2");
  });

  it("includes a transfer item once the parent skill has been met (N6)", async () => {
    const parent = item({ id: "p1", skill: "fractions", kind: "reasoning" });
    const transfer = item({
      id: "tx",
      skill: "fractions-in-recipes",
      kind: "transfer",
      variant_of: "p1",
    });
    const set = await selectDailySet(
      fakeAdmin({
        items: [parent, transfer, newA, newB],
        item_attempts: [attemptRow("p1", "2026-08-01T09:00:00Z")],
        reviews: [],
      }),
      "u1",
      { today: TODAY },
    );
    const entry = set.entries.find((e) => e.item.id === "tx");
    expect(entry).toBeDefined();
    expect(entry?.source).toBe("transfer");
    expect(set.transferCount).toBe(1);
  });

  it("serves no transfer item to a user with no prior exposure", async () => {
    const transfer = item({ id: "tx2", skill: "fractions-in-recipes", kind: "transfer" });
    const set = await selectDailySet(
      fakeAdmin({ items: [transfer, newA, newB], item_attempts: [], reviews: [] }),
      "u1",
      { today: TODAY, includeTransfer: true },
    );
    expect(set.entries.some((e) => e.source === "transfer" && e.item.id === "tx2")).toBe(false);
  });

  it("stays inside the 5–10 minute budget and the size cap (A1)", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      item({ id: `m${i}`, skill: `skill-${i % 7}`, kind: "reasoning", difficulty: 8 }),
    );
    const set = await selectDailySet(
      fakeAdmin({ items: many, item_attempts: [], reviews: [] }),
      "u1",
      { today: TODAY, targetMinutes: 6, size: 20 },
    );
    expect(set.estimatedSeconds).toBeLessThanOrEqual(6 * 60);
    expect(set.entries.length).toBeLessThanOrEqual(12);
    expect(set.estimatedMinutes).toBeLessThanOrEqual(10);
  });

  it("hands the client public items only", async () => {
    const set = await selectDailySet(fakeAdmin(base), "u1", { today: TODAY });
    expect(set.entries.length).toBeGreaterThan(0);
    for (const entry of set.entries) {
      expect(Object.keys(entry.item).sort()).toEqual([...PUBLIC_ITEM_FIELDS].sort());
      const asRecord = entry.item as unknown as Record<string, unknown>;
      for (const field of SECRET_ITEM_FIELDS) expect(asRecord[field]).toBeUndefined();
    }
  });

  it("reports the read that failed rather than returning a silent empty set", async () => {
    const broken: ResearchAdmin = {
      from: () => ({
        select: () =>
          ({
            eq: () => broken.from("x").select(""),
            lte: () => broken.from("x").select(""),
            in: () => broken.from("x").select(""),
            order: () => broken.from("x").select(""),
            limit: () => broken.from("x").select(""),
            then: (onfulfilled, onrejected) =>
              Promise.resolve<{ data: unknown; error: { message: string } | null }>({
                data: null,
                error: { message: "relation \"items\" does not exist" },
              }).then(onfulfilled, onrejected),
          }) as ResearchQuery,
      }),
    };
    await expect(selectDailySet(broken, "u1", { today: TODAY })).rejects.toThrow(
      /does not exist/,
    );
  });
});

describe("estimateSeconds", () => {
  it("costs harder and longer item kinds more", () => {
    expect(estimateSeconds("retrieval", 1)).toBeLessThan(estimateSeconds("reasoning", 1));
    expect(estimateSeconds("reasoning", 1)).toBeLessThan(estimateSeconds("transfer", 1));
    expect(estimateSeconds("retrieval", 1)).toBeLessThan(estimateSeconds("retrieval", 10));
  });

  it("clamps difficulty to the 1–10 range the schema allows", () => {
    expect(estimateSeconds("retrieval", 0)).toBe(estimateSeconds("retrieval", 1));
    expect(estimateSeconds("retrieval", 99)).toBe(estimateSeconds("retrieval", 10));
  });
});

describe("isoDate", () => {
  it("formats a date as the schema's date column does", () => {
    expect(isoDate(new Date("2026-08-05T22:15:00Z"))).toBe("2026-08-05");
  });
});
