// Feature D — AI fading (RESEARCH-SPEC.md §4, D1–D7), plus the help gate that
// enforces the attempt-first rule (B1) and the effort bar on the worked
// solution (B4).
//
// Support runs 1 (strong hints) to 5 (no AI) — D1. The level tracks a
// competence estimate built from recent unaided outcomes: sustained unaided
// success fades support (D4), and repeated regressions bring it straight back
// (D2 — adaptive AND reversible). The student can see and set their own level
// (D3), and every move carries a rationale (D5) framed as their skill taking
// over rather than support being taken away (D7).
//
// Everything here is a pure function of the history it is handed. No database,
// no model call. The fading decision has to be inspectable and reproducible,
// which rules out generative scoring.

import {
  HELP_LEVELS,
  SUPPORT_POLICIES,
  helpRank,
  type AttemptOutcome,
  type HelpLevel,
  type SessionMode,
  type SupportLevel,
  type SupportPolicy,
} from "./types";

// ---------------------------------------------------------------------------
// Tuning constants. Exported so tests and the debug view read the same numbers
// the engine does.
// ---------------------------------------------------------------------------

/** How many recent finished items count as evidence. */
export const FADE_WINDOW = 5;

/** Consecutive unaided solves that fade support by one level (D4). */
export const FADE_STREAK = 3;

/** Items in the window that did not come out unaided before support returns (D2). */
export const REGRESSION_LIMIT = 2;

export const SUPPORT_LEVELS: readonly SupportLevel[] = [1, 2, 3, 4, 5];

/** Mid-sentence form of each level, for rationale copy. */
export const SUPPORT_LEVEL_PHRASE: Record<SupportLevel, string> = {
  1: "full scaffolding",
  2: "standard hints",
  3: "lighter hints",
  4: "questions only",
  5: "no AI",
};

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

/** One finished item attempt, reduced to what fading cares about. */
export interface CompetenceSignal {
  /** Solved with no AI at all — the primary outcome (M1). */
  unaided: boolean;
  outcome: AttemptOutcome;
  /** Highest rung of the help ladder this item reached. */
  maxHelpLevel: HelpLevel;
}

export interface SupportHistory {
  /** The level in force now. Moves are relative to it, one step at a time. */
  current: SupportLevel;
  /** Recent finished items, OLDEST FIRST. Only the tail is read. */
  recent: CompetenceSignal[];
  /** Set when the student picked a level themselves (D3). Null hands fading back to Anchor. */
  studentPreference?: SupportLevel | null;
}

export interface SupportEvidence {
  /** Signals actually considered — the tail of the history, at most FADE_WINDOW. */
  window: number;
  /** Consecutive unaided solves at the end of the window (D4). */
  unaidedStreak: number;
  /** Unaided solves anywhere in the window. */
  unaidedSuccesses: number;
  /** Items in the window that did not come out unaided (D6). */
  regressions: number;
}

export interface SupportDecision {
  level: SupportLevel;
  previous: SupportLevel;
  /**
   * "up" = a higher level number = less AI. Named for the student's skill, not
   * for the amount of support, per D7.
   */
  direction: "up" | "down" | "hold";
  /** The D5 sentence, ready to show. */
  rationale: string;
  policy: SupportPolicy;
  evidence: SupportEvidence;
  /** True when the level came from the student's own choice rather than the evidence. */
  studentPinned: boolean;
  /** What the evidence would have chosen, when the student pinned something else (D3). */
  suggestion: { level: SupportLevel; reason: string } | null;
}

// ---------------------------------------------------------------------------
// Competence estimate
// ---------------------------------------------------------------------------

const clampLevel = (n: number): SupportLevel =>
  (n < 1 ? 1 : n > 5 ? 5 : Math.round(n)) as SupportLevel;

/** Unaided success: correct, at help level 'none'. Nothing else counts. */
export function isUnaidedSuccess(signal: CompetenceSignal): boolean {
  return (
    signal.unaided && signal.outcome === "correct" && helpRank(signal.maxHelpLevel) === 0
  );
}

/**
 * A regression is simply an item that did not come out unaided — wrong,
 * skipped, or solved with help. It is a measurement (D6), not a judgement:
 * needing help at a faded level is evidence that the fade came early.
 */
export function isRegression(signal: CompetenceSignal): boolean {
  return !isUnaidedSuccess(signal);
}

export function summariseEvidence(recent: CompetenceSignal[]): SupportEvidence {
  const window = recent.slice(-FADE_WINDOW);
  let unaidedStreak = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    if (!isUnaidedSuccess(window[i])) break;
    unaidedStreak++;
  }
  const unaidedSuccesses = window.filter(isUnaidedSuccess).length;
  return {
    window: window.length,
    unaidedStreak,
    unaidedSuccesses,
    regressions: window.length - unaidedSuccesses,
  };
}

/**
 * D2/D4 — the fading decision. Moves at most one level per call, in either
 * direction, so support is always recoverable.
 */
export function computeSupportLevel(history: SupportHistory): SupportDecision {
  const previous = clampLevel(history.current);
  const evidence = summariseEvidence(history.recent ?? []);

  let level = previous;
  if (evidence.window > 0) {
    if (evidence.unaidedStreak >= FADE_STREAK && previous < 5) {
      // Sustained unaided success is the trigger, and it is checked first: the
      // most recent evidence outranks older misses (D4).
      level = clampLevel(previous + 1);
    } else if (evidence.regressions >= REGRESSION_LIMIT && previous > 1) {
      level = clampLevel(previous - 1);
    }
  }

  const pinned = history.studentPreference != null;
  if (pinned) {
    const chosen = clampLevel(history.studentPreference as SupportLevel);
    return {
      level: chosen,
      previous,
      direction: chosen > previous ? "up" : chosen < previous ? "down" : "hold",
      rationale: `You set support to ${SUPPORT_LEVEL_PHRASE[chosen]}. It stays there until you change it.`,
      policy: SUPPORT_POLICIES[chosen],
      evidence,
      studentPinned: true,
      suggestion:
        level === chosen
          ? null
          : { level, reason: fadingRationale(chosen, level, evidence) },
    };
  }

  return {
    level,
    previous,
    direction: level > previous ? "up" : level < previous ? "down" : "hold",
    rationale: fadingRationale(previous, level, evidence),
    policy: SUPPORT_POLICIES[level],
    evidence,
    studentPinned: false,
    suggestion: null,
  };
}

/**
 * D5 — the sentence shown when the level moves, and the "what it takes" line
 * when it holds. Fading up is framed as the student's skill covering more
 * ground (D7); fading down states the facts and the way back, never a verdict
 * on the student (G3, I1).
 */
export function fadingRationale(
  from: SupportLevel,
  to: SupportLevel,
  evidence: SupportEvidence,
): string {
  if (to > from) {
    return `You've solved ${evidence.unaidedStreak} unaided — dropping to ${SUPPORT_LEVEL_PHRASE[to]}. You're carrying more of this yourself now.`;
  }

  if (to < from) {
    return `${evidence.regressions} of the last ${evidence.window} didn't come out unaided — back to ${SUPPORT_LEVEL_PHRASE[to]} while you rebuild it. Unaided solves move it again.`;
  }

  if (from === 5) {
    return `You're on ${SUPPORT_LEVEL_PHRASE[5]}. There is nothing lighter to move to.`;
  }

  const remaining = Math.max(1, FADE_STREAK - evidence.unaidedStreak);
  const next = SUPPORT_LEVEL_PHRASE[clampLevel(from + 1)];
  return remaining === 1
    ? `You're on ${SUPPORT_LEVEL_PHRASE[from]}. 1 more unaided solve moves you to ${next}.`
    : `You're on ${SUPPORT_LEVEL_PHRASE[from]}. ${remaining} more unaided solves in a row move you to ${next}.`;
}

// ---------------------------------------------------------------------------
// The help gate — B1 and B4 are enforced here and nowhere else.
// ---------------------------------------------------------------------------

export interface HelpGateState {
  attemptsMade: number;
  maxHelpReached: HelpLevel;
  support: SupportPolicy;
  /** Brain-only sessions have no AI by design (E1). */
  mode?: SessionMode;
  /**
   * B7 — the student pressed "I'm stuck". It changes the copy so the escalation
   * is explicit, and nothing else. It does not open the gate.
   */
  stuck?: boolean;
}

export interface HelpGateResult {
  /** The rung the student may take next, or null while the gate is shut. */
  nextHelpAvailable: HelpLevel | null;
  /** User-facing copy explaining a shut gate. Null when help is available. */
  reason: string | null;
  solutionAvailable: boolean;
}

/**
 * Attempts a student must have submitted before a given rung opens.
 *
 * The first hint costs `attemptsBeforeHelp` attempts (B1) and each further rung
 * costs one more, so escalation is always paid for with fresh thinking. The
 * worked solution has its own bar (B4) and every rung is capped at that bar, so
 * the ladder never asks for more work than the solution itself.
 */
export function attemptsRequiredFor(help: HelpLevel, support: SupportPolicy): number {
  if (help === "none") return 0;
  if (help === "solution") return support.attemptsBeforeSolution;
  return Math.min(
    support.attemptsBeforeHelp + helpRank(help) - 1,
    support.attemptsBeforeSolution,
  );
}

/**
 * The single enforcement point for B1 (no help before an attempt) and B4 (no
 * worked solution before the effort bar). There is no argument that bypasses
 * it: "I'm stuck" and low support levels change the wording, never the rule.
 */
export function helpGate(state: HelpGateState): HelpGateResult {
  const support = state.support;
  const attemptsMade = Math.max(0, Math.floor(state.attemptsMade || 0));
  const ceiling = helpRank(support.maxHelp);
  const reached = helpRank(state.maxHelpReached);

  const solutionAvailable =
    ceiling >= helpRank("solution") &&
    attemptsMade >= attemptsRequiredFor("solution", support);

  // E1 — a brain-only session withholds AI for its whole length, whatever the
  // fading level says.
  if (state.mode === "brain_only") {
    return {
      nextHelpAvailable: null,
      reason:
        "Brain-only session. No AI until you finish — check your answers against the key at the end.",
      solutionAvailable: false,
    };
  }

  // Level 5 has no ladder at all (D1). It never returns a help level.
  if (ceiling === 0) {
    return {
      nextHelpAvailable: null,
      reason: "You're on no AI. Solve it, then check your answer against the key.",
      solutionAvailable: false,
    };
  }

  if (reached >= ceiling) {
    return {
      nextHelpAvailable: null,
      reason:
        "You've had every hint this level offers. Work the next step from what you have.",
      solutionAvailable,
    };
  }

  const next = HELP_LEVELS[reached + 1];
  const required = attemptsRequiredFor(next, support);

  if (attemptsMade >= required) {
    return { nextHelpAvailable: next, reason: null, solutionAvailable };
  }

  return {
    nextHelpAvailable: null,
    reason: gateReason(next, attemptsMade, required, state.stuck === true),
    solutionAvailable,
  };
}

function gateReason(
  next: HelpLevel,
  attemptsMade: number,
  required: number,
  stuck: boolean,
): string {
  if (next === "solution") {
    return `The worked solution opens after ${required} attempts. You're on ${attemptsMade}.`;
  }
  if (attemptsMade === 0) {
    return stuck
      ? "Submit an attempt first. Put down what you do know and the hints open."
      : "Submit an attempt first.";
  }
  const deficit = required - attemptsMade;
  return deficit === 1
    ? "One more attempt before the next hint."
    : `${deficit} more attempts before the next hint.`;
}
