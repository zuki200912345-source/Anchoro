import { describe, expect, it } from "vitest";
import {
  buildDailySlots,
  buildPracticeSlots,
  cognitiveScore,
  effectiveScore,
  eloUpdate,
  expectedScore,
  targetDifficulty,
  typesForCategory,
} from "../engine";
import { CATEGORIES, type Category } from "../types";

const flatRatings = Object.fromEntries(
  CATEGORIES.map((c) => [c, 1000]),
) as Record<Category, number>;

describe("elo", () => {
  it("expected score is 0.5 against an equal-rated puzzle", () => {
    // rating 1000 vs difficulty (1000-800)/60 ≈ 3.33 — use exact match at 980
    expect(expectedScore(980, 3)).toBeCloseTo(0.5, 5);
  });

  it("win gains, loss costs, K=32", () => {
    const up = eloUpdate({
      rating: 980,
      difficulty: 3,
      correct: true,
      hintTiersUsed: [],
      fasterThanMedian: false,
    });
    const down = eloUpdate({
      rating: 980,
      difficulty: 3,
      correct: false,
      hintTiersUsed: [],
      fasterThanMedian: false,
    });
    expect(up).toBe(996); // +16
    expect(down).toBe(964); // -16
  });

  it("hints reduce the win value by tier cost", () => {
    expect(
      effectiveScore({ correct: true, hintTiersUsed: [1], fasterThanMedian: false }),
    ).toBeCloseTo(0.85);
    expect(
      effectiveScore({ correct: true, hintTiersUsed: [1, 2, 3], fasterThanMedian: false }),
    ).toBeCloseTo(0.05);
  });

  it("speed bonus adds 0.1 capped at 1.0 and never rescues a miss", () => {
    expect(
      effectiveScore({ correct: true, hintTiersUsed: [], fasterThanMedian: true }),
    ).toBe(1);
    expect(
      effectiveScore({ correct: true, hintTiersUsed: [1], fasterThanMedian: true }),
    ).toBeCloseTo(0.95);
    expect(
      effectiveScore({ correct: false, hintTiersUsed: [], fasterThanMedian: true }),
    ).toBe(0);
  });
});

describe("difficulty targeting", () => {
  it("lands the expected win rate in 0.60–0.75 for realistic ratings", () => {
    for (let rating = 700; rating <= 1600; rating += 50) {
      const d = targetDifficulty(rating);
      const e = expectedScore(rating, d);
      // At the rating extremes the clamp to 1..10 binds; inside it, the
      // window must hold.
      if (d > 1 && d < 10) {
        expect(e).toBeGreaterThanOrEqual(0.6);
        expect(e).toBeLessThanOrEqual(0.75);
      }
    }
  });
});

describe("slot building", () => {
  it("gives 3 slots to the two weakest categories and 5 total", () => {
    const ratings = { ...flatRatings, memory: 850, logic: 900 };
    const slots = buildDailySlots(ratings, "test-seed");
    expect(slots).toHaveLength(5);
    const memoryAndLogic = slots.filter(
      (s) => s.category === "memory" || s.category === "logic",
    );
    expect(memoryAndLogic).toHaveLength(3);
    expect(slots.filter((s) => s.category === "memory")).toHaveLength(2);
  });

  it("never serves the same type back to back", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g"]) {
      const slots = buildDailySlots(
        { ...flatRatings, memory: 800, mental_math: 820 },
        seed,
      );
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i].type).not.toBe(slots[i - 1].type);
      }
    }
  });

  it("category-type mapping only serves categories a type carries", () => {
    const slots = buildDailySlots(flatRatings, "map-check");
    for (const slot of slots) {
      expect(typesForCategory(slot.category)).toContain(slot.type);
    }
  });

  it("practice slots fix the category and difficulty", () => {
    const slots = buildPracticeSlots("pattern", 7);
    expect(slots).toHaveLength(5);
    for (const s of slots) {
      expect(s.category).toBe("pattern");
      expect(s.difficulty).toBe(7);
    }
  });
});

describe("cognitive score", () => {
  it("weights recently-tested categories more", () => {
    const now = new Date("2026-08-04T12:00:00Z");
    const fresh = { rating: 1400, updated_at: "2026-08-04T11:00:00Z" };
    const stale = { rating: 800, updated_at: "2026-07-01T00:00:00Z" };
    const score = cognitiveScore([fresh, stale], now);
    // Weighted mean should sit much closer to the fresh 1400 than a plain
    // mean (1100 → 500 on the display scale).
    expect(score).toBeGreaterThan(600);
    expect(score).toBeLessThanOrEqual(1000);
  });

  it("clamps to 0..1000", () => {
    const now = new Date();
    const iso = now.toISOString();
    expect(cognitiveScore([{ rating: 2000, updated_at: iso }], now)).toBe(1000);
    expect(cognitiveScore([{ rating: 100, updated_at: iso }], now)).toBe(0);
  });
});
