"use client";

// The attempt-first screen (B7, verbatim): problem appears → student submits
// initial reasoning or answer → Anchor evaluates → targeted hint → second
// attempt → escalating hints → full solution only after sufficient effort.
//
// This component owns the order of that flow and nothing else. Every decision
// that could be gamed lives on the server: what the next hint is, whether the
// gate is open, whether the answer is right (I6). The client reads
// `AttemptState` and renders what it is told — it never computes correctness,
// never sees the key, and never has a code path that skips the gate (B1).

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AttemptChain } from "@/components/learn/attempt-chain";
import { AttemptForm } from "@/components/learn/attempt-form";
import { CalibrationResult } from "@/components/learn/calibration-result";
import { ConfidenceSlider } from "@/components/learn/confidence-slider";
import { framingLine, outcomeHeadline } from "@/components/learn/framing";
import { HintLadder } from "@/components/learn/hint-ladder";
import { ItemStem } from "@/components/learn/item-stem";
import { SelfExplanation } from "@/components/learn/self-explanation";
import { SolutionPanel } from "@/components/learn/solution-panel";
import { StructuredFeedbackPanel } from "@/components/learn/structured-feedback";
import { TutorPanel, type TutorMessage } from "@/components/learn/tutor-panel";
import { AiConsentCard, useAiConsent } from "@/components/learn/ai-consent";
import { XpBreakdown } from "@/components/learn/xp-breakdown";
import type {
  AttemptOutcome,
  AttemptState,
  SessionMode,
  StructuredFeedback,
} from "@/lib/research/types";
import {
  hintsTaken,
  LearnApiError,
  postLearn,
  solutionSeen,
  type AttemptResponse,
  type ExplainBackResponse,
  type FinishResponse,
  type HintResponse,
  type SolutionResponse,
  type StartResponse,
  type StuckResponse,
  type TutorResponse,
  type XpAward,
} from "./api";

type Phase = "loading" | "error" | "active" | "done";
type Busy =
  | null
  | "start"
  | "attempt"
  | "hint"
  | "stuck"
  | "solution"
  | "finish"
  | "tutor"
  | "explain";

type Step = AttemptState["steps"][number];

function say(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Appends a step the server reported outside `state.steps`. Nothing is
 * invented: it only runs when a route returned hint text that the returned
 * state does not already carry, so the chain cannot lose a rung the student
 * actually paid for.
 */
function withStep(state: AttemptState, step: Omit<Step, "index">): AttemptState {
  const already = state.steps.some(
    (s) => s.kind === step.kind && s.aiOutput === step.aiOutput,
  );
  if (already) return state;
  return {
    ...state,
    steps: [...state.steps, { ...step, index: state.steps.length }],
  };
}

/** Keeps the visible chain in step with what was actually submitted. */
function withAttemptSteps(
  state: AttemptState,
  answerCount: number,
  outcome: AttemptOutcome,
): AttemptState {
  const recorded = state.steps.filter((s) => s.kind === "attempt").length;
  if (recorded >= answerCount) return state;
  const steps = [...state.steps];
  for (let i = recorded; i < answerCount; i++) {
    steps.push({
      index: steps.length,
      kind: "attempt",
      helpLevel: null,
      aiOutput: null,
      grounded: null,
      outcome: i === answerCount - 1 ? outcome : null,
    });
  }
  return { ...state, steps };
}

export function LearnClient({
  mode,
  subject,
  topic,
}: {
  mode: SessionMode;
  subject?: string;
  topic?: string;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState<Busy>(null);
  const [state, setState] = useState<AttemptState | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<AttemptOutcome | null>(null);
  const [solutionText, setSolutionText] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<StructuredFeedback | null>(null);
  const [xp, setXp] = useState<XpAward | null>(null);
  const [nextReview, setNextReview] = useState<string | null>(null);
  const [tutorTurns, setTutorTurns] = useState<TutorMessage[]>([]);
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [aiConsent, agreeToAi] = useAiConsent();
  const [explainResult, setExplainResult] =
    useState<ExplainBackResponse | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const started = useRef(false);

  /**
   * A refused call is still information. Gate refusals carry the current state
   * with them, so the ladder and the requirement lines stay accurate instead of
   * going stale behind an error message.
   */
  const applyFailure = useCallback((e: unknown, fallback: string) => {
    if (e instanceof LearnApiError && e.state) setState(e.state);
    setNotice(say(e, fallback));
  }, []);

  // -------------------------------------------------------------------------
  // Starting an item
  // -------------------------------------------------------------------------

  const start = useCallback(async () => {
    setPhase("loading");
    setBusy("start");
    setNotice(null);
    setFatal(null);
    setState(null);
    setAnswers([]);
    setConfidence(null);
    setOutcome(null);
    setSolutionText(null);
    setFeedback(null);
    setXp(null);
    setNextReview(null);
    setTutorTurns([]);
    setTutorError(null);
    setExplainResult(null);
    setExplainError(null);
    setStatus("Loading a problem.");
    try {
      const res = await postLearn<StartResponse>("start", {
        mode,
        subject,
        topic,
      });
      setState(res.state);
      // /start can hand back an item that was already open (H1 rating included).
      if (res.state.confidenceBefore !== null) {
        setConfidence(res.state.confidenceBefore);
      }
      setPhase("active");
      setStatus("Problem ready. Rate your confidence, then submit an attempt.");
    } catch (e) {
      setFatal(say(e, "Could not load a problem."));
      setPhase("error");
    } finally {
      setBusy(null);
    }
  }, [mode, subject, topic]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, [start]);

  // -------------------------------------------------------------------------
  // Finishing — feedback, xp and the next review date arrive together
  // -------------------------------------------------------------------------

  const finish = useCallback(async (attemptId: string) => {
    setBusy("finish");
    try {
      const res = await postLearn<FinishResponse>("finish", { attemptId });
      if (res.feedback) setFeedback(res.feedback);
      if (res.xp) setXp(res.xp);
      if (res.nextReview) setNextReview(res.nextReview);
      setStatus("Item finished. Feedback is below.");
    } catch (e) {
      // /attempt already returned the feedback, xp and review date for a solved
      // item, so a missing finish route is not something to shout about. A real
      // failure still is.
      const status = e instanceof LearnApiError ? e.status : 0;
      if (status !== 404 && status !== 405) {
        setNotice(say(e, "The feedback didn't load. The attempt is still saved."));
      }
    } finally {
      setBusy(null);
      setPhase("done");
    }
  }, []);

  // -------------------------------------------------------------------------
  // The attempt — the gate for everything else (B1)
  // -------------------------------------------------------------------------

  const submitAttempt = useCallback(
    async (answer: string) => {
      if (!state || busy) return;
      setBusy("attempt");
      setNotice(null);
      const count = answers.length + 1;
      try {
        const res = await postLearn<AttemptResponse>("attempt", {
          attemptId: state.attemptId,
          answer,
          confidence: state.attemptsMade === 0 ? confidence : undefined,
        });
        setAnswers((a) => [...a, answer]);
        setState(withAttemptSteps(res.state, count, res.outcome));
        setOutcome(res.outcome);
        if (res.xp) setXp(res.xp);
        if (res.feedback) setFeedback(res.feedback);
        if (res.nextReview) setNextReview(res.nextReview);

        if (res.outcome === "low_effort") {
          setNotice(
            "That one was too thin to count as an attempt. Put down what you actually tried and the ladder moves.",
          );
        }
        setStatus(
          `${outcomeHeadline(res.outcome)} ${
            res.outcome === "correct"
              ? "Pulling your feedback together."
              : res.state.helpGateReason ?? "Next hint is available."
          }`,
        );

        if (res.outcome === "correct") {
          setBusy(null);
          await finish(state.attemptId);
          return;
        }
      } catch (e) {
        applyFailure(e, "That attempt didn't save. Try submitting it again.");
      } finally {
        setBusy(null);
      }
    },
    [state, busy, answers.length, confidence, finish, applyFailure],
  );

  // -------------------------------------------------------------------------
  // The ladder
  // -------------------------------------------------------------------------

  const requestHint = useCallback(async () => {
    if (!state || busy) return;
    setBusy("hint");
    setNotice(null);
    try {
      const res = await postLearn<HintResponse>("hint", {
        attemptId: state.attemptId,
      });
      setState(
        withStep(res.state, {
          kind: "hint",
          helpLevel: res.helpLevel,
          aiOutput: res.text,
          grounded: res.grounded,
          outcome: null,
        }),
      );
      setStatus(
        res.grounded
          ? "Hint shown. It is in the chain above the answer box."
          : "General strategy shown. It could not be grounded in the solution.",
      );
    } catch (e) {
      // A 403 here is the gate, not a fault. Show its reason as copy.
      applyFailure(e, "No hint right now.");
    } finally {
      setBusy(null);
    }
  }, [state, busy, applyFailure]);

  const requestStuck = useCallback(async () => {
    if (!state || busy) return;
    setBusy("stuck");
    setNotice(null);
    try {
      const res = await postLearn<StuckResponse>("stuck", {
        attemptId: state.attemptId,
      });
      const base = res.state ?? state;
      setState(
        res.text
          ? withStep(base, {
              kind: "stuck",
              helpLevel: res.helpLevel ?? null,
              aiOutput: res.text,
              grounded: res.grounded ?? null,
              outcome: null,
            })
          : base,
      );
      const line = res.escalation ?? res.reason ?? null;
      if (line) setNotice(line);
      setStatus(res.text ? "Escalation shown above the answer box." : (line ?? "Noted."));
    } catch (e) {
      applyFailure(e, "Couldn't escalate that. Try again.");
    } finally {
      setBusy(null);
    }
  }, [state, busy, applyFailure]);

  const revealSolution = useCallback(async () => {
    if (!state || busy) return;
    setBusy("solution");
    setNotice(null);
    try {
      const res = await postLearn<SolutionResponse>("solution", {
        attemptId: state.attemptId,
      });
      const text = res.text ?? res.solution ?? res.workedSolution ?? null;
      setSolutionText(text);
      if (res.state) {
        setState(
          text
            ? withStep(res.state, {
                kind: "hint",
                helpLevel: "solution",
                aiOutput: text,
                grounded: true,
                outcome: null,
              })
            : res.state,
        );
      }
      setStatus("Worked solution shown.");
    } catch (e) {
      applyFailure(e, "The worked solution isn't open yet.");
    } finally {
      setBusy(null);
    }
  }, [state, busy, applyFailure]);

  // -------------------------------------------------------------------------
  // Tutor and explain-back
  // -------------------------------------------------------------------------

  const sendTutor = useCallback(
    async (message: string) => {
      if (!state || busy) return;
      setBusy("tutor");
      setTutorError(null);
      setTutorTurns((t) => [...t, { role: "student", content: message }]);
      try {
        const res = await postLearn<TutorResponse>("tutor", {
          attemptId: state.attemptId,
          message,
        });
        setTutorTurns((t) => [
          ...t,
          {
            role: "tutor",
            content: res.reply,
            refused: res.refused,
            refusalReason: res.refusalReason ?? null,
            misconceptionTag: res.misconceptionTag ?? null,
          },
        ]);
        // A tutor turn is assistance, so the ladder can move under it.
        if (res.state) setState(res.state);
        setStatus(res.refused ? "The tutor declined that one." : "The tutor replied.");
      } catch (e) {
        if (e instanceof LearnApiError && e.state) setState(e.state);
        setTutorError(say(e, "The tutor didn't answer. Try again."));
      } finally {
        setBusy(null);
      }
    },
    [state, busy],
  );

  const sendExplanation = useCallback(
    async (explanation: string) => {
      if (!state || busy) return;
      setBusy("explain");
      setExplainError(null);
      try {
        const res = await postLearn<ExplainBackResponse>("explain-back", {
          attemptId: state.attemptId,
          explanation,
        });
        setExplainResult(res);
        if (res.xp) setXp(res.xp);
        if (res.state) setState(res.state);
        setStatus("Explanation scored.");
      } catch (e) {
        setExplainError(say(e, "That didn't send. Try again."));
      } finally {
        setBusy(null);
      }
    },
    [state, busy],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (phase === "error") {
    return (
      <ErrorPane message={fatal ?? "Could not load a problem."} onRetry={start} />
    );
  }

  if (phase === "loading" || !state) {
    return (
      <div className="flex flex-col gap-4">
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
        <div className="plane h-56 animate-pulse" aria-label="loading a problem" />
      </div>
    );
  }

  const hints = hintsTaken(state);
  const solved = outcome === "correct";
  const sawSolution = solutionSeen(state) || solutionText !== null;
  const needsConfidence = state.attemptsMade === 0 && confidence === null;

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <ItemStem item={state.item} mode={state.mode} />

      {notice ? (
        <p className="plane-sm p-3 text-sm" role="status">
          {notice}
        </p>
      ) : null}

      <AttemptChain steps={state.steps} answers={answers} />

      {phase === "active" ? (
        <>
          <ConfidenceSlider
            value={confidence}
            onChange={setConfidence}
            locked={state.attemptsMade > 0}
            disabled={busy === "attempt"}
          />

          <AttemptForm
            attemptNumber={state.attemptsMade + 1}
            needsConfidence={needsConfidence}
            pending={busy === "attempt"}
            onSubmit={submitAttempt}
          />

          {aiConsent === false ? (
            <AiConsentCard onAgree={agreeToAi} />
          ) : aiConsent === true ? (
            <HintLadder
              state={state}
              pending={busy === "hint"}
              stuckPending={busy === "stuck"}
              onHint={requestHint}
              onStuck={requestStuck}
            />
          ) : null}

          <SolutionPanel
            state={state}
            solutionText={solutionText}
            pending={busy === "solution"}
            onReveal={revealSolution}
          />

          {aiConsent === true ? (
            <TutorPanel
              turns={tutorTurns}
              pending={busy === "tutor"}
              error={tutorError}
              gateReason={
                // B1 applies to the dialogue too, on the same policy number the
                // hints use — so the answer-on-demand arm is not silently changed.
                state.attemptsMade < state.support.attemptsBeforeHelp
                  ? state.support.attemptsBeforeHelp === 1
                    ? "Submit an attempt first. The tutor starts from what you tried."
                    : `${state.support.attemptsBeforeHelp} attempts before the tutor. It starts from what you tried.`
                  : null
              }
              onSend={sendTutor}
            />
          ) : null}

          {state.attemptsMade >= 1 ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="quiet"
                onClick={() => finish(state.attemptId)}
                disabled={busy !== null}
                className="min-h-11 self-start"
              >
                {busy === "finish" ? "Wrapping up…" : "Stop here and see feedback"}
              </Button>
              <p className="text-xs text-slate">
                Stopping is recorded as stopping. It does not count against the
                answer.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <section className="plane p-5" aria-labelledby="result-heading">
            <h2
              id="result-heading"
              className="font-display text-xl font-extrabold tracking-tight"
            >
              {outcomeHeadline(outcome)}
            </h2>
            <p className="mt-1 text-sm">
              {framingLine({
                outcome,
                hintsTaken: hints,
                attempts: answers.length || state.attemptsMade,
                solutionRevealed: sawSolution,
              })}
            </p>
            {nextReview ? (
              <p className="mt-3 text-xs text-slate">
                Back for a delayed re-test on{" "}
                <span className="num">{formatDate(nextReview)}</span>. The gap is
                where retention gets measured, not today.
              </p>
            ) : null}
          </section>

          <CalibrationResult
            predicted={state.confidenceBefore ?? confidence}
            correct={solved}
          />

          {feedback ? <StructuredFeedbackPanel feedback={feedback} /> : null}

          {/* E2 — the item is over, so the key is there to check against and
              costs nothing now. */}
          <SolutionPanel
            state={state}
            solutionText={solutionText}
            pending={busy === "solution"}
            selfCheck
            onReveal={revealSolution}
          />

          {xp ? <XpBreakdown xp={xp} /> : null}

          <SelfExplanation
            topic={state.item.topic}
            result={explainResult}
            pending={busy === "explain"}
            error={explainError}
            onSubmit={sendExplanation}
          />

          <Button
            type="button"
            onClick={start}
            disabled={busy !== null}
            className="min-h-11 self-start"
          >
            Next problem
          </Button>
        </>
      )}
    </div>
  );
}

function ErrorPane({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="plane p-5">
      <p className="text-sm">{message}</p>
      <Button
        type="button"
        variant="secondary"
        onClick={onRetry}
        className="mt-3 min-h-11"
      >
        Try again
      </Button>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
