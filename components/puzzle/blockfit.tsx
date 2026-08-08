"use client";

// BlockFit player. Mirrors the generator's placement semantics exactly:
// rotation = quarter turns clockwise with re-normalization, placement puts
// the rotated shape's bounding-box top-left at (row, col). No mid-placement
// clears — lines are counted on the accumulated end state, same as grade().

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import type {
  BlockFitData,
  BlockFitPlacement,
  PuzzleProps,
} from "@/lib/types";

type Cell = [number, number];

function normalize(cells: Cell[]): Cell[] {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  return cells
    .map(([r, c]): Cell => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function rotateN(cells: Cell[], quarters: number): Cell[] {
  let out = normalize(cells);
  for (let i = 0; i < ((quarters % 4) + 4) % 4; i++) {
    out = normalize(out.map(([r, c]): Cell => [c, -r]));
  }
  return out;
}

const keyOf = (r: number, c: number) => r * 64 + c;

interface Drag {
  pieceId: number;
  rotation: 0 | 1 | 2 | 3;
  x: number;
  y: number;
  pointerType: string;
  anchor: Cell | null; // snapped board anchor, null while off-board
  valid: boolean;
}

interface KeyboardCarry {
  pieceId: number;
  rotation: 0 | 1 | 2 | 3;
  anchor: Cell;
}

export function BlockFitPuzzle({ puzzle, onSolve, onGrade }: PuzzleProps) {
  const data = puzzle.data as BlockFitData;
  const size = data.gridSize;

  const [placements, setPlacements] = useState<Map<number, BlockFitPlacement>>(
    new Map(),
  );
  const [trayRotations, setTrayRotations] = useState<Record<number, 0 | 1 | 2 | 3>>(
    {},
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const [carry, setCarry] = useState<KeyboardCarry | null>(null);
  const [attempts, setAttempts] = useState(1);
  const [announce, setAnnounce] = useState("");
  const [phase, setPhase] = useState<"play" | "grading" | "done">("play");
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const [clearedLines, setClearedLines] = useState<Set<string>>(new Set());

  const boardRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(performance.now());

  const filledSet = useMemo(
    () => new Set(data.filled.map(([r, c]) => keyOf(r, c))),
    [data.filled],
  );

  // Occupancy of everything currently on the board.
  const occupied = useMemo(() => {
    const occ = new Map<number, number>(); // cellKey -> piece color (0 = prefill)
    for (const k of filledSet) occ.set(k, 0);
    for (const [pieceId, p] of placements) {
      const piece = data.pieces.find((pc) => pc.id === pieceId)!;
      for (const [dr, dc] of rotateN(piece.cells, p.rotation)) {
        occ.set(keyOf(p.row + dr, p.col + dc), piece.color);
      }
    }
    return occ;
  }, [filledSet, placements, data.pieces]);

  const completeLines = useMemo(() => {
    const lines: string[] = [];
    for (let i = 0; i < size; i++) {
      let rowFull = true;
      let colFull = true;
      for (let j = 0; j < size; j++) {
        if (!occupied.has(keyOf(i, j))) rowFull = false;
        if (!occupied.has(keyOf(j, i))) colFull = false;
      }
      if (rowFull) lines.push(`r${i}`);
      if (colFull) lines.push(`c${i}`);
    }
    return lines;
  }, [occupied, size]);

  const canPlaceAt = useCallback(
    (pieceId: number, rotation: number, anchor: Cell): boolean => {
      const piece = data.pieces.find((pc) => pc.id === pieceId);
      if (!piece) return false;
      for (const [dr, dc] of rotateN(piece.cells, rotation)) {
        const r = anchor[0] + dr;
        const c = anchor[1] + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) return false;
        const k = keyOf(r, c);
        if (occupied.has(k)) return false;
      }
      return true;
    },
    [data.pieces, occupied, size],
  );

  const place = useCallback(
    (pieceId: number, rotation: 0 | 1 | 2 | 3, anchor: Cell) => {
      setPlacements((prev) => {
        const next = new Map(prev);
        next.set(pieceId, { pieceId, rotation, row: anchor[0], col: anchor[1] });
        return next;
      });
      setAnnounce(`Piece placed at row ${anchor[0] + 1}, column ${anchor[1] + 1}.`);
    },
    [],
  );

  const pickBackUp = useCallback((pieceId: number) => {
    setPlacements((prev) => {
      if (!prev.has(pieceId)) return prev;
      const next = new Map(prev);
      next.delete(pieceId);
      return next;
    });
    setAnnounce("Piece returned to the tray.");
  }, []);

  // ---------------------------------------------------------------------
  // Pointer dragging
  // ---------------------------------------------------------------------

  const anchorFromPointer = useCallback(
    (x: number, y: number, pieceId: number, rotation: number, pointerType: string): Cell | null => {
      const board = boardRef.current;
      if (!board) return null;
      const rect = board.getBoundingClientRect();
      const cell = rect.width / size;
      const piece = data.pieces.find((pc) => pc.id === pieceId)!;
      const shape = rotateN(piece.cells, rotation);
      const rows = Math.max(...shape.map(([r]) => r)) + 1;
      const cols = Math.max(...shape.map(([, c]) => c)) + 1;
      // Touch: hold the piece a row above the finger so it stays visible.
      const lift = pointerType === "touch" ? 1.6 : 0;
      const row = Math.round((y - rect.top) / cell - lift - (rows - 1) / 2 - 0.5);
      const col = Math.round((x - rect.left) / cell - (cols - 1) / 2 - 0.5);
      if (
        row < -rows || row > size + rows ||
        col < -cols || col > size + cols
      ) {
        return null;
      }
      return [row, col];
    },
    [data.pieces, size],
  );

  const onPiecePointerDown = (pieceId: number) => (e: React.PointerEvent) => {
    if (phase !== "play") return;
    // Rotation happens on tap (pointerup without move); dragging starts on move.
    const rotation = placements.get(pieceId)?.rotation ?? trayRotations[pieceId] ?? 0;
    if (placements.has(pieceId)) pickBackUp(pieceId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      pieceId,
      rotation,
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
      anchor: null,
      valid: false,
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    setDrag((d) => {
      if (!d) return d;
      const anchor = anchorFromPointer(e.clientX, e.clientY, d.pieceId, d.rotation, d.pointerType);
      const inBounds =
        anchor !== null &&
        anchor[0] >= 0 && anchor[1] >= 0 &&
        anchor[0] < size && anchor[1] < size;
      return {
        ...d,
        x: e.clientX,
        y: e.clientY,
        anchor,
        valid: inBounds ? canPlaceAt(d.pieceId, d.rotation, anchor) : false,
      };
    });
  };

  const onPointerUp = () => {
    setDrag((d) => {
      if (!d) return null;
      const moved = d.anchor !== null;
      if (moved && d.anchor && d.valid) {
        place(d.pieceId, d.rotation, d.anchor);
      } else if (!moved && data.rotatable) {
        // A tap: rotate the tray piece.
        setTrayRotations((prev) => ({
          ...prev,
          [d.pieceId]: (((prev[d.pieceId] ?? 0) + 1) % 4) as 0 | 1 | 2 | 3,
        }));
        setAnnounce("Piece rotated.");
      }
      return null;
    });
  };

  // ---------------------------------------------------------------------
  // Keyboard carrying
  // ---------------------------------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (phase !== "play") return;
    if (carry) {
      const { pieceId, rotation, anchor } = carry;
      const move = (dr: number, dc: number) => {
        e.preventDefault();
        const next: Cell = [
          Math.max(0, Math.min(size - 1, anchor[0] + dr)),
          Math.max(0, Math.min(size - 1, anchor[1] + dc)),
        ];
        setCarry({ pieceId, rotation, anchor: next });
        setAnnounce(
          `Row ${next[0] + 1}, column ${next[1] + 1}${canPlaceAt(pieceId, rotation, next) ? "" : ", blocked"}.`,
        );
      };
      switch (e.key) {
        case "ArrowUp": return move(-1, 0);
        case "ArrowDown": return move(1, 0);
        case "ArrowLeft": return move(0, -1);
        case "ArrowRight": return move(0, 1);
        case "r":
        case "R":
          if (data.rotatable) {
            e.preventDefault();
            const rot = ((rotation + 1) % 4) as 0 | 1 | 2 | 3;
            setCarry({ pieceId, rotation: rot, anchor });
            setAnnounce("Rotated.");
          }
          return;
        case " ":
        case "Enter":
          e.preventDefault();
          if (canPlaceAt(pieceId, rotation, anchor)) {
            place(pieceId, rotation, anchor);
            setCarry(null);
          } else {
            setAnnounce("That spot is blocked.");
          }
          return;
        case "Escape":
          e.preventDefault();
          setCarry(null);
          setAnnounce("Piece returned to the tray.");
          return;
      }
    }
  };

  const pickUpWithKeyboard = (pieceId: number) => {
    if (phase !== "play") return;
    const rotation = trayRotations[pieceId] ?? 0;
    if (placements.has(pieceId)) pickBackUp(pieceId);
    setCarry({ pieceId, rotation, anchor: [0, 0] });
    setAnnounce(
      "Piece picked up. Arrow keys move it, R rotates, space places, escape cancels.",
    );
  };

  // ---------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------

  const allPlaced = placements.size === data.pieces.length;
  const targetReached = completeLines.length >= data.targetLines;

  const submit = async () => {
    if (phase !== "play") return;
    setPhase("grading");
    const answer = { placements: [...placements.values()] };
    try {
      const result = await onGrade(answer);
      setFlash(result.correct ? "correct" : "wrong");
      if (result.correct) setClearedLines(new Set(completeLines));
      setPhase("done");
      const timeMs = Math.round(performance.now() - startRef.current);
      setTimeout(() => {
        onSolve({
          correct: result.correct,
          timeMs,
          hintsUsed: 0,
          attempts,
          answer,
        });
      }, 1200);
    } catch {
      setPhase("play");
      setAnnounce("That didn't save. Check your connection and try again.");
    }
  };

  const reset = () => {
    if (phase !== "play") return;
    setPlacements(new Map());
    setCarry(null);
    setAttempts((a) => a + 1);
    setAnnounce("Board reset. Everything is back in the tray.");
  };

  // Ghost cells for drag or keyboard carry.
  const ghost = useMemo(() => {
    const active = drag?.anchor
      ? { pieceId: drag.pieceId, rotation: drag.rotation, anchor: drag.anchor, valid: drag.valid }
      : carry
        ? {
            pieceId: carry.pieceId,
            rotation: carry.rotation,
            anchor: carry.anchor,
            valid: canPlaceAt(carry.pieceId, carry.rotation, carry.anchor),
          }
        : null;
    if (!active) return null;
    const piece = data.pieces.find((pc) => pc.id === active.pieceId)!;
    const cells = new Set(
      rotateN(piece.cells, active.rotation)
        .map(([dr, dc]): Cell => [active.anchor[0] + dr, active.anchor[1] + dc])
        .filter(([r, c]) => r >= 0 && r < size && c >= 0 && c < size)
        .map(([r, c]) => keyOf(r, c)),
    );
    return { cells, valid: active.valid, color: piece.color };
  }, [drag, carry, canPlaceAt, data.pieces, size]);

  const trayPieces = data.pieces.filter(
    (p) => !placements.has(p.id) && carry?.pieceId !== p.id,
  );

  useEffect(() => {
    if (drag) {
      const prevent = (e: TouchEvent) => e.preventDefault();
      document.addEventListener("touchmove", prevent, { passive: false });
      return () => document.removeEventListener("touchmove", prevent);
    }
  }, [drag]);

  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="flex items-center justify-between text-sm">
        <p className="text-slate">
          Clear <span className="num text-ink">{data.targetLines}</span>{" "}
          {data.targetLines === 1 ? "line" : "lines"}
          {data.rotatable ? ". Tap a piece to rotate it." : "."}
        </p>
        <p className="num" aria-label={`${completeLines.length} of ${data.targetLines} lines complete`}>
          {completeLines.length}/{data.targetLines}
        </p>
      </div>

      <div
        ref={boardRef}
        role="grid"
        aria-label={`${size} by ${size} board`}
        className={`mx-auto grid w-full max-w-[420px] touch-none gap-0.5 ${
          flash === "correct" ? "animate-[flash-correct_0.6s]" : flash === "wrong" ? "animate-[flash-wrong_0.6s]" : ""
        }`}
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: size * size }, (_, i) => {
          const r = Math.floor(i / size);
          const c = i % size;
          const k = keyOf(r, c);
          const color = occupied.get(k);
          const inGhost = ghost?.cells.has(k);
          const inClearedLine = clearedLines.has(`r${r}`) || clearedLines.has(`c${c}`);
          const inCompleteLine =
            completeLines.includes(`r${r}`) || completeLines.includes(`c${c}`);
          return (
            <div
              key={k}
              role="gridcell"
              aria-label={
                color === 0 ? "filled" : color ? "your block" : "empty"
              }
              className={`aspect-square rounded-[1px] border ${
                inGhost
                  ? ghost!.valid
                    ? "border-ink"
                    : "border-slate"
                  : "border-ink/15"
              } ${inClearedLine ? "animate-[line-clear_0.5s_forwards]" : ""}`}
              style={{
                background: inGhost
                  ? ghost!.valid
                    ? `color-mix(in srgb, var(--block-${ghost!.color}) 55%, var(--chalk))`
                    : "var(--paper)"
                  : color === 0
                    ? "color-mix(in srgb, var(--ink) 72%, var(--chalk))"
                    : color
                      ? `var(--block-${color})`
                      : inCompleteLine
                        ? "color-mix(in srgb, var(--gold) 25%, var(--chalk))"
                        : "var(--chalk)",
              }}
            />
          );
        })}
      </div>

      {/* Tray */}
      <div
        role="toolbar"
        aria-label="pieces"
        className="flex min-h-20 items-center justify-center gap-6"
      >
        {trayPieces.length === 0 && (
          <p className="text-sm text-slate">All pieces are on the board.</p>
        )}
        {trayPieces.map((piece) => {
          const rotation = trayRotations[piece.id] ?? 0;
          const shape = rotateN(piece.cells, rotation);
          const rows = Math.max(...shape.map(([r]) => r)) + 1;
          const cols = Math.max(...shape.map(([, c]) => c)) + 1;
          const cellSet = new Set(shape.map(([r, c]) => keyOf(r, c)));
          return (
            <button
              key={piece.id}
              type="button"
              aria-label={`piece of ${piece.cells.length} blocks. Press enter to pick it up${data.rotatable ? ", tap to rotate" : ""}`}
              onPointerDown={onPiecePointerDown(piece.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pickUpWithKeyboard(piece.id);
                }
              }}
              className="grid min-h-11 min-w-11 cursor-grab touch-none place-content-center rounded-(--radius-ctl) p-1 active:cursor-grabbing"
              style={{ opacity: drag?.pieceId === piece.id ? 0.3 : 1 }}
            >
              <span
                className="grid gap-0.5"
                style={{ gridTemplateColumns: `repeat(${cols}, 18px)` }}
              >
                {Array.from({ length: rows * cols }, (_, i) => {
                  const r = Math.floor(i / cols);
                  const c = i % cols;
                  return (
                    <span
                      key={i}
                      className="block size-[18px] rounded-[1px]"
                      style={{
                        background: cellSet.has(keyOf(r, c))
                          ? `var(--block-${piece.color})`
                          : "transparent",
                        animation: cellSet.has(keyOf(r, c))
                          ? "block-pop 0.15s"
                          : undefined,
                      }}
                    />
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>

      {/* Drag ghost following the pointer */}
      {drag && drag.anchor === null && (
        <DragOverlay drag={drag} pieces={data.pieces} />
      )}

      <div className="flex items-center gap-3">
        <Button
          onClick={submit}
          disabled={phase !== "play" || (!allPlaced && !targetReached)}
        >
          Place the blocks
        </Button>
        <Button variant="quiet" onClick={reset} disabled={phase !== "play"}>
          Reset board
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}

// Free-floating piece rendered while the pointer is off the board.
function DragOverlay({
  drag,
  pieces,
}: {
  drag: Drag;
  pieces: BlockFitData["pieces"];
}) {
  const piece = pieces.find((p) => p.id === drag.pieceId);
  if (!piece) return null;
  const shape = rotateN(piece.cells, drag.rotation);
  const cols = Math.max(...shape.map(([, c]) => c)) + 1;
  const rows = Math.max(...shape.map(([r]) => r)) + 1;
  const cellSet = new Set(shape.map(([r, c]) => keyOf(r, c)));
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 grid gap-0.5"
      style={{
        left: drag.x - (cols * 20) / 2,
        top: drag.y - rows * 20 - (drag.pointerType === "touch" ? 32 : 10),
        gridTemplateColumns: `repeat(${cols}, 20px)`,
      }}
    >
      {Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        return (
          <span
            key={i}
            className="block size-5 rounded-[1px]"
            style={{
              background: cellSet.has(keyOf(r, c))
                ? `var(--block-${piece.color})`
                : "transparent",
            }}
          />
        );
      })}
    </div>
  );
}
