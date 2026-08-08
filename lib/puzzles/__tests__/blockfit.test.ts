import { describe, expect, it } from "vitest";
import { explain, generate, grade } from "../blockfit";
import type { BlockFitData } from "@/lib/types";

const SEEDS = ["alpha", "bravo", "charlie", "delta-9", "echo_42"];
const DIFFICULTIES = [1, 5, 10];

type Cell = [number, number];

// Reference implementation of the documented placement semantics, kept
// separate from the generator so the two are checked against each other.
function normalize(cells: Cell[]): Cell[] {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  return cells
    .map(([r, c]): Cell => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function rotateN(cells: Cell[], quarters: number): Cell[] {
  let out = normalize(cells);
  for (let i = 0; i < quarters % 4; i++)
    out = normalize(out.map(([r, c]): Cell => [c, -r]));
  return out;
}

function isConnected(cells: Cell[]): boolean {
  const key = ([r, c]: Cell) => `${r},${c}`;
  const all = new Set(cells.map(key));
  const queue: Cell[] = [cells[0]];
  const seen = new Set([key(cells[0])]);
  while (queue.length > 0) {
    const [r, c] = queue.pop() as Cell;
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const k = `${r + dr},${c + dc}`;
      if (all.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push([r + dr, c + dc]);
      }
    }
  }
  return seen.size === cells.length;
}

function countCompleteLines(filled: Set<string>, gridSize: number): number {
  let cleared = 0;
  for (let i = 0; i < gridSize; i++) {
    let rowFull = true;
    let colFull = true;
    for (let j = 0; j < gridSize; j++) {
      if (!filled.has(`${i},${j}`)) rowFull = false;
      if (!filled.has(`${j},${i}`)) colFull = false;
    }
    if (rowFull) cleared++;
    if (colFull) cleared++;
  }
  return cleared;
}

describe("blockfit generator", () => {
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
        const { data } = generate(seed, difficulty);
        expect(data.kind).toBe("blockfit");
        expect(data.gridSize).toBeGreaterThanOrEqual(6);
        expect(data.gridSize).toBeLessThanOrEqual(10);
        expect(data.pieces).toHaveLength(3);
        expect(data.targetLines).toBeGreaterThanOrEqual(1);
        expect(data.targetLines).toBeLessThanOrEqual(3);
        expect(data.rotatable).toBe(difficulty >= 4);

        const ids = new Set(data.pieces.map((p) => p.id));
        expect(ids.size).toBe(3);
        for (const piece of data.pieces) {
          expect(piece.cells.length).toBeGreaterThanOrEqual(3);
          expect(piece.cells.length).toBeLessThanOrEqual(5);
          expect(piece.color).toBeGreaterThanOrEqual(1);
          expect(piece.color).toBeLessThanOrEqual(6);
          expect(Number.isInteger(piece.color)).toBe(true);
          // Normalized: bounding box starts at (0, 0).
          expect(Math.min(...piece.cells.map(([r]) => r))).toBe(0);
          expect(Math.min(...piece.cells.map(([, c]) => c))).toBe(0);
          expect(isConnected(piece.cells as Cell[])).toBe(true);
        }
        for (const [r, c] of data.filled) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThan(data.gridSize);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThan(data.gridSize);
        }
        // The board must not start with a pre-cleared line.
        const initial = new Set(data.filled.map(([r, c]) => `${r},${c}`));
        expect(countCompleteLines(initial, data.gridSize)).toBe(0);
      });

      it(`${label}: canonical solution passes grade`, () => {
        const { solution } = generate(seed, difficulty);
        expect(grade(seed, difficulty, solution)).toBe(true);
      });

      it(`${label}: canonical placements simulate legally and clear the target`, () => {
        const { data, solution } = generate(seed, difficulty);
        const filled = new Set(data.filled.map(([r, c]) => `${r},${c}`));
        for (const pl of solution.placements) {
          const piece = data.pieces.find((p) => p.id === pl.pieceId);
          expect(piece).toBeDefined();
          if (!data.rotatable) expect(pl.rotation).toBe(0);
          const shape = rotateN((piece as BlockFitData["pieces"][number]).cells as Cell[], pl.rotation);
          for (const [dr, dc] of shape) {
            const r = pl.row + dr;
            const c = pl.col + dc;
            // In bounds, and no overlap with fills or earlier pieces.
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThan(data.gridSize);
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThan(data.gridSize);
            expect(filled.has(`${r},${c}`)).toBe(false);
            filled.add(`${r},${c}`);
          }
        }
        expect(countCompleteLines(filled, data.gridSize)).toBeGreaterThanOrEqual(
          data.targetLines,
        );
      });

      it(`${label}: wrong and malformed answers fail`, () => {
        const { data, solution } = generate(seed, difficulty);
        expect(grade(seed, difficulty, { placements: [] })).toBe(false);
        expect(grade(seed, difficulty, null)).toBe(false);
        expect(grade(seed, difficulty, "placements")).toBe(false);
        expect(grade(seed, difficulty, { placements: "x" })).toBe(false);
        expect(
          grade(seed, difficulty, {
            placements: [{ pieceId: 99, rotation: 0, row: 0, col: 0 }],
          }),
        ).toBe(false);
        expect(
          grade(seed, difficulty, {
            placements: [
              { pieceId: data.pieces[0].id, rotation: 0, row: 999, col: 0 },
            ],
          }),
        ).toBe(false);
        // Same piece twice is illegal even if the placements are otherwise fine.
        const dup = solution.placements[0];
        expect(grade(seed, difficulty, { placements: [dup, dup] })).toBe(false);
      });

      it(`${label}: explain returns a walkthrough`, () => {
        const text = explain(seed, difficulty);
        expect(text.length).toBeGreaterThan(40);
        expect(/row|column/.test(text)).toBe(true);
      });
    }
  }

  it("scales grid size with difficulty", () => {
    expect(generate("scale", 1).data.gridSize).toBe(6);
    expect(generate("scale", 10).data.gridSize).toBe(10);
  });

  it("rejects rotation when the puzzle is not rotatable", () => {
    const { data, solution } = generate("norotate", 1);
    expect(data.rotatable).toBe(false);
    const placements = solution.placements.map((pl, i) =>
      i === 0 ? { ...pl, rotation: 1 } : pl,
    );
    expect(grade("norotate", 1, { placements })).toBe(false);
  });

  it("accepts a valid non-canonical arrangement", () => {
    // Placing the pieces in reverse order is still legal and still clears.
    const { solution } = generate("reorder", 5);
    const placements = [...solution.placements].reverse();
    expect(grade("reorder", 5, { placements })).toBe(true);
  });
});
