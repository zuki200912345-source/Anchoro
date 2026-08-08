import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  helpRank,
  type AttemptOutcome,
  type HelpLevel,
  type ItemKind,
  type StructuredFeedback,
  type SupportLevel,
  type SupportPolicy,
} from "@/lib/research/types";

// Feature C (Socratic tutor) and Feature I (key-grounded structured feedback).
//
// Two rules shape every function in this file:
//
//   I3 — the verified answer key is loaded server-side, used to ground the
//        output, and never sent to the client.
//   I6 — the model phrases hints and diagnoses working. It never decides
//        whether the student is right. Correctness arrives here already graded.
//
// Everything degrades to deterministic text when ANTHROPIC_API_KEY is absent or
// the call fails, and `grounded: false` marks any output that does not follow
// from the key (B8, I4).

// AI_MODEL + ANTHROPIC_BASE_URL let dev point at any Anthropic-compatible
// provider (e.g. DeepSeek); the default stays the spec's pinned model.
const MODEL = process.env.AI_MODEL ?? "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // AI_BASE_URL, not ANTHROPIC_BASE_URL: the latter can be shadowed by a
  // pre-existing shell export, which .env.local never overrides.
  if (!_client) _client = new Anthropic({ baseURL: process.env.AI_BASE_URL || undefined });
  return _client;
}

const VOICE =
  "Voice: direct, dry, a little competitive, talking to a sharp 16-year-old. " +
  "Sentence case. Never use these words: delve, seamless, robust, leverage, elevate, " +
  "empower, unlock, harness, tapestry, realm, journey, landscape, testament, underscore, " +
  "showcase, foster, pivotal, crucial, meticulous, intricate, vibrant, transformative, " +
  "unleash, supercharge, game-changer, cutting-edge, holistic, curated, bespoke. " +
  "No 'dive in', no 'level up your', no rhetorical flourishes, at most one em dash. " +
  "Never praise the person, only the working. Never mention intelligence, ability, " +
  "talent, IQ or being clever.";

/** Kestin et al. fixed cognitive overload by forcing brevity (C8). */
const HINT_MAX_WORDS = 30;
const TUTOR_MAX_WORDS = 45;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The server-side view of an item. Never hand this to a client. */
export interface TutorItem {
  id: string;
  kind: ItemKind;
  subject: string;
  topic: string;
  skill: string;
  difficulty: number;
  stem: string;
  worked_solution?: string | null;
  /** jsonb: tag -> description (C3). */
  common_misconceptions?: unknown;
  /** jsonb marking scheme (I2). */
  rubric?: unknown;
}

/** One link of the attempt chain (B2). */
export interface AttemptRecord {
  index: number;
  answer: string;
  outcome: AttemptOutcome | null;
  helpLevel?: HelpLevel | null;
}

export interface HintResult {
  text: string;
  /** True when the hint is about THIS item and consistent with the verified
   *  key. False marks the generic strategy fallback, which says nothing about
   *  the item because nothing could be grounded (B8, I4). */
  grounded: boolean;
}

export interface AttemptDiagnosis {
  /** Always one of the item's own misconception tags, or null. Never invented. */
  misconceptionTag: string | null;
  diagnosis: string;
}

export interface TutorTurn {
  role: "student" | "tutor";
  content: string;
}

export interface SocraticResult {
  reply: string;
  misconceptionTag: string | null;
  refused: boolean;
  refusalReason: string | null;
}

export interface AttemptSummary {
  finalAnswer: string;
  /** Graded deterministically before this module is called (I6). */
  outcome: AttemptOutcome;
  attemptsMade: number;
  hintsRequested: number;
  maxHelpReached: HelpLevel;
  solutionRevealed: boolean;
  unaided: boolean;
  selfCorrected: boolean;
  persistedAfterError: boolean;
  thinkMs?: number | null;
  chain?: AttemptRecord[];
}

export interface IndependenceContext {
  supportLevel: SupportLevel;
  /** Recent behavioural proxies, or null when there is not enough data (F3). */
  hintReliancePct: number | null;
  unaidedAccuracyPct: number | null;
  sample: number;
}

export interface RubricLine {
  key: string;
  label: string;
  max: number;
  awarded: number;
  note: string;
}

export interface SelfExplanationScore {
  /** 0–100. */
  score: number;
  rubric: RubricLine[];
  /** False when the judgement component fell back to the deterministic rubric. */
  modelScored: boolean;
}

// ---------------------------------------------------------------------------
// Reading the verified key
// ---------------------------------------------------------------------------

interface KeyFacts {
  answerText: string | null;
  steps: string[];
  strategy: string | null;
  workedSolution: string | null;
  terms: string[];
  /** False means nothing in the key can ground a hint (B8). */
  usable: boolean;
}

const ANSWER_FIELDS = ["value", "answer", "final", "result", "correct", "expected"];
const STEP_FIELDS = ["steps", "working", "method_steps", "solution_steps"];
const STRATEGY_FIELDS = ["strategy", "method", "approach", "rule", "key_idea", "keyIdea", "concept"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length > 0) {
    const parts = value.map((v) => scalarText(v)).filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : scalarText(entry)))
    .filter((entry): entry is string => Boolean(entry));
}

/** Pulls the facts a hint may be grounded in out of the jsonb key and rubric. */
function readKey(answerKey: unknown, item: TutorItem): KeyFacts {
  let answerText: string | null = null;
  let steps: string[] = [];
  let strategy: string | null = null;

  if (typeof answerKey === "string" || typeof answerKey === "number") {
    answerText = String(answerKey).trim() || null;
  } else if (Array.isArray(answerKey)) {
    steps = stringList(answerKey);
    answerText = steps.length > 0 ? steps[steps.length - 1] : null;
  } else if (isRecord(answerKey)) {
    for (const field of ANSWER_FIELDS) {
      if (answerText) break;
      answerText = scalarText(answerKey[field]);
    }
    for (const field of STEP_FIELDS) {
      if (steps.length > 0) break;
      steps = stringList(answerKey[field]);
    }
    for (const field of STRATEGY_FIELDS) {
      if (strategy) break;
      const found = answerKey[field];
      strategy = typeof found === "string" ? found.trim() || null : null;
    }
  }

  if (steps.length === 0 && isRecord(item.rubric)) {
    for (const field of [...STEP_FIELDS, "criteria", "marks"]) {
      if (steps.length > 0) break;
      steps = stringList(item.rubric[field]);
    }
  }

  // A key that lists steps but names no answer field still has an answer: the
  // last step. Naming it keeps the leak check live instead of silently off.
  if (!answerText && steps.length > 0) answerText = steps[steps.length - 1];

  const workedSolution = item.worked_solution?.trim() || null;
  const terms = keyTerms([
    ...steps,
    strategy ?? "",
    workedSolution ?? "",
    item.topic,
    item.skill,
  ]);

  return {
    answerText,
    steps,
    strategy,
    workedSolution,
    terms,
    usable: Boolean(answerText || steps.length > 0 || strategy || workedSolution),
  };
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "then", "from", "into", "your", "you",
  "are", "was", "were", "have", "has", "its", "it's", "each", "both", "them", "they",
  "what", "when", "which", "where", "will", "would", "there", "their", "than", "step",
  "steps", "find", "using", "use", "get", "one", "two", "all", "any", "not", "but",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

function keyTerms(sources: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const source of sources) {
    for (const word of words(source)) {
      if (word.length < 4 || STOPWORDS.has(word)) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      out.push(word);
    }
  }
  return out.slice(0, 24);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function clip(text: string, maxWords: number): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= maxWords) return text.trim();
  return `${parts.slice(0, maxWords).join(" ").replace(/[,;:.]$/, "")}…`;
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when a line of text would hand over the verified answer. */
function leaksAnswer(text: string, facts: KeyFacts): boolean {
  if (!facts.answerText) return false;
  const target = normalise(facts.answerText);
  if (target.length === 0) return false;
  if (target.length >= 3) return normalise(text).includes(target);
  return words(text).some((word) => normalise(word) === target);
}

// ---------------------------------------------------------------------------
// Misconceptions (C3)
// ---------------------------------------------------------------------------

export interface Misconception {
  tag: string;
  description: string;
}

/** Normalises the jsonb column, which the schema documents as tag -> description. */
export function readMisconceptions(value: unknown): Misconception[] {
  const out: Misconception[] = [];
  if (isRecord(value)) {
    for (const [tag, description] of Object.entries(value)) {
      const text = scalarText(description);
      if (text) out.push({ tag, description: text });
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        out.push({ tag: entry, description: entry });
      } else if (isRecord(entry)) {
        const tag = scalarText(entry.tag ?? entry.key ?? entry.name);
        const description = scalarText(entry.description ?? entry.text ?? entry.detail);
        if (tag) out.push({ tag, description: description ?? tag });
      }
    }
  }
  return out;
}

/** Deterministic fallback match: overlap between the working and each description. */
function matchMisconception(
  attempt: string,
  misconceptions: Misconception[],
): Misconception | null {
  const attemptWords = new Set(words(attempt).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
  if (attemptWords.size === 0) return null;

  let best: Misconception | null = null;
  let bestScore = 0;
  for (const misconception of misconceptions) {
    const terms = new Set(
      words(`${misconception.tag} ${misconception.description}`).filter(
        (w) => w.length >= 4 && !STOPWORDS.has(w),
      ),
    );
    if (terms.size === 0) continue;
    let hits = 0;
    for (const term of terms) if (attemptWords.has(term)) hits += 1;
    const score = hits / terms.size;
    if (score > bestScore) {
      bestScore = score;
      best = misconception;
    }
  }
  // One shared word out of a long description is noise, not a diagnosis.
  return bestScore >= 0.34 ? best : null;
}

// ---------------------------------------------------------------------------
// Model plumbing
// ---------------------------------------------------------------------------

async function ask(system: string, user: string, maxTokens: number): Promise<string | null> {
  const anthropic = client();
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = response.content[0];
    if (block?.type !== "text") return null;
    const text = block.text.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    // Degrade to the deterministic fallback, but leave the reason in the
    // server log — a silent catch here hides provider outages entirely.
    console.error("[research/tutor] model call failed:", err);
    return null;
  }
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function itemBrief(item: TutorItem, facts: KeyFacts): string {
  return [
    `Subject: ${item.subject}. Topic: ${item.topic}. Skill: ${item.skill}. Difficulty: ${item.difficulty}/10.`,
    `Question shown to the student:\n${item.stem}`,
    `VERIFIED KEY (never repeat it, never paraphrase the final answer):\n${JSON.stringify({
      answer: facts.answerText,
      steps: facts.steps,
      strategy: facts.strategy,
    })}`,
  ].join("\n\n");
}

function chainBrief(chain: readonly AttemptRecord[]): string {
  if (chain.length === 0) return "No attempts recorded yet.";
  return chain
    .map(
      (record) =>
        `${record.index + 1}. "${record.answer}"${record.outcome ? ` — graded ${record.outcome}` : ""}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// C1/C2/C6/C8 + B8 — hints
// ---------------------------------------------------------------------------

const LEVEL_RULES: Record<HelpLevel, string> = {
  none: "",
  strategy:
    "A generic strategy prompt. Use nothing specific from this item or its key.",
  question:
    "A QUESTION, not information. One pointed question that moves their attention. " +
    "It must reveal nothing: not the answer, not the method, not the number of steps.",
  narrow:
    "Narrow the search space with one factual observation about WHERE the work turns. " +
    "Do not state the move to make and do not state the answer.",
  next_step:
    "Exactly one concrete next move — the immediate next step and nothing after it. " +
    "Never the remaining steps, never the final answer.",
  solution: "",
};

/** The ungrounded fallback (B8). Says nothing about this item at all. */
const STRATEGY_PROMPTS = [
  "Write down what you know, what you need, and the one rule that links them. Redo the first line from there.",
  "Say the problem back in your own words, then start again from the line you are most sure of.",
  "Work out what a rough answer should look like before you compute anything, then check your working against it.",
];

function strategyPrompt(item: TutorItem): string {
  // Deterministic, so the same item does not shuffle its fallback between calls.
  const index = normalise(item.id + item.skill).length % STRATEGY_PROMPTS.length;
  return STRATEGY_PROMPTS[index];
}

/** Caps a requested level at what the support policy allows (D1, D2). */
export function effectiveHelpLevel(requested: HelpLevel, policy: SupportPolicy): HelpLevel {
  return helpRank(requested) > helpRank(policy.maxHelp) ? policy.maxHelp : requested;
}

/** Hints derived straight from the verified key. No model, no invention. */
function deterministicHint(level: HelpLevel, item: TutorItem, facts: KeyFacts): HintResult {
  const strategy = strategyPrompt(item);

  if (level === "question") {
    return {
      text: `What is this ${item.topic} question actually asking for, and which part of the setup gives you that?`,
      grounded: true,
    };
  }

  if (level === "narrow") {
    if (facts.strategy) {
      return {
        text: clip(`The route here turns on ${facts.strategy}. Find the first line where your working leaves it.`, HINT_MAX_WORDS),
        grounded: true,
      };
    }
    if (facts.steps.length > 1) {
      return {
        text: `The verified route takes ${facts.steps.length} steps. Find the first line where your working leaves it.`,
        grounded: true,
      };
    }
    return { text: strategy, grounded: false };
  }

  if (level === "next_step") {
    const step = facts.steps[0];
    // A single-step key means step one IS the answer, so it stays behind the
    // solution gate (B4, C6).
    if (step && facts.steps.length > 1 && !leaksAnswer(step, facts)) {
      return { text: clip(`Next move: ${step}`, HINT_MAX_WORDS), grounded: true };
    }
    if (facts.strategy) {
      return {
        text: clip(`Start with ${facts.strategy}, one line only, then stop and check it.`, HINT_MAX_WORDS),
        grounded: true,
      };
    }
    return { text: strategy, grounded: false };
  }

  return { text: strategy, grounded: false };
}

/**
 * One hint at one level, grounded in the verified key (I3, B8).
 *
 * `question` reveals nothing (C1), `narrow` narrows the search space,
 * `next_step` gives one move and never the full answer (C2, C6). Everything
 * stays under 30 words (C8). When the hint cannot be grounded the student gets
 * a generic strategy prompt and `grounded` is false — nothing is invented.
 */
export async function generateHint(args: {
  item: TutorItem;
  answerKey: unknown;
  attemptChain: readonly AttemptRecord[];
  helpLevel: HelpLevel;
  supportPolicy: SupportPolicy;
}): Promise<HintResult> {
  const { item, answerKey, attemptChain, supportPolicy } = args;
  const level = effectiveHelpLevel(args.helpLevel, supportPolicy);
  const facts = readKey(answerKey, item);

  if (level === "none") {
    return {
      text: `No hints at support level ${supportPolicy.level}. Finish the attempt, then check it against the key.`,
      grounded: false,
    };
  }

  // The verified solution is served verbatim. A model rewrite of a checked
  // solution is a hallucination surface for no gain (I3, B4).
  if (level === "solution") {
    const solution = facts.workedSolution ?? (facts.steps.length > 0 ? facts.steps.join(" ") : null);
    if (solution) return { text: solution, grounded: true };
    return {
      text: "No worked solution is stored for this item. Compare your working against the key line by line.",
      grounded: false,
    };
  }

  if (level === "strategy" || !facts.usable) {
    return { text: strategyPrompt(item), grounded: false };
  }

  const system = [
    "You write one hint at a time inside a tool built to stop cognitive offloading.",
    "The student has already committed to an attempt. Your job is to redirect their thinking, not to do it.",
    "You are given the VERIFIED answer key. Ground the hint in it and add nothing that is not in it.",
    "You never decide whether the student is right — that is graded elsewhere, deterministically.",
    `This hint is level '${level}'. ${LEVEL_RULES[level]}`,
    `Support level ${supportPolicy.level} (${supportPolicy.label}): ${supportPolicy.description}`,
    `Hard limits: one or two sentences, under ${HINT_MAX_WORDS} words, no preamble, no quotes, no lists.`,
    "If the key does not let you write this hint without inventing something, reply with exactly: UNGROUNDED",
    VOICE,
  ].join(" ");

  const user = [
    itemBrief(item, facts),
    `Attempt chain so far:\n${chainBrief(attemptChain)}`,
    `Write the '${level}' hint.`,
  ].join("\n\n");

  const raw = await ask(system, user, 200);

  // No key, no call, or a thrown request: the key still grounds a hint on its own.
  if (!raw) return deterministicHint(level, item, facts);

  // The model's own confidence gate (I4). Honour it rather than pushing on.
  if (/\bUNGROUNDED\b/i.test(raw)) return { text: strategyPrompt(item), grounded: false };

  const text = raw.replace(/^["']|["']$/g, "").trim();
  if (wordCount(text) > HINT_MAX_WORDS) return deterministicHint(level, item, facts);
  if (leaksAnswer(text, facts)) return deterministicHint(level, item, facts);

  return { text, grounded: true };
}

// ---------------------------------------------------------------------------
// C3 — naming the misconception
// ---------------------------------------------------------------------------

/**
 * Names what the working suggests went wrong. The tag is always one of the
 * item's own `common_misconceptions` keys or null: the model picks from a
 * closed set and never invents a label (C3, I6).
 */
export async function diagnoseAttempt(args: {
  item: TutorItem;
  answerKey: unknown;
  studentAttempt: string;
}): Promise<AttemptDiagnosis> {
  const { item, answerKey, studentAttempt } = args;
  const facts = readKey(answerKey, item);
  const misconceptions = readMisconceptions(item.common_misconceptions);

  const fallback = (): AttemptDiagnosis => {
    const matched = matchMisconception(studentAttempt, misconceptions);
    if (matched) {
      return {
        misconceptionTag: matched.tag,
        diagnosis: clip(`Your working lines up with a known slip here: ${matched.description}`, 28),
      };
    }
    if (facts.steps.length > 1) {
      return {
        misconceptionTag: null,
        diagnosis: `Your working leaves the verified route somewhere in its ${facts.steps.length} steps. Check it from line one.`,
      };
    }
    return {
      misconceptionTag: null,
      diagnosis: "Nothing in your working matches a known slip. Compare it against the key line by line.",
    };
  };

  if (studentAttempt.trim().length === 0) {
    return {
      misconceptionTag: null,
      diagnosis: "Nothing to diagnose: there is no working to read yet.",
    };
  }
  if (!facts.usable) return fallback();

  const tags = misconceptions.map((m) => m.tag);
  const system = [
    "You diagnose a student's working against a verified answer key inside a learning tool.",
    "You do NOT decide whether the answer is right or wrong — that is graded elsewhere.",
    "Describe what the working suggests they did, in one sentence, focused on the task and never on the person.",
    tags.length > 0
      ? `Choose a tag from this closed list, or null if none fits: ${JSON.stringify(tags)}. Never invent a tag.`
      : "There are no misconception tags for this item, so the tag must be null.",
    'Reply with JSON only: {"tag": string|null, "diagnosis": string}. Under 25 words in the diagnosis.',
    VOICE,
  ].join(" ");

  const user = [
    itemBrief(item, facts),
    misconceptions.length > 0
      ? `Known misconceptions:\n${misconceptions.map((m) => `- ${m.tag}: ${m.description}`).join("\n")}`
      : "Known misconceptions: none recorded.",
    `The student's working:\n${studentAttempt}`,
    "Diagnose it.",
  ].join("\n\n");

  const parsed = parseJson(await ask(system, user, 300));
  if (!parsed) return fallback();

  const diagnosis = scalarText(parsed.diagnosis);
  if (!diagnosis) return fallback();

  const rawTag = scalarText(parsed.tag);
  const misconceptionTag = rawTag && tags.includes(rawTag) ? rawTag : null;

  return { misconceptionTag, diagnosis: clip(diagnosis, 28) };
}

// ---------------------------------------------------------------------------
// C1/C2/C4/C9 — the Socratic turn
// ---------------------------------------------------------------------------

const OPENING_QUESTION =
  "Before I say anything: what did you try, and which line stopped making sense?";
const EXPLAIN_BACK =
  "Say the rule you used back in your own words, then apply it to the first line only.";
const ONE_STEP = "Take one step only. What changes first, and why that one?";

/**
 * One tutor turn. Asks what the student thinks before anything else (C1), moves
 * one step at a time (C2), asks them to explain the idea back (C4), and refuses
 * rather than guessing when the key does not cover their message (C9, I4).
 */
export async function socraticTurn(args: {
  item: TutorItem;
  answerKey: unknown;
  transcript: readonly TutorTurn[];
  studentMessage: string;
  supportPolicy: SupportPolicy;
}): Promise<SocraticResult> {
  const { item, answerKey, transcript, studentMessage, supportPolicy } = args;
  const facts = readKey(answerKey, item);
  const misconceptions = readMisconceptions(item.common_misconceptions);
  const tags = misconceptions.map((m) => m.tag);
  const tutorTurns = transcript.filter((turn) => turn.role === "tutor").length;

  // Support level 5 withholds AI by design (D1, E1).
  if (supportPolicy.maxHelp === "none") {
    return {
      reply: `No tutor at support level ${supportPolicy.level}. Finish the attempt, then check it against the key.`,
      misconceptionTag: null,
      refused: true,
      refusalReason: `Support level ${supportPolicy.level} runs without AI.`,
    };
  }

  const fallback = (): SocraticResult => ({
    reply: tutorTurns === 0 ? OPENING_QUESTION : tutorTurns % 2 === 1 ? EXPLAIN_BACK : ONE_STEP,
    misconceptionTag: matchMisconception(studentMessage, misconceptions)?.tag ?? null,
    refused: false,
    refusalReason: null,
  });

  if (!facts.usable) {
    return {
      reply: OPENING_QUESTION,
      misconceptionTag: null,
      refused: true,
      refusalReason: "No verified key for this item, so I will not guess at the maths.",
    };
  }

  const system = [
    "You are a Socratic tutor inside a tool built to stop cognitive offloading.",
    "You ask what the student thinks first, you move one step at a time, and you never hand over the answer or the remaining steps.",
    "You do NOT decide whether their answer is right — that is graded elsewhere, deterministically.",
    "You are given the VERIFIED key. Ground every reply in it. If their message needs something the key does not cover, refuse instead of guessing.",
    tutorTurns === 0
      ? "This is your first turn: ask what they think before anything else."
      : "At least every second reply, ask them to say the idea back in their own words.",
    `The student may reach help level '${supportPolicy.maxHelp}' at most. Support level ${supportPolicy.level}: ${supportPolicy.description}`,
    tags.length > 0
      ? `If their message shows one of these misconceptions, name it in "tag": ${JSON.stringify(tags)}. Never invent a tag.`
      : 'There are no misconception tags for this item, so "tag" must be null.',
    `Reply with JSON only: {"reply": string, "tag": string|null, "refuse": boolean, "reason": string|null}.`,
    `The reply is under ${TUTOR_MAX_WORDS} words and ends with a question.`,
    VOICE,
  ].join(" ");

  const user = [
    itemBrief(item, facts),
    transcript.length > 0
      ? `Conversation so far:\n${transcript.map((turn) => `${turn.role}: ${turn.content}`).join("\n")}`
      : "Conversation so far: none, this is the first turn.",
    `The student just said:\n${studentMessage}`,
    "Write your turn.",
  ].join("\n\n");

  const parsed = parseJson(await ask(system, user, 400));
  if (!parsed) return fallback();

  const reply = scalarText(parsed.reply);
  if (!reply) return fallback();

  const rawTag = scalarText(parsed.tag);
  const misconceptionTag = rawTag && tags.includes(rawTag) ? rawTag : null;

  if (parsed.refuse === true) {
    return {
      reply: clip(reply, TUTOR_MAX_WORDS),
      misconceptionTag,
      refused: true,
      refusalReason: scalarText(parsed.reason) ?? "The key does not cover that, so I will not guess.",
    };
  }

  // A reply that hands over the answer is a failed turn, not a hint (C6, I4).
  if (leaksAnswer(reply, facts)) {
    return {
      reply: ONE_STEP,
      misconceptionTag,
      refused: true,
      refusalReason: "That reply would have handed you the answer, so it was dropped.",
    };
  }

  return {
    reply: clip(reply, TUTOR_MAX_WORDS),
    misconceptionTag,
    refused: false,
    refusalReason: null,
  };
}

// ---------------------------------------------------------------------------
// I7 — structured feedback, all five parts
// ---------------------------------------------------------------------------

function howIndependently(attempt: AttemptSummary, independence: IndependenceContext): string {
  const attempts = `${attempt.attemptsMade} attempt${attempt.attemptsMade === 1 ? "" : "s"}`;
  const hints = attempt.hintsRequested;
  const solved = attempt.outcome === "correct";

  let line: string;
  if (attempt.solutionRevealed) {
    line = `You took the worked solution after ${attempts}.`;
  } else if (solved && attempt.unaided) {
    line = `Solved unaided in ${attempts}.`;
  } else if (solved && hints === 1) {
    line = `You cracked it with only 1 hint, after ${attempts}.`;
  } else if (solved) {
    line = `Solved after ${attempts} and ${hints} hints.`;
  } else {
    line = `${attempts}, ${hints} hint${hints === 1 ? "" : "s"}, no solve yet.`;
  }

  if (attempt.selfCorrected) line += " You caught the error yourself.";
  else if (attempt.persistedAfterError) line += " You went again after a wrong attempt.";

  if (independence.hintReliancePct !== null && independence.sample >= 8) {
    line += ` Hint reliance across your last ${independence.sample} items: ${Math.round(independence.hintReliancePct)}% — a behavioural proxy measured in Anchor, not a test score.`;
  }
  return line;
}

function assistanceOveruse(attempt: AttemptSummary): string {
  const hints = attempt.hintsRequested;
  if (attempt.solutionRevealed) {
    return "You took the full solution. Redo this one unaided in two days to see whether it stuck.";
  }
  if (hints === 0) return "No assistance used on this one.";
  if (hints === 1) return "One hint, after your own attempt. That is help asked for at the right time.";
  if (attempt.attemptsMade <= hints) {
    return `${hints} hints across ${attempt.attemptsMade} attempts — the help arrived faster than your own working did.`;
  }
  return `${hints} hints across ${attempt.attemptsMade} attempts. Fair, but try the next one a level lighter.`;
}

function deterministicWhatWasCorrect(attempt: AttemptSummary): string {
  switch (attempt.outcome) {
    case "correct":
      return "Your final answer matches the verified key.";
    case "partial":
      return "Part of your working matches the key, so the setup is holding.";
    case "incorrect":
      return "You committed to an answer instead of skipping, so there is working to check.";
    case "skipped":
      return "Nothing to credit here — this one was skipped.";
    default:
      return "Nothing to credit here — the submission was too thin to check.";
  }
}

function deterministicWeakness(attempt: AttemptSummary, facts: KeyFacts): string {
  if (attempt.outcome === "correct") return "Nothing broke on this one.";
  if (facts.steps.length > 1) {
    return `The verified route runs ${facts.steps.length} steps. Compare yours from step one and stop at the first line that differs.`;
  }
  return "Compare your working against the key line by line and stop at the first line that differs.";
}

function deterministicNextStrategy(item: TutorItem, attempt: AttemptSummary): string {
  if (attempt.outcome === "correct") {
    return `Try a ${item.skill} item with different numbers, then come back to this one in two days without hints.`;
  }
  return `Redo this ${item.skill} item unaided in two days, writing each step before you compute it.`;
}

function counterExplanationFor(grounded: boolean): string {
  if (!grounded) {
    return "There is no verified key behind this, so treat it as a prompt rather than a verdict on your working.";
  }
  return "This reads your final answer and the order of your attempts, nothing else. If the method was sound and the arithmetic slipped, ignore the diagnosis and check the numbers.";
}

/**
 * The five parts I7 requires, verbatim: what was correct, where reasoning
 * weakened, how independently it was solved, whether assistance was over-used,
 * and what strategy to try next — plus a counter-explanation (I5).
 *
 * How independently and whether assistance was over-used are computed from the
 * recorded counts, never generated: they are facts, not opinions (I6, F6).
 */
export async function structuredFeedback(args: {
  item: TutorItem;
  answerKey: unknown;
  attempt: AttemptSummary;
  independence: IndependenceContext;
}): Promise<StructuredFeedback> {
  const { item, answerKey, attempt, independence } = args;
  const facts = readKey(answerKey, item);

  const independenceLine = howIndependently(attempt, independence);
  const overuseLine = assistanceOveruse(attempt);

  const deterministic = (
    grounded: boolean,
    refusalReason: string | null = null,
  ): StructuredFeedback => ({
    whatWas