// BlockFit generator. Server-side, pure, deterministic.
//
// Construction works backwards from the answer: pick a band of target lines,
// grow three connected pieces inside (and slightly out of) that band, pre-fill
// the rest of the band, scatter harmless filled cells elsewhere, and record
// the reverse placements as the canonical solution. Solvability is guaranteed
// by construction. grade() simulates any submitted arrangement, so every
// valid clear counts, not just the canonical one.
//
// Placement semantics (shared with the UI): a placement puts the piece's
// bounding-box top-left at (row, col) after rotating the tray shape by
// `rotation` quarter turns clockwise.

import { createRng, type Rng } from "@/lib/rng";
import type {
  BlockFitAnswer,
  BlockFitData,
  BlockFitPiece,
  BlockFitPlacement,
} from "@/lib/types";

type Cell = [number, number];

// ---------------------------------------------------------------------------
// Cell-set helpers
// ---------------------------------------------------------------------------

function normalize(cells: Cell[]): Cell[] {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  return cells
    .map(([r, c]): Cell => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// One quarter turn clockwise, re-normalized. rot^4 === identity.
function rotateCW(cells: Cell[]): Cell[] {
  return normalize(cells.map(([r, c]): Cell => [c, -r]));
}

function rotateN(cells: Cell[], quarters: number): Cell[] {
  let out = normalize(cells);
  for (let i = 0; i < ((quarters % 4) + 4) % 4; i++) out = rotateCW(out);
  return out;
}

const keyOf = (r: number, c: number) => r * 64 + c;

const NEIGHBORS: Cell[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// ---------------------------------------------------------------------------
// Difficulty scaling
// ---------------------------------------------------------------------------

function params(difficulty: number) {
  const d = Math.max(1, Math.min(10, Math.floor(difficulty)));
  return {
    d,
    gridSize: 6 + Math.floor((d - 1) / 2), // 6..10
    targetLines: d <= 2 ? 1 : d <= 6 ? 2 : 3,
    rotatable: d >= 4,
    sizeMin: d <= 3 ? 3 : d <= 6 ? 3 : 4,
    sizeMax: d <= 3 ? 4 : 5,
    // How much of the band the pieces themselves fill (rest is pre-filled).
    gapFraction: 0.33 + d * 0.03,
    // Density of harmless filled cells outside the band.
    noiseDensity: 0.08 + d * 0.02,
  };
}

// ---------------------------------------------------------------------------
// Internal construction (in "row space"; transposed afterwards for columns)
// ---------------------------------------------------------------------------

interface Built {
  gridSize: number;
  targetLines: number;
  rotatable: boolean;
  prefill: Cell[]; // band cells not covered by pieces + noise cells
  footprints: Cell[][]; // absolute cells of each piece's solved position
}

function growPieces(
  rng: Rng,
  gridSize: number,
  bandStart: number,
  bandRows: number,
  sizes: number[],
  gapBudget: number[],
  difficulty: number,
): Cell[][] | null {
  const occupied = new Set<number>();
  const inBand = (r: number) => r >= bandStart && r < bandStart + bandRows;
  const footprints: Cell[][] = [];

  for (let i = 0; i < sizes.length; i++) {
    // Seed in the band row with the fewest piece cells so far, so every
    // target line ends up with at least one gap.
    const perRow = new Array<number>(bandRows).fill(0);
    for (const fp of footprints)
      for (const [r] of fp) if (inBand(r)) perRow[r - bandStart]++;
    const least = Math.min(...perRow);
    const rowChoices: number[] = [];
    for (let b = 0; b < bandRows; b++)
      if (perRow[b] === least) rowChoices.push(bandStart + b);
    const seedRow = rng.pick(rowChoices);
    const seedCols: number[] = [];
    for (let c = 0; c < gridSize; c++)
      if (!occupied.has(keyOf(seedRow, c))) seedCols.push(c);
    if (seedCols.length === 0) return null;
    const seed: Cell = [seedRow, rng.pick(seedCols)];

    const cells: Cell[] = [seed];
    const cellKeys = new Set<number>([keyOf(seed[0], seed[1])]);
    let last = seed;
    let lastDir: Cell = [0, 0];

    const pickNext = (candidates: Cell[]): Cell => {
      // Low difficulty prefers straight bars; high difficulty branches.
      const straight = candidates.filter(
        ([r, c]) => r === last[0] + lastDir[0] && c === last[1] + lastDir[1],
      );
      const pool =
        straight.length > 0 && rng.chance(Math.max(0.15, 1 - difficulty * 0.09))
          ? straight
          : candidates;
      return rng.pick(pool);
    };

    const candidatesWhere = (allow: (r: number) => boolean): Cell[] => {
      const seen = new Set<number>();
      const out: Cell[] = [];
      for (const [r, c] of cells) {
        for (const [dr, dc] of NEIGHBORS) {
          const nr = r + dr;
          const nc = c + dc;
          const k = keyOf(nr, nc);
          if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize) continue;
          if (occupied.has(k) || cellKeys.has(k) || seen.has(k)) continue;
          if (!allow(nr)) continue;
          seen.add(k);
          out.push([nr, nc]);
        }
      }
      return out;
    };

    const add = (cell: Cell) => {
      lastDir = [cell[0] - last[0], cell[1] - last[1]];
      last = cell;
      cells.push(cell);
      cellKeys.add(keyOf(cell[0], cell[1]));
    };

    // Phase 1: gap cells inside the band.
    let bandCount = 1;
    while (bandCount < gapBudget[i]) {
      const cands = candidatesWhere(inBand);
      if (cands.length === 0) break;
      add(pickNext(cands));
      bandCount++;
    }
    // Phase 2: spill outside the band up to the full piece size.
    while (cells.length < sizes[i]) {
      let cands = candidatesWhere((r) => !inBand(r));
      if (cands.length === 0) cands = candidatesWhere(() => true);
      if (cands.length === 0) break;
      add(pickNext(cands));
    }
    if (cells.length < 3) return null;
    for (const k of cellKeys) occupied.add(k);
    footprints.push(cells);
  }

  // Every target line needs at least one gap, or it would start pre-cleared.
  for (let b = 0; b < bandRows; b++) {
    const row = bandStart + b;
    if (!footprints.some((fp) => fp.some(([r]) => r === row))) return null;
  }
  return footprints;
}

// Last-resort construction. Plain shapes, always solvable, never fails.
function fallbackBuild(p: ReturnType<typeof params>): Built {
  const { gridSize, targetLines, rotatable } = p;
  let footprints: Cell[][];
  if (targetLines === 1) {
    footprints = [
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      [
        [0, 3],
        [1, 3],
        [2, 3],
      ],
      [
        [0, 4],
        [1, 4],
        [2, 4],
      ],
    ];
  } else if (targetLines === 2) {
    footprints = [
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      [
        [1, 0],
        [1, 1],
        [1, 2],
      ],
      [
        [0, 3],
        [0, 4],
        [1, 3],
        [1, 4],
      ],
    ];
  } else {
    footprints = [
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      [
        [1, 0],
        [1, 1],
        [1, 2],
      ],
      [
        [2, 0],
        [2, 1],
        [2, 2],
      ],
    ];
  }
  const covered = new Set<number>(
    footprints.flat().map(([r, c]) => keyOf(r, c)),
  );
  const prefill: Cell[] = [];
  for (let r = 0; r < targetLines; r++)
    for (let c = 0; c < gridSize; c++)
      if (!covered.has(keyOf(r, c))) prefill.push([r, c]);
  return { gridSize, targetLines, rotatable, prefill, footprints };
}

function build(rng: Rng, p: ReturnType<typeof params>): Built {
  const { d, gridSize, targetLines, rotatable } = p;

  for (let attempt = 0; attempt < 60; attempt++) {
    const bandStart = rng.int(0, gridSize - targetLines);
    const bandSize = targetLines * gridSize;
    const sizes = [0, 1, 2].map(() => rng.int(p.sizeMin, p.sizeMax));
    const sumSizes = sizes[0] + sizes[1] + sizes[2];
    const gapTotal = Math.max(
      3,
      Math.min(Math.round(bandSize * p.gapFraction), sumSizes, bandSize - 2),
    );
    // Split the gap between the three pieces, each 1..size cells in-band.
    const gaps = [1, 1, 1];
    let remaining = gapTotal - 3;
    let guard = 0;
    while (remaining > 0 && guard++ < 100) {
      const i = rng.int(0, 2);
      if (gaps[i] < sizes[i]) {
        gaps[i]++;
        remaining--;
      }
    }

    const footprints = growPieces(
      rng,
      gridSize,
      bandStart,
      targetLines,
      sizes,
      gaps,
      d,
    );
    if (!footprints) continue;

    const pieceCells = new Set<number>(
      footprints.flat().map(([r, c]) => keyOf(r, c)),
    );
    const inBand = (r: number) => r >= bandStart && r < bandStart + targetLines;

    // Pre-fill everything in the band the pieces do not cover.
    const prefill: Cell[] = [];
    for (let r = bandStart; r < bandStart + targetLines; r++)
      for (let c = 0; c < gridSize; c++)
        if (!pieceCells.has(keyOf(r, c))) prefill.push([r, c]);

    // Noise cells outside the band. Reservations keep every non-target row
    // and every column from starting out complete.
    const outsideRows: number[] = [];
    for (let r = 0; r < gridSize; r++) if (!inBand(r)) outsideRows.push(r);
    const reserved = new Set<number>();
    for (let c = 0; c < gridSize; c++)
      reserved.add(keyOf(rng.pick(outsideRows), c));
    for (const r of outsideRows) reserved.add(keyOf(r, rng.int(0, gridSize - 1)));

    const noiseCandidates: Cell[] = [];
    for (const r of outsideRows)
      for (let c = 0; c < gridSize; c++) {
        const k = keyOf(r, c);
        if (!pieceCells.has(k) && !reserved.has(k)) noiseCandidates.push([r, c]);
      }
    const noiseCount = Math.floor(noiseCandidates.length * p.noiseDensity);
    prefill.push(...rng.shuffle(noiseCandidates).slice(0, noiseCount));

    return { gridSize, targetLines, rotatable, prefill, footprints };
  }
  return fallbackBuild(p);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export function generate(
  seed: string,
  difficulty: number,
): { data: BlockFitData; solution: BlockFitAnswer } {
  const rng = createRng(`blockfit:${seed}:${difficulty}`);
  const p = params(difficulty);
  const built = build(rng, p);

  // Half the puzzles clear columns instead of rows: transpose everything.
  const transpose = rng.chance(0.5);
  const map = ([r, c]: Cell): Cell => (transpose ? [c, r] : [r, c]);
  const prefill = built.prefill.map(map);
  const footprints = built.footprints.map((fp) => fp.map(map));

  const colors = rng.shuffle([1, 2, 3, 4, 5, 6]).slice(0, 3);
  const trayOrder = rng.shuffle([0, 1, 2]);

  const pieces: BlockFitPiece[] = [];
  const placements: BlockFitPlacement[] = [];
  trayOrder.forEach((fpIndex, trayIndex) => {
    const footprint = footprints[fpIndex];
    const originRow = Math.min(...footprint.map(([r]) => r));
    const originCol = Math.min(...footprint.map(([, c]) => c));
    const shape = normalize(footprint);
    // Rotate the tray shape so the player has to turn it back.
    const trayTurns = built.rotatable ? rng.int(0, 3) : 0;
    const id = trayIndex + 1;
    pieces.push({
      id,
      cells: rotateN(shape, trayTurns),
      color: colors[trayIndex],
    });
    placements.push({
      pieceId: id,
      rotation: ((4 - trayTurns) % 4) as 0 | 1 | 2 | 3,
      row: originRow,
      col: originCol,
    });
  });

  prefill.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const data: BlockFitData = {
    kind: "blockfit",
    gridSize: built.gridSize,
    filled: prefill,
    pieces,
    targetLines: built.targetLines,
    rotatable: built.rotatable,
  };
  return { data, solution: { placements } };
}

// ---------------------------------------------------------------------------
// Grading: simulate the submitted placements against the regenerated board.
// Any legal arrangement that clears enough lines counts.
// ---------------------------------------------------------------------------

function isPlacement(x: unknown): x is BlockFitPlacement {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.pieceId === "number" &&
    Number.isInteger(p.pieceId) &&
    typeof p.rotation === "number" &&
    Number.isInteger(p.rotation) &&
    p.rotation >= 0 &&
    p.rotation <= 3 &&
    typeof p.row === "number" &&
    Number.isInteger(p.row) &&
    typeof p.col === "number" &&
    Number.isInteger(p.col)
  );
}

export function grade(
  seed: string,
  difficulty: number,
  answer: unknown,
): boolean {
  const { data } = generate(seed, difficulty);
  if (typeof answer !== "object" || answer === null) return false;
  const placements = (answer as Record<string, unknown>).placements;
  if (!Array.isArray(placements)) return false;
  if (placements.length > data.pieces.length) return false;

  const filled = new Set<number>(data.filled.map(([r, c]) => keyOf(r, c)));
  const used = new Set<number>();

  for (const raw of placements) {
    if (!isPlacement(raw)) return false;
    const piece = data.pieces.find((pc) => pc.id === raw.pieceId);
    if (!piece || used.has(raw.pieceId)) return false;
    if (!data.rotatable && raw.rotation !== 0) return false;
    used.add(raw.pieceId);

    const shape = rotateN(piece.cells, raw.rotation);
    const targets: number[] = [];
    for (const [dr, dc] of shape) {
      const r = raw.row + dr;
      const c = raw.col + dc;
      if (r < 0 || r >= data.gridSize || c < 0 || c >= data.gridSize)
        return false;
      const k = keyOf(r, c);
      if (filled.has(k)) return false;
      targets.push(k);
    }
    for (const k of targets) filled.add(k);
  }

  let cleared = 0;
  for (let i = 0; i < data.gridSize; i++) {
    let rowFull = true;
    let colFull = true;
    for (let j = 0; j < data.gridSize; j++) {
      if (!filled.has(keyOf(i, j))) rowFull = false;
      if (!filled.has(keyOf(j, i))) colFull = false;
    }
    if (rowFull) cleared++;
    if (colFull) cleared++;
  }
  return cleared >= data.targetLines;
}

// ---------------------------------------------------------------------------
// Explanation, derived from the canonical solution.
// ---------------------------------------------------------------------------

const TURN_WORDS = ["", "one quarter turn", "a half turn", "three quarter turns"];

function listOf(nums: number[]): string {
  const s = nums.map(String);
  if (s.length === 1) return s[0];
  return `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}`;
}

export function explain(seed: string, difficulty: number): string {
  const { data, solution } = generate(seed, difficulty);

  // Replay the canonical placements to find which lines end up complete.
  const filled = new Set<number>(data.filled.map(([r, c]) => keyOf(r, c)));
  for (const pl of solution.placements) {
    const piece = data.pieces.find((pc) => pc.id === pl.pieceId);
    if (!piece) continue;
    for (const [dr, dc] of rotateN(piece.cells, pl.rotation))
      filled.add(keyOf(pl.row + dr, pl.col + dc));
  }
  const fullRows: number[] = [];
  const fullCols: number[] = [];
  for (let i = 0; i < data.gridSize; i++) {
    let rowFull = true;
    let colFull = true;
    for (let j = 0; j < data.gridSize; j++) {
      if (!filled.has(keyOf(i, j))) rowFull = false;
      if (!filled.has(keyOf(j, i))) colFull = false;
    }
    if (rowFull) fullRows.push(i + 1);
    if (colFull) fullCols.push(i + 1);
  }

  const lineParts: string[] = [];
  if (fullRows.length > 0)
    lineParts.push(`row${fullRows.length > 1 ? "s" : ""} ${listOf(fullRows)}`);
  if (fullCols.length > 0)
    lineParts.push(
      `column${fullCols.length > 1 ? "s" : ""} ${listOf(fullCols)}`,
    );

  const steps = solution.placements
    .map((pl) => {
      const piece = data.pieces.find((pc) => pc.id === pl.pieceId);
      const size = piece ? piece.cells.length : 0;
      const turn =
        pl.rotation > 0
          ? `rotate it ${TURN_WORDS[pl.rotation]} clockwise, then `
          : "";
      return `Piece ${pl.pieceId} (${size} cells): ${turn}set its top-left corner on row ${pl.row + 1}, column ${pl.col + 1}.`;
    })
    .join(" ");

  return (
    `Here is one arrangement that works. Rows count from the top, columns from the left, both starting at 1. ` +
    `${steps} That fills ${lineParts.join(" and ")} end to end, which clears ` +
    `${data.targetLines === 1 ? "the line you needed" : `${data.targetLines} lines`}. ` +
    `Other arrangements count too, as long as ${data.targetLines === 1 ? "a full line clears" : `${data.targetLines} full lines clear`}.`
  );
}
