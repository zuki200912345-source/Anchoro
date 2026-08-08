import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_PASS_MARK,
  gradeAnswer,
  isLowEffort,
  lowEffortReason,
  normaliseExpression,
  parseNumber,
  rubricBreakdown,
  splitList,
  type GradableItem,
  type RubricKey,
} from "../grader";
import {
  SEED_ITEMS,
  SEED_ITEM_COUNT,
  SEED_SUBJECTS,
  SEED_YEAR_GROUPS,
  interleave,
  itemId,
  itemsBySkill,
  toItemRow,
  type SeedItem,
} from "../seed-items";

const gradable = (item: SeedItem): GradableItem => ({
  stem: item.stem,
  answer_key: item.answerKey,
  distractors: item.distractors,
});

const byRef = (ref: string): SeedItem => {
  const item = SEED_ITEMS.find((i) => i.ref === ref);
  if (!item) throw new Error(`no seed item with ref ${ref}`);
  return item;
};

// ---------------------------------------------------------------------------
// The keys themselves. A wrong key poisons grading, hint grounding and
// feedback at the same time, so every one is exercised (A4, I3).
// ---------------------------------------------------------------------------

describe("every verified key accepts its own answer", () => {
  it.each(SEED_ITEMS.map((item) => [item.ref, item] as const))(
    "%s grades its canonical answer correct",
    (_ref, item) => {
      const result = gradeAnswer(gradable(item), item.canonicalAnswer);
      expect(result.outcome).toBe("correct");
      expect(result.matchedKey).toBe(true);
      expect(result.partialCredit).toBeGreaterThanOrEqual(item.answerKey.type === "rubric" ? 0.6 : 1);
    },
  );

  it.each(SEED_ITEMS.map((item) => [item.ref, item] as const))(
    "%s rejects its near miss",
    (_ref, item) => {
      const result = gradeAnswer(gradable(item), item.nearMissAnswer);
      expect(result.outcome).toBe("incorrect");
      expect(result.matchedKey).toBe(false);
    },
  );
});

describe("bank coverage", () => {
  it("holds at least 60 items", () => {
    expect(SEED_ITEM_COUNT).toBeGreaterThanOrEqual(60);
    expect(SEED_ITEMS).toHaveLength(SEED_ITEM_COUNT);
  });

  it("covers every subject", () => {
    for (const subject of SEED_SUBJECTS) {
      expect(SEED_ITEMS.some((i) => i.subject === subject)).toBe(true);
    }
  });

  it("covers year groups 9 to 13", () => {
    for (const year of SEED_YEAR_GROUPS) {
      expect(SEED_ITEMS.some((i) => i.yearGroup === year)).toBe(true);
    }
  });

  it("covers all four item kinds", () => {
    for (const kind of ["retrieval", "reasoning", "transfer", "practice"] as const) {
      expect(SEED_ITEMS.some((i) => i.kind === kind)).toBe(true);
    }
  });

  it("spans difficulty 1 to 10 and stays inside the check constraint", () => {
    const seen = new Set(SEED_ITEMS.map((i) => i.difficulty));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(10)).toBe(true);
    for (const item of SEED_ITEMS) {
      expect(item.difficulty).toBeGreaterThanOrEqual(1);
      expect(item.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it("gives every item a worked solution and at least one tagged misconception", () => {
    for (const item of SEED_ITEMS) {
      expect(item.workedSolution.length).toBeGreaterThan(20);
      const tags = Object.keys(item.misconceptions);
      expect(tags.length).toBeGreaterThanOrEqual(1);
      for (const tag of tags) {
        expect(tag).toMatch(/^[a-z0-9_]+$/);
        expect(item.misconceptions[tag].length).toBeGreaterThan(10);
      }
    }
  });

  it("links every transfer item to a parent in the same skill", () => {
    const transfers = SEED_ITEMS.filter((i) => i.kind === "transfer");
    expect(transfers.length).toBeGreaterThanOrEqual(5);
    for (const item of transfers) {
      expect(item.variantOf).not.toBeNull();
      const parent = SEED_ITEMS.find((i) => i.id === item.variantOf);
      expect(parent, `${item.ref} points at a missing parent`).toBeDefined();
      expect(parent?.skill).toBe(item.skill);
      expect(parent?.id).not.toBe(item.id);
    }
  });

  it("gives multiple choice items an option list that contains the key index", () => {
    for (const item of SEED_ITEMS) {
      if (item.answerKey.type !== "choice") continue;
      expect(item.distractors).not.toBeNull();
      expect(item.answerKey.index).toBeGreaterThanOrEqual(0);
      expect(item.answerKey.index).toBeLessThan(item.distractors?.length ?? 0);
    }
  });

  it("uses stable, unique ids derived from the ref slug", () => {
    expect(new Set(SEED_ITEMS.map((i) => i.id)).size).toBe(SEED_ITEM_COUNT);
    expect(new Set(SEED_ITEMS.map((i) => i.ref)).size).toBe(SEED_ITEM_COUNT);
    for (const item of SEED_ITEMS) {
      expect(item.id).toBe(itemId(item.ref));
      expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("marks every seeded item verified and authored", () => {
    for (const item of SEED_ITEMS) {
      expect(item.verified).toBe(true);
      expect(item.source).toBe("authored");
    }
  });
});

describe("interleaving support (N7)", () => {
  it("tags enough distinct skills to alternate", () => {
    expect(itemsBySkill().size).toBeGreaterThanOrEqual(20);
  });

  it("keeps every item and avoids repeating a skill back to back where it can", () => {
    const sample = SEED_ITEMS.slice(0, 20);
    const mixed = interleave(sample);
    expect(mixed).toHaveLength(sample.length);
    expect(new Set(mixed.map((i) => i.id)).size).toBe(sample.length);

    let repeats = 0;
    for (let i = 1; i < mixed.length; i++) {
      if (mixed[i].skill === mixed[i - 1].skill) repeats++;
    }
    expect(repeats).toBe(0);
  });

  it("is deterministic", () => {
    const a = interleave(SEED_ITEMS.slice(0, 30)).map((i) => i.id);
    const b = interleave(SEED_ITEMS.slice(0, 30)).map((i) => i.id);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

describe("numeric grading", () => {
  const freeFall = byRef("physics-free-fall-1"); // 44.1, tolerance 0.05
  const moles = byRef("chem-moles-1"); // 0.2, tolerance 0.005
  const heat = byRef("physics-specific-heat-1"); // 126000

  it("accepts inside the tolerance and rejects outside it", () => {
    expect(gradeAnswer(gradable(freeFall), "44.12").outcome).toBe("correct");
    expect(gradeAnswer(gradable(freeFall), "44.05").outcome).toBe("correct");
    expect(gradeAnswer(gradable(freeFall), "44.5").outcome).toBe("incorrect");
  });

  it("reads a fraction as a number", () => {
    expect(parseNumber("3/4")).toBeCloseTo(0.75);
    expect(parseNumber("2 1/2")).toBeCloseTo(2.5);
    expect(parseNumber("-3/4")).toBeCloseTo(-0.75);
    expect(gradeAnswer(gradable(moles), "1/5").outcome).toBe("correct");
  });

  it("reads decimals, units, currency and thousands separators", () => {
    expect(parseNumber("0.2 mol")).toBeCloseTo(0.2);
    expect(parseNumber("12 cm")).toBe(12);
    expect(parseNumber("£78.20")).toBeCloseTo(78.2);
    expect(parseNumber("126,000")).toBe(126000);
    expect(parseNumber("x = 6")).toBe(6);
    expect(gradeAnswer(gradable(heat), "126,000 J").outcome).toBe("correct");
  });

  it("reads a unicode minus", () => {
    expect(parseNumber("−2")).toBe(-2);
    expect(gradeAnswer(gradable(byRef("maths-log-equation-1")), "−1").outcome).toBe("incorrect");
  });

  it("reads standard form", () => {
    expect(parseNumber("4.2e-4")).toBeCloseTo(0.00042);
    expect(parseNumber("4.2 x 10^-4")).toBeCloseTo(0.00042);
    expect(parseNumber("4.2 × 10^-4")).toBeCloseTo(0.00042);
  });

  it("refuses what it cannot read rather than guessing", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("about half")).toBeNull();
    expect(parseNumber("1/2/3")).toBeNull();
    expect(parseNumber("3^")).toBeNull();
  });

  it("does not accept the right digits with the wrong magnitude", () => {
    expect(gradeAnswer(gradable(heat), "12600").outcome).toBe("incorrect");
    expect(gradeAnswer(gradable(moles), "2").outcome).toBe("incorrect");
  });
});

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

describe("expression grading", () => {
  const indices = byRef("maths-index-laws-1"); // 12x^7
  const derivative = byRef("maths-differentiate-1"); // 12x^3-4x
  const standardForm = byRef("maths-standard-form-1"); // 4.2×10^-4
  const surds = byRef("maths-surds-1"); // 8√2

  it("ignores whitespace", () => {
    expect(gradeAnswer(gradable(indices), "  12x^7  ").outcome).toBe("correct");
    expect(gradeAnswer(gradable(derivative), "12x^3 - 4x").outcome).toBe("correct");
  });

  it("treats ×, x and * as the same multiply", () => {
    expect(normaliseExpression("4.2 × 10^-4")).toBe(normaliseExpression("4.2 x 10^-4"));
    expect(normaliseExpression("4.2*10^-4")).toBe(normaliseExpression("4.2 × 10^-4"));
    for (const written of ["4.2 × 10^-4", "4.2 x 10^-4", "4.2*10^-4", "4.2·10^-4"]) {
      expect(gradeAnswer(gradable(standardForm), written).outcome).toBe("correct");
    }
  });

  it("treats ÷ and / as the same divide", () => {
    expect(normaliseExpression("6÷2")).toBe(normaliseExpression("6/2"));
  });

  it("normalises a unicode minus", () => {
    expect(gradeAnswer(gradable(standardForm), "4.2 × 10^−4").outcome).toBe("correct");
    expect(gradeAnswer(gradable(derivative), "12x^3 − 4x").outcome).toBe("correct");
  });

  it("accepts the terms of a sum in either order", () => {
    expect(gradeAnswer(gradable(derivative), "-4x + 12x^3").outcome).toBe("correct");
  });

  it("accepts sqrt spelled out", () => {
    expect(gradeAnswer(gradable(surds), "8sqrt2").outcome).toBe("correct");
    expect(gradeAnswer(gradable(surds), "8 sqrt(2)").outcome).toBe("correct");
  });

  it("strips a leading y = when the key is bare", () => {
    expect(gradeAnswer(gradable(derivative), "dy/dx = 12x^3 - 4x").outcome).toBe("correct");
  });

  it("does not accept a bare number for a symbolic key", () => {
    expect(gradeAnswer(gradable(surds), "8").outcome).toBe("incorrect");
    expect(gradeAnswer(gradable(indices), "12").outcome).toBe("incorrect");
  });
});

// ---------------------------------------------------------------------------
// Sets, choices, exact strings
// ---------------------------------------------------------------------------

describe("set grading", () => {
  const roots = byRef("maths-quadratic-roots-1"); // unordered {3, 4}
  const pair = byRef("maths-simultaneous-1"); // ordered [3, 2]

  it("ignores order when the key is unordered", () => {
    expect(gradeAnswer(gradable(roots), "4, 3").outcome).toBe("correct");
    expect(gradeAnswer(gradable(roots), "3 and 4").outcome).toBe("correct");
    expect(gradeAnswer(gradable(roots), "x = 3, x = 4").outcome).toBe("correct");
  });

  it("keeps order when the key is ordered", () => {
    expect(gradeAnswer(gradable(pair), "3, 2").outcome).toBe("correct");
    expect(gradeAnswer(gradable(pair), "2, 3").outcome).toBe("incorrect");
  });

  it("gives partial credit for a half-right list", () => {
    const half = gradeAnswer(gradable(pair), "3, 5");
    expect(half.outcome).toBe("partial");
    expect(half.partialCredit).toBeCloseTo(0.5);
    expect(half.matchedKey).toBe(false);
  });

  it("splits on commas, semicolons and joining words", () => {
    expect(splitList("3, 4")).toEqual(["3", "4"]);
    expect(splitList("3 and 4")).toEqual(["3", "4"]);
    expect(splitList("3; 4")).toEqual(["3", "4"]);
  });
});

describe("choice grading", () => {
  const separation = byRef("chem-separation-1"); // index 1 of 4

  it("accepts the option text, the letter and the number", () => {
    expect(gradeAnswer(gradable(separation), "Crystallisation").outcome).toBe("correct");
    expect(gradeAnswer(gradable(separation), "crystallisation").outcome).toBe("correct");
    expect(gradeAnswer(gradable(separation), "b").outcome).toBe("correct");
    expect(gradeAnswer(gradable(separation), "B").outcome).toBe("correct");
    expect(gradeAnswer(gradable(separation), "2").outcome).toBe("correct");
    expect(gradeAnswer(gradable(separation), "b) Crystallisation").outcome).toBe("correct");
  });

  it("rejects the other options", () => {
    expect(gradeAnswer(gradable(separation), "Filtration").outcome).toBe("incorrect");
    expect(gradeAnswer(gradable(separation), "a").outcome).toBe("incorrect");
    expect(gradeAnswer(gradable(separation), "4").outcome).toBe("incorrect");
  });
});

describe("exact grading", () => {
  const formula = byRef("chem-ionic-formula-1"); // MgCl2
  const cell = byRef("bio-antibody-cell-1"); // lymphocyte + alternates

  it("ignores case, trailing punctuation and unicode subscripts", () => {
    expect(gradeAnswer(gradable(formula), "mgcl2").outcome).toBe("correct");
    expect(gradeAnswer(gradable(formula), "MgCl₂").outcome).toBe("correct");
    expect(gradeAnswer(gradable(cell), "Lymphocyte.").outcome).toBe("correct");
  });

  it("accepts the listed alternates and nothing else", () => {
    expect(gradeAnswer(gradable(cell), "B cells").outcome).toBe("correct");
    expect(gradeAnswer(gradable(cell), "plasma cell").outcome).toBe("correct");
    expect(gradeAnswer(gradable(cell), "red blood cell").outcome).toBe("incorrect");
  });
});

// ---------------------------------------------------------------------------
// Rubrics
// ---------------------------------------------------------------------------

describe("rubric grading", () => {
  const rates = byRef("chem-rates-explain-1"); // three criteria, pass mark 0.6

  it("passes an answer that meets enough criteria", () => {
    const result = gradeAnswer(gradable(rates), "The particles move faster and collide more often.");
    expect(result.outcome).toBe("correct");
    expect(result.partialCredit).toBeCloseTo(2 / 3);
  });

  it("gives partial credit for one criterion", () => {
    const result = gradeAnswer(gradable(rates), "They collide more often than before.");
    expect(result.outcome).toBe("partial");
    expect(result.partialCredit).toBeCloseTo(1 / 3);
  });

  it("reports which criteria were met, for grounded feedback", () => {
    const breakdown = rubricBreakdown(
      rates.answerKey as RubricKey,
      "They collide more often than before.",
    );
    expect(breakdown).toEqual([
      { id: "collision_frequency", met: true },
      { id: "particle_speed", met: false },
      { id: "activation_energy", met: false },
    ]);
  });

  it("matches keywords on word boundaries, not substrings", () => {
    const result = gradeAnswer(gradable(rates), "Nothing here about reacting at all.");
    expect(result.outcome).toBe("incorrect");
    expect(result.partialCredit).toBe(0);
  });

  it("uses the default pass mark when a key does not set one", () => {
    const key: RubricKey = {
      type: "rubric",
      criteria: [
        { id: "a", weight: 1, keywords: ["alpha"] },
        { id: "b", weight: 1, keywords: ["beta"] },
      ],
    };
    const item: GradableItem = { stem: "Say both words.", answer_key: key };
    expect(DEFAULT_PASS_MARK).toBe(0.8);
    expect(gradeAnswer(item, "alpha and beta").outcome).toBe("correct");
    expect(gradeAnswer(item, "alpha only").outcome).toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// Low effort (B7, B14)
// ---------------------------------------------------------------------------

describe("low-effort detection", () => {
  const linear = byRef("maths-linear-solve-1");
  const resistance = byRef("bio-antibiotic-resistance-1");

  it("catches an empty attempt", () => {
    expect(lowEffortReason("")).toBe("empty");
    expect(lowEffortReason("   ")).toBe("empty");
    expect(gradeAnswer(gradable(linear), "").outcome).toBe("low_effort");
  });

  it("catches an attempt under two characters", () => {
    expect(lowEffortReason("a")).toBe("too_short");
    expect(isLowEffort("a")).toBe(true);
    expect(isLowEffort("ab")).toBe(false);
  });

  it("catches a repeat of an earlier attempt", () => {
    expect(lowEffortReason("12", ["12"])).toBe("duplicate");
    expect(lowEffortReason("12 ", ["  12"])).toBe("duplicate");
    expect(gradeAnswer(gradable(linear), "9.5", ["9.5"]).outcome).toBe("low_effort");
    expect(gradeAnswer(gradable(linear), "9.5", ["7"]).outcome).toBe("incorrect");
  });

  it("catches an echo of the stem", () => {
    expect(lowEffortReason(resistance.stem, [], resistance.stem)).toBe("stem_echo");
    expect(
      lowEffortReason("a population of bacteria becomes resistant", [], resistance.stem),
    ).toBe("stem_echo");
    expect(gradeAnswer(gradable(resistance), resistance.stem).outcome).toBe("low_effort");
  });

  it("lets a real attempt through", () => {
    expect(lowEffortReason("The boy broke the window", [], "Rewrite in the active voice.")).toBeNull();
    expect(isLowEffort(resistance.canonicalAnswer, [], resistance.stem)).toBe(false);
  });

  it("never calls a correct answer low effort", () => {
    // Right answer, submitted twice: still correct.
    expect(gradeAnswer(gradable(linear), "6", ["6"]).outcome).toBe("correct");
    // One character is a real answer to a numeric or choice item.
    expect(gradeAnswer(gradable(linear), "8").outcome).toBe("incorrect");
    expect(gradeAnswer(gradable(byRef("chem-separation-1")), "a").outcome).toBe("incorrect");
  });
});

// ---------------------------------------------------------------------------
// The SQL seed and the TypeScript bank must not drift apart
// ---------------------------------------------------------------------------

describe("supabase/seed/items.sql", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/seed/items.sql"), "utf8");
  const rowIds = [...sql.matchAll(/\n {2}\('([0-9a-f-]{36})',/g)].map((m) => m[1]);

  it("inserts exactly the items in the TypeScript bank", () => {
    expect(rowIds).toHaveLength(SEED_ITEM_COUNT);
    expect(new Set(rowIds)).toEqual(new Set(SEED_ITEMS.map((i) => i.id)));
  });

  it("is idempotent", () => {
    expect(sql).toContain("on conflict (id) do nothing;");
  });

  it("lists every parent before the transfer item that references it", () => {
    const position = new Map(rowIds.map((id, index) => [id, index]));
    for (const item of SEED_ITEMS) {
      if (!item.variantOf) continue;
      const parentAt = position.get(item.variantOf);
      const childAt = position.get(item.id);
      expect(parentAt).toBeDefined();
      expect(childAt).toBeDefined();
      expect(parentAt as number).toBeLessThan(childAt as number);
    }
  });

  it("carries the answer key and worked solution for the first item", () => {
    const first = SEED_ITEMS[0];
    const row = toItemRow(first);
    expect(sql).toContain(`'${JSON.stringify(row.answer_key)}'::jsonb`);
    expect(sql).toContain(row.worked_solution.replace(/'/g, "''"));
  });

  it("escapes apostrophes so the statement parses", () => {
    const singles = (sql.match(/'/g) ?? []).length;
    expect(singles % 2).toBe(0);
  });
});
