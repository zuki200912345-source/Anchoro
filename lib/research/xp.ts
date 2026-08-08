// Independence-weighted XP (RESEARCH-SPEC.md §10, replacing completion XP — R4).
//
// The award table is fixed by the spec and lives in `XP` in types.ts:
//
//   independent solution        +10   Risko & Gilbert; Bastani
//   persistence after an error   +5   Liu et al. 2026; Duckworth
//   self-explanation             +5   Bisra 2018 (g=0.55)
//   self-correction              +5   Kapur
//   transfer solved             +10   Sinha & Kapur
//   strategic hint use           +2   rewards appropriate help-seeking
//   unnecessary AI dependence     0   removes the payoff that drives offloading
//
// Two things earn nothing here, on purpose: finishing an item, and finishing it
// fast. Neither appears in the table and neither is computed anywhere below.
//
// X1 — Deci et al. 1999 found positive competence feedback was the one reward
// type that raised intrinsic motivation. So every line names the behaviour in
// the student's own terms ("solved it yourself"), not the payout. The label is
// feedback; the number is a footnote.

import { XP, type AttemptOutcome, type HelpLevel, type ItemKind, type XpBreakdownLine } from "./types";

export interface XpInput {
  /** Solved with no AI at all. */
  unaided: boolean;
  outcome: AttemptOutcome;
  attemptsCount: number;
  /** Highest rung of the help ladder this item reached. */
  maxHelpLevel: HelpLevel;
  selfCorrected: boolean;
  persistedAfterError: boolean;
  /** True when the student wrote a self-explanation for this item (N9). */
  selfExplanation: boolean;
  itemKind: ItemKind;
  /**
   * Optional caller signal: the help request came after a genuine attempt
   * rather than as a first move. Defaults to the structural test below.
   */
  strategicHintUse?: boolean;
}

export interface XpResult {
  total: number;
  lines: XpBreakdownLine[];
}

/**
 * Strategic hint use vs unnecessary dependence — the distinction the whole
 * scheme turns on:
 *
 * - STRATEGIC (+2): a genuine attempt went in first, a hint below the worked
 *   solution was taken, and the student then solved it. This is help-seeking
 *   used as a tool. It is deliberately rewarded so the scheme does not pay for
 *   hint AVOIDANCE — a student who is stuck and refuses help learns nothing,
 *   and an XP system that punishes hints teaches exactly that.
 *
 * - UNNECESSARY DEPENDENCE (0): the worked solution was handed over, or the
 *   attempts on the record were filler (`low_effort`) submitted to walk through
 *   the gate. Nothing is deducted — there is simply no payout, which is the
 *   point of the 0 in the spec's table. Filler attempts are the main gaming
 *   vector the spec asks us to watch (B7, X2), so they zero the whole item;
 *   a revealed solution only zeroes the independence awards, because a student
 *   who tried hard, saw the solution, then explained it back has still done
 *   the self-explanation.
 */
export function scoreAttempt(a: XpInput): XpResult {
  const lines: XpBreakdownLine[] = [];
  const push = (key: keyof typeof XP, label: string) => {
    lines.push({ key, label, amount: XP[key] });
  };

  const attempts = Math.max(0, Math.floor(a.attemptsCount || 0));
  const solved = a.outcome === "correct";
  const helpUsed = a.maxHelpLevel !== "none";
  const solutionRevealed = a.maxHelpLevel === "solution";
  const lowEffort = a.outcome === "low_effort";

  // Filler attempts score nothing at all, and say so plainly.
  if (lowEffort) {
    push("unnecessaryDependence", "A filler attempt doesn't score");
    return { total: 0, lines };
  }

  const genuineAttempt = attempts >= 1;
  const strategic = a.strategicHintUse ?? genuineAttempt;

  // +10 — solved it with no AI at all.
  if (solved && a.unaided && !helpUsed) {
    push("independentSolution", "Solved it yourself");
  }

  // +10 — a novel context, same strategy (N6). Not paid when the solution was
  // handed over: transfer means the student made the jump.
  if (solved && a.itemKind === "transfer" && !solutionRevealed) {
    push("transferSolved", "Carried the method to a new problem type");
  }

  // +5 — carried on after a wrong answer. Paid whether or not the item was
  // eventually solved: persistence is the behaviour, not the outcome.
  if (a.persistedAfterError && attempts >= 2) {
    push("persistenceAfterError", "Kept going after a wrong answer");
  }

  // +5 — fixed an earlier error without being told the answer.
  if (a.selfCorrected) {
    push("selfCorrection", "Caught your own mistake");
  }

  // +5 — wrote out the reasoning (Bisra 2018).
  if (a.selfExplanation) {
    push("selfExplanation", "Explained your reasoning in your own words");
  }

  // +2 — asked for a hint after trying, then finished the job.
  if (solved && helpUsed && !solutionRevealed && strategic) {
    push("strategicHintUse", "Asked for a hint at the right time");
  }

  // 0 — the solution was shown, so the independence awards are off the table.
  if (solutionRevealed) {
    push("unnecessaryDependence", "Solution shown — nothing scored for solving it");
  }

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return { total, lines };
}
