import { describe, expect, it } from "vitest";
import { explain, generate, grade } from "../ruleshift";
import type { ColorGrid } from "@/lib/types";

const SEEDS = ["alpha", "bravo", "charlie", "delta-9", "echo_42"];
const DIFFICULTIES = [1, 5, 10];

const sizeFor = (d: number) => (d <= 3 ? 3 : d <= 6 ? 4 : 5);

function expectSquareGrid(g: ColorGrid, n: number) {
  expect(g).toHaveLength(n);
  for (const row of g) {
    expect(row).toHaveLength(n);
    for (const v of row) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(6);
    }
  }
}

describe("ruleshift generator", () => {
  for (const difficulty of DIFFICULTIES) {
    for (const seed of SEEDS) {
      const label = `d${difficulty} seed=${seed}`;

      it(`${label}: deterministic for the same seed`, () => {
        const a = generate(seed, difficulty);
        const b = generate(seed, difficulty);
        expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
        expect(JSON.stringify(a.solution)).toBe(JSON.stringify(b.solution));
        expect(explain(seed, difficulty)).toBe(explain(seed, difficulty));
      });

      it(`${label}: well-formed data`, () => {
        const { data, solution } = generate(seed, difficulty);
        const n = sizeFor(difficulty);
        expect(data.kind).toBe("ruleshift");
        expect(data.examples.length).toBeGreaterThanOrEqual(2);
        expect(data.examples.length).toBeLessThanOrEqual(3);
        for (const ex of data.examples) {
          expectSquareGrid(ex.input, n);
          expectSquareGrid(ex.output, n);
          // A worked example where nothing changes teaches nothing.
          expect(JSON.stringify(ex.output)).not.toBe(JSON.stringify(ex.input));
        }
        expectSquareGrid(data.test, n);
        expect(data.candidates).toHaveLength(4);
        for (const cand of data.candidates) expectSquareGrid(cand, n);
        // Exactly one correct answer means all four must be distinct.
        const unique = new Set(data.candidates.map((c) => JSON.stringify(c)));
        expect(unique.size).toBe(4);
        expect(Number.isInteger(solution.choice)).toBe(true);
        expect(solution.choice).toBeGreaterThanOrEqual(0);
        expect(solution.choice).toBeLessThanOrEqual(3);
      });

      it(`${label}: grade accepts the solution and rejects the rest`, () => {
        const { solution } = generate(seed, difficulty);
        expect(grade(seed, difficulty, solution)).toBe(true);
        for (let offset = 1; offset < 4; offset++) {
          expect(
            grade(seed, difficulty, { choice: (solution.choice + offset) % 4 }),
          ).toBe(false);
        }
      });

      it(`${label}: grade survives malformed answers`, () => {
        expect(grade(seed, difficulty, null)).toBe(false);
        expect(grade(seed, difficulty, undefined)).toBe(false);
        expect(grade(seed, difficulty, {})).toBe(false);
        expect(grade(seed, difficulty, { choice: "1" })).toBe(false);
        expect(grade(seed, difficulty, { choice: -1 })).toBe(false);
        expect(grade(seed, difficulty, { choice: 4 })).toBe(false);
        expect(grade(seed, difficulty, { choice: 1.5 })).toBe(false);
        expect(grade(seed, difficulty, 2)).toBe(false);
      });

      it(`${label}: explain names the rule and the option`, () => {
        const { solution } = generate(seed, difficulty);
        const text = explain(seed, difficulty);
        expect(text.length).toBeGreaterThan(40);
        expect(text).toContain(`option ${solution.choice + 1}`);
      });
    }
  }

  it("scales grid size with difficulty", () => {
    expect(generate("scale", 1).data.test).toHaveLength(3);
    expect(generate("scale", 5).data.test).toHaveLength(4);
    expect(generate("scale", 10).data.test).toHaveLength(5);
  });

  it("spreads the correct answer across positions", () => {
    // Not always slot 0: over many seeds the shuffle should hit several slots.
    const positions = new Set<number>();
    for (let i = 0; i < 20; i++)
      positions.add(generate(`spread-${i}`, 5).solution.choice);
    expect(positions.size).toBeGreaterThan(1);
  });
});
