// Client-side view of the /api/learn contract (RESEARCH-API.md).
//
// Only the shapes the UI reads live here. The answer key is never among them:
// items arrive through `items_public` and grading happens server-side (I3, I6).
// A 403 from /hint or /solution is not an error state — it is the gate doing
// its job (B1, B4), so `LearnApiError` carries the status through and the
// caller shows the reason as copy.

import type {
  ExplainBackResult,
  XpAward,
} from "@/components/learn/types";
import type {
  AttemptOutcome,
  AttemptState,
  HelpLevel,
  StructuredFeedback,
} from "@/lib/research/types";

export type { ExplainBackResult, XpAward };

export interface StartResponse {
  attemptId: string;
  state: AttemptState;
}

export interface AttemptResponse {
  outcome: AttemptOutcome;
  state: AttemptState;
  xp?: XpAward | null;
  feedback?: StructuredFeedback | null;
  /** N8 — set when grading scheduled the delayed re-test. */
  nextReview?: string | null;
}

export interface HintResponse {
  helpLevel: HelpLevel;
  text: string;
  grounded: boolean;
  state: AttemptState;
}

/**
 * B7 — "I'm stuck" is an escalation path, not a bypass. The route may answer
 * with a hint, with a redirect to the tutor, or with the gate reason; every
 * field is optional so none of those cases breaks the screen.
 */
export interface StuckResponse {
  helpLevel?: HelpLevel | null;
  text?: string | null;
  grounded?: boolean | null;
  escalation?: string | null;
  reason?: string | null;
  state?: AttemptState | null;
}

export interface SolutionResponse {
  text?: string | null;
  solution?: string | null;
  workedSolution?: string | null;
  /** E2 — served after the item finished, so nothing was spent on it. */
  selfCheck?: boolean;
  state?: AttemptState | null;
}

export interface FinishResponse {
  feedback?: StructuredFeedback | null;
  xp?: XpAward | null;
  nextReview?: string | null;
}

export interface ExplainBackResponse extends ExplainBackResult {
  xp?: XpAward | null;
  state?: AttemptState | null;
}

export interface TutorResponse {
  reply: string;
  misconceptionTag?: string | null;
  refused: boolean;
  refusalReason?: string | null;
  /** A tutor turn counts as help, so the ladder can move underneath it. */
  state?: AttemptState | null;
}

export class LearnApiError extends Error {
  readonly status: number;
  /** Gate refusals ship the current state with the reason; keep it. */
  readonly state: AttemptState | null;
  constructor(message: string, status: number, state: AttemptState | null = null) {
    super(message);
    this.name = "LearnApiError";
    this.status = status;
    this.state = state;
  }
}

/** Narrow an unknown error body to an AttemptState without trusting it blindly. */
function stateFrom(body: unknown): AttemptState | null {
  if (!body || typeof body !== "object") return null;
  const inner = (body as { state?: unknown }).state;
  if (!inner || typeof inner !== "object") return null;
  return "attemptId" in inner && "item" in inner && "support" in inner
    ? (inner as AttemptState)
    : null;
}

/** Every route is POST, JSON in, JSON out, `{ error }` on failure. */
export async function postLearn<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/learn/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new LearnApiError("The connection dropped. Try that again.", 0);
  }

  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!res.ok) {
    throw new LearnApiError(
      data?.error ?? "That didn't go through. Try again.",
      res.status,
      stateFrom(data),
    );
  }
  if (!data) {
    throw new LearnApiError("The server sent nothing back. Try again.", res.status);
  }
  return data;
}

/** Number of hints taken so far, worked solution excluded. */
export function hintsTaken(state: AttemptState): number {
  return state.steps.filter(
    (s) => s.kind === "hint" && s.helpLevel !== "solution",
  ).length;
}

export function solutionSeen(state: AttemptState): boolean {
  return state.steps.some((s) => s.helpLevel === "solution");
}
