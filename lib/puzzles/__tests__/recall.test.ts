import { describe, expect, it } from "vitest";
import { explain, generate, grade } from "../recall";

const SEEDS = ["anchor-a", "anchor-b", "anchor-c", "anchor-d", "anchor-e"];

describe("recall determinism", () => {
  it("returns identical puzzles for the same seed and difficulty", () => {
    for (const seed of SEEDS) {
      for (let d = 1; d <= 10; d++) {
        expect(generate(seed, d)).toEqual(generate(seed, d));
      }
    }
  });

  it("returns different puzzles for different seeds", () => {
    expect(generate("anchor-a", 3).data).not.toEqual(generate("anchor-b", 3).data);
    expect(generate("anchor-a", 8).data).not.toEqual(generate("anchor-b", 8).data);
  });
});

describe("recall sequence mode (difficulty 1-4)", () => {
  it("shapes the puzzle to spec", () => {
    for (const seed of SEEDS) {
      for (let d = 1; d <= 4; d++) {
        const { data } = generate(seed, d);
        if (data.mode !== "sequence") throw new Error("expected sequence mode");
        expect(data.gridSize).toBeGreaterThanOrEqual(3);
        expect(data.gridSize).toBeLessThanOrEqual(4);
        expect(data.sequence).toHaveLength(3 + d);
        expect(data.flashMs).toBeGreaterThanOrEqual(500);
        expect(data.flashMs).toBeLessThanOrEqual(900);
        const keys = new Set(data.sequence.map(([r, c]) => `${r}:${c}`));
        expect(keys.size).toBe(data.sequence.length); // all cells distinct
        for (const [r, c] of data.sequence) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThan(data.gridSize);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThan(data.gridSize);
        }
      }
    }
  });

  it("speeds up the flash as difficulty rises", () => {
    const flashAt = (d: number) => {
      const { data } = generate("anchor-a", d);
      if (data.mode !== "sequence") throw new Error("expected sequence mode");
      return data.flashMs;
    };
    expect(flashAt(1)).toBe(900);
    expect(flashAt(4)).toBe(500);
    expect(flashAt(2)).toBeLessThan(flashAt(1));
    expect(flashAt(3)).toBeLessThan(flashAt(2));
  });

  it("grades the canonical solution as correct", () => {
    for (const seed of SEEDS) {
      for (const d of [1, 2, 3, 4]) {
        const { solution } = generate(seed, d);
        expect(grade(seed, d, solution)).toBe(true);
      }
    }
  });

  it("rejects wrong or malformed answers", () => {
    const seed = "anchor-a";
    const { solution } = generate(seed, 2);
    if (solution.mode !== "sequence") throw new Error("expected sequence mode");
    expect(grade(seed, 2, { mode: "sequence", cells: [...solution.cells].reverse() })).toBe(false);
    expect(grade(seed, 2, { mode: "sequence", cells: solution.cells.slice(1) })).toBe(false);
    expect(grade(seed, 2, { mode: "sequence", cells: [] })).toBe(false);
    expect(grade(seed, 2, { mode: "sequence" })).toBe(false);
    expect(grade(seed, 2, null)).toBe(false);
    expect(grade(seed, 2, "cells")).toBe(false);
    expect(grade(seed, 2, { mode: "nback", flagged: [1, 2] })).toBe(false);
  });
});

describe("recall n-back mode (difficulty 5-10)", () => {
  it("shapes the puzzle to spec", () => {
    for (const seed of SEEDS) {
      for (let d = 5; d <= 10; d++) {
        const { data, solution } = generate(seed, d);
        if (data.mode !== "nback" || solution.mode !== "nback") {
          throw new Error("expected nback mode");
        }
        expect(data.n).toBe(d <= 7 ? 2 : 3);
        expect(data.stream.length).toBeGreaterThanOrEqual(12);
        expect(data.stream.length).toBeLessThanOrEqual(24);
        expect(data.stepMs).toBeGreaterThanOrEqual(1200);
        expect(data.stepMs).toBeLessThanOrEqual(2000);
        for (const s of data.stream) expect(s).toMatch(/^[A-Z]$/);

        // flagged is exactly the set of true matches in the stream
        const expected: number[] = [];
        for (let i = data.n; i < data.stream.length; i++) {
          if (data.stream[i] === data.stream[i - data.n]) expected.push(i);
        }
        expect(solution.flagged).toEqual(expected);

        // match rate sits in the tuned band
        const rate = expected.length / (data.stream.length - data.n);
        expect(rate).toBeGreaterThanOrEqual(0.2);
        expect(rate).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it("scales stream length and speed with difficulty", () => {
    const at = (d: number) => {
      const { data } = generate("anchor-b", d);
      if (data.mode !== "nback") throw new Error("expected nback mode");
      return data;
    };
    expect(at(5).stream).toHaveLength(12);
    expect(at(5).stepMs).toBe(2000);
    expect(at(10).stream).toHaveLength(24);
    expect(at(10).stepMs).toBe(1200);
  });

  it("grades flagged indices as a set", () => {
    const seed = "anchor-c";
    const { solution } = generate(seed, 7);
    if (solution.mode !== "nback") throw new Error("expected nback mode");
    expect(grade(seed, 7, solution)).toBe(true);
    // order does not matter
    expect(
      grade(seed, 7, { mode: "nback", flagged: [...solution.flagged].reverse() }),
    ).toBe(true);
    // duplicate flags of a correct index collapse
    expect(
      grade(seed, 7, {
        mode: "nback",
        flagged: [...solution.flagged, solution.flagged[0]],
      }),
    ).toBe(true);
  });

  it("rejects wrong or malformed answers", () => {
    const seed = "anchor-d";
    const { data, solution } = generate(seed, 6);
    if (data.mode !== "nback" || solution.mode !== "nback") {
      throw new Error("expected nback mode");
    }
    expect(grade(seed, 6, { mode: "nback", flagged: [] })).toBe(false);
    expect(
      grade(seed, 6, { mode: "nback", flagged: solution.flagged.slice(1) }),
    ).toBe(false);
    let extra = data.n;
    while (solution.flagged.includes(extra)) extra++;
    expect(
      grade(seed, 6, { mode: "nback", flagged: [...solution.flagged, extra] }),
    ).toBe(false);
    expect(grade(seed, 6, { mode: "nback", flagged: "1,2" })).toBe(false);
    expect(grade(seed, 6, { mode: "nback", flagged: [1.5] })).toBe(false);
    expect(grade(seed, 6, { mode: "nback", flagged: ["2"] })).toBe(false);
    expect(grade(seed, 6, undefined)).toBe(false);
    expect(grade(seed, 6, 42)).toBe(false);
  });
});

describe("recall explain", () => {
  it("describes the sequence order", () => {
    const text = explain("anchor-a", 2);
    expect(text).toContain("row");
    expect(text).toContain("col");
    expect(text.length).toBeGreaterThan(20);
  });

  it("lists the matching steps for n-back", () => {
    const { data, solution } = generate("anchor-a", 8);
    if (data.mode !== "nback" || solution.mode !== "nback") {
      throw new Error("expected nback mode");
    }
    const text = explain("anchor-a", 8);
    expect(text).toContain(`n = ${data.n}`);
    for (const i of solution.flagged) {
      expect(text).toContain(`step ${i + 1}`);
    }
  });
});
