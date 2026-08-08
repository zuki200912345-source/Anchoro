// Shared contract for the research-backed layer (RESEARCH-SPEC.md).
// Every module in lib/research and every /api/learn route builds against this.

export const ITEM_KINDS = ["retrieval", "reasoning", "transfer", "practice"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

// The help ladder (Feature B/C). Ordered: index is the escalation step.
// 'strategy' is the ungrounded fallback the tutor must use when it cannot
// ground a hint against the verified key (B8, I4).
export const HELP_LEVELS = [
  "none",
  "strategy",
  "question",
  "narrow",
  "next_step",
  "solution",
] as const;
export type HelpLevel = (typeof HELP_LEVELS)[number];

export const helpRank = (l: HelpLevel) => HELP_LEVELS.indexOf(l);

export const ATTEMPT_OUTCOMES = [
  "correct",
  "incorrect",
  "partial",
  "skipped",
  "low_effort",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const SESSION_MODES = ["assisted", "brain_only", "review", "transfer"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

// ---------------------------------------------------------------------------
// Feature D — AI fading. Level 1 = strongest support, 5 = no AI at all.
// ---------------------------------------------------------------------------

export type SupportLevel = 1 | 2 | 3 | 4 | 5;

export interface SupportPolicy {
  level: SupportLevel;
  label: string;
  /** Highest help the student may reach at this level. */
  maxHelp: HelpLevel;
  /** Attempts required before the FIRST hint unlocks (B1). */
  attemptsBeforeHelp: number;
  /** Attempts required before the worked solution unlocks (B4). */
  attemptsBeforeSolution: number;
  description: string;
}

// Level 5 withholds AI entirely — the student still sees the key afterwards to
// self-check, which is Brain-Only behaviour applied as a fading endpoint (E2).
export const SUPPORT_POLICIES: Record<SupportLevel, SupportPolicy> = {
  1: {
    level: 1,
    label: "Full scaffolding",
    maxHelp: "solution",
    attemptsBeforeHelp: 1,
    attemptsBeforeSolution: 3,
    description: "Hints after your first attempt, worked solution after three.",
  },
  2: {
    level: 2,
    label: "Standard",
    maxHelp: "solution",
    attemptsBeforeHelp: 1,
    attemptsBeforeSolution: 4,
    description: "Hints after your first attempt. Solution takes more work.",
  },
  3: {
    level: 3,
    label: "Lighter hints",
    maxHelp: "next_step",
    attemptsBeforeHelp: 2,
    attemptsBeforeSolution: 5,
    description: "Two attempts before a hint. No full solution.",
  },
  4: {
    level: 4,
    label: "Questions only",
    maxHelp: "question",
    attemptsBeforeHelp: 2,
    attemptsBeforeSolution: 99,
    description: "You get questions back, never answers.",
  },
  5: {
    level: 5,
    label: "No AI",
    maxHelp: "none",
    attemptsBeforeHelp: 99,
    attemptsBeforeSolution: 99,
    description: "Unaided. Check against the key when you finish.",
  },
};

// ---------------------------------------------------------------------------
// XP — independence-weighted (§10). Completion earns nothing (R4).
// ---------------------------------------------------------------------------

export const XP = {
  independentSolution: 10,
  persistenceAfterError: 5,
  selfExplanation: 5,
  selfCorrection: 5,
  transferSolved: 10,
  strategicHintUse: 2,
  unnecessaryDependence: 0,
} as const;

export interface XpBreakdownLine {
  key: keyof typeof XP;
  label: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// Feature F — independence profile. A set of dimensions, never one number (R1).
// Every dimension carries its sample size so the UI can show uncertainty (F3).
// ---------------------------------------------------------------------------

export const PROXY_DISCLAIMER =
  "A behavioural proxy measured inside Anchor, not a validated psychological test.";

export interface Dimension {
  key:
    | "unaided_accuracy"
    | "hint_reliance"
    | "persistence"
    | "delayed_retention"
    | "transfer"
    | "calibration";
  label: string;
  /** 0–100, or null when there is not enough data to say anything. */
  value: number | null;
  /** Wilson 95% half-width, in percentage points. Null when value is null. */
  ci: number | null;
  sample: number;
  /** True when a lower number is better (hint reliance, calibration error). */
  lowerIsBetter: boolean;
  definition: string;
  trend: number | null;
}

export interface IndependenceProfile {
  dimensions: Dimension[];
  /** Assisted accuracy minus unaided accuracy — the dependence signal (M4). */
  assistedUnaidedGap: number | null;
  gapSample: number;
  daysCovered: number;
}

// ---------------------------------------------------------------------------
// Attempt-first engine (Feature B)
// ---------------------------------------------------------------------------

export interface PublicItem {
  id: string;
  kind: ItemKind;
  subject: string;
  topic: string;
  skill: string;
  difficulty: number;
  stem: string;
  distractors: string[] | null;
}

export interface AttemptState {
  attemptId: string;
  item: PublicItem;
  mode: SessionMode;
  support: SupportPolicy;
  attemptsMade: number;
  maxHelpReached: HelpLevel;
  /** Null until the gate opens; the reason explains why when it is closed. */
  nextHelpAvailable: HelpLevel | null;
  helpGateReason: string | null;
  solutionAvailable: boolean;
  confidenceBefore: number | null;
  steps: {
    index: number;
    kind: string;
    helpLevel: HelpLevel | null;
    aiOutput: string | null;
    grounded: boolean | null;
    outcome: AttemptOutcome | null;
  }[];
}

// ---------------------------------------------------------------------------
// Feature I — structured, key-grounded feedback. Fixed schema constrains
// hallucination (Béchard & Marquez 2024). The five required parts come
// verbatim from I.7.
// ---------------------------------------------------------------------------

export interface StructuredFeedback {
  whatWasCorrect: string;
  whereReasoningWeakened: string;
  howIndependently: string;
  assistanceOveruse: string;
  nextStrategy: string;
  /** I5 — why this feedback could be wrong. A cognitive forcing function. */
  counterExplanation: string | null;
  grounded: boolean;
  /** I4 — set when the model declined rather than guessed. */
  refused: boolean;
  refusalReason: string | null;
}

// ---------------------------------------------------------------------------
// Experiments (§13). Arms are sticky per user per experiment.
// ---------------------------------------------------------------------------

export const EXPERIMENTS = {
  attempt_first: ["control", "treatment"],
  tutor_style: ["control", "treatment"],
  gamification: ["arm_a", "arm_b", "arm_c"],
  feedback_style: ["control", "treatment"],
  fading: ["control", "treatment"],
  model_switch: ["control", "treatment"],
} as const;

export type ExperimentName = keyof typeof EXPERIMENTS;
export type Arm = "control" | "treatment" | "arm_a" | "arm_b" | "arm_c";

export const EXPERIMENT_DEFINITIONS: Record<
  ExperimentName,
  { question: string; control: string; treatment: string; primaryOutcome: string }
> = {
  attempt_first: {
    question: "Does requiring an attempt before help improve unaided performance?",
    control: "Answer on demand",
    treatment: "Attempt-first with scaffolded fading hints",
    primaryOutcome: "Unaided post-test accuracy, transfer, persistence",
  },
  tutor_style: {
    question: "Does a hint-first tutor beat an answer-first tutor?",
    control: "Answer-first",
    treatment: "Hint-first Socratic",
    primaryOutcome: "Unaided post-test accuracy",
  },
  gamification: {
    question: "Does independence-weighted XP improve retention without shallow engagement?",
    control: "independence XP / completion XP / no XP",
    treatment: "—",
    primaryOutcome: "Delayed retention, speed-gaming indicators",
  },
  feedback_style: {
    question: "Does key-grounded rubric feedback beat free-form generation?",
    control: "Free-form generative",
    treatment: "Rubric and key grounded",
    primaryOutcome: "Learning gain, feedback-accuracy audit",
  },
  fading: {
    question: "Does adaptive fading beat fixed support?",
    control: "Fixed support level",
    treatment: "Adaptive fading",
    primaryOutcome: "Unaided success rate over time",
  },
  model_switch: {
    question: "Does forced restatement in a fresh session reduce over-reliance?",
    control: "Continuous session",
    treatment: "Session reset with restatement",
    primaryOutcome: "Retrieval, over-reliance (probe only — unmarketed)",
  },
};
