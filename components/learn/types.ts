// Shapes the learn panels share with the route client in app/(app)/learn/api.ts.
// They live here so the dependency only ever runs one way: the page imports
// components, never the reverse. Nothing in this file duplicates
// lib/research/types.ts — it re-uses it.

import type { XpBreakdownLine } from "@/lib/research/types";

/** §10 — the independence award lines plus their sum, as returned by the API. */
export interface XpAward {
  total: number;
  lines: XpBreakdownLine[];
}

/** N9 / C4 — the score and note that come back from /explain-back. */
export interface ExplainBackResult {
  score: number;
  feedback: string;
}
