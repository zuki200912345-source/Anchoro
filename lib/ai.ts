import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { puzzleStructure } from "@/lib/puzzles";
import { PUZZLE_LABELS, type PuzzleType } from "@/lib/types";

// All model calls happen here, server-side only. AI_MODEL + ANTHROPIC_BASE_URL
// let dev point at any Anthropic-compatible provider (e.g. DeepSeek); the
// default stays the spec's pinned model.
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
  "No 'dive in', no 'level up your', no rhetorical questions, at most one em dash.";

const TIER_RULES: Record<1 | 2 | 3, string> = {
  1:
    "Tier 1 is a QUESTION, not information. Ask one pointed question that directs " +
    "attention (e.g. 'What stays the same between the two examples?'). It must not " +
    "reveal any fact about the solution.",
  2:
    "Tier 2 narrows the search space with one factual observation about WHERE to look " +
    "(e.g. 'The change involves the corners only.'). It must not state the rule or any move.",
  3:
    "Tier 3 gives the single next concrete move or step, but never the full answer " +
    "and never the remaining steps.",
};

// Static fallbacks so the hint ladder still functions without an API key
// (local dev). Same tier semantics, derived per puzzle type.
const FALLBACK_HINTS: Record<PuzzleType, Record<1 | 2 | 3, string>> = {
  blockfit: {
    1: "Which row or column is already closest to full?",
    2: "One of the pieces only fits in one place without blocking the others.",
    3: "Place the largest piece first, against the nearly-full line.",
  },
  ruleshift: {
    1: "What stays the same between the input and output in each example?",
    2: "Track a single cell through both examples before comparing whole grids.",
    3: "Apply the transformation you found to the top-left cell of the test grid, then check which candidate matches it.",
  },
  recall: {
    1: "How did you group the sequence while it played?",
    2: "The pattern is easier in chunks of three than one cell at a time.",
    3: "Start from the first cell you are certain about and rebuild forward from there.",
  },
  mentalmath: {
    1: "What would a rough estimate say before you compute anything?",
    2: "Work from the target backwards rather than from the numbers forwards.",
    3: "Fix the largest number first and see what remainder you still need.",
  },
};

export async function generateHint(args: {
  type: PuzzleType;
  seed: string;
  difficulty: number;
  tier: 1 | 2 | 3;
  attempt?: unknown;
}): Promise<string> {
  const { type, seed, difficulty, tier, attempt } = args;
  const admin = createAdminClient();

  const { data: cached } = await admin
    .from("hint_cache")
    .select("hint_text")
    .eq("puzzle_type", type)
    .eq("seed", seed)
    .eq("tier", tier)
    .maybeSingle();
  if (cached?.hint_text) return cached.hint_text;

  const anthropic = client();
  let hint: string;

  if (!anthropic) {
    hint = FALLBACK_HINTS[type][tier];
  } else {
    const structure = puzzleStructure(type, seed, difficulty);
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 150,
        system:
          `You write single hints for ${PUZZLE_LABELS[type]} puzzles in a training app ` +
          `that fights cognitive offloading. The user must do the thinking; you only ` +
          `redirect it. ${TIER_RULES[tier]} Reply with the hint text alone: one or two ` +
          `sentences, under 30 words, no preamble, no quotes. ${VOICE}`,
        messages: [
          {
            role: "user",
            content:
              `Puzzle structure (includes the solution — never reveal it):\n` +
              JSON.stringify(structure) +
              (attempt ? `\n\nThe user's current attempt:\n${JSON.stringify(attempt)}` : "") +
              `\n\nWrite the tier ${tier} hint.`,
          },
        ],
      });
      const block = response.content[0];
      hint = block?.type === "text" ? block.text.trim() : FALLBACK_HINTS[type][tier];
    } catch {
      hint = FALLBACK_HINTS[type][tier];
    }
  }

  await admin
    .from("hint_cache")
    .upsert(
      { puzzle_type: type, seed, tier, hint_text: hint },
      { onConflict: "puzzle_type,seed,tier" },
    );

  return hint;
}

export interface RecapPuzzleSummary {
  type: PuzzleType;
  category: string;
  difficulty: number;
  correct: boolean;
  timeMs: number;
  hintsUsed: number;
}

// One paragraph, <= 60 words, must reference the actual puzzles played and
// name the single clearest weakness plus one concrete thing to practise.
export async function generateRecapFeedback(
  puzzles: RecapPuzzleSummary[],
): Promise<string> {
  const anthropic = client();
  if (!anthropic) return fallbackRecap(puzzles);

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      system:
        "You write the end-of-session recap for a daily cognitive training app. " +
        "One paragraph, 60 words maximum. Name the single clearest weakness from " +
        "THIS session, citing the specific puzzle types and results given, and one " +
        "concrete thing to practise. Generic encouragement is a failure. No greeting, " +
        "no sign-off. " +
        VOICE,
      messages: [
        {
          role: "user",
          content:
            "Session results, in play order:\n" +
            JSON.stringify(puzzles) +
            "\nWrite the recap paragraph.",
        },
      ],
    });
    const block = response.content[0];
    return block?.type === "text" ? block.text.trim() : fallbackRecap(puzzles);
  } catch {
    return fallbackRecap(puzzles);
  }
}

// Deterministic recap from the real numbers — specific, never generic.
function fallbackRecap(puzzles: RecapPuzzleSummary[]): string {
  const correct = puzzles.filter((p) => p.correct).length;
  const hints = puzzles.reduce((n, p) => n + p.hintsUsed, 0);
  const worst =
    puzzles.find((p) => !p.correct) ??
    [...puzzles].sort((a, b) => b.hintsUsed - a.hintsUsed || b.timeMs - a.timeMs)[0];
  const label = PUZZLE_LABELS[worst.type];
  const slowest = [...puzzles].sort((a, b) => b.timeMs - a.timeMs)[0];
  const parts = [
    `${correct} out of ${puzzles.length}, ${hints === 0 ? "no hints" : `${hints} hint${hints === 1 ? "" : "s"}`}.`,
    worst.correct
      ? `${label} cost you the most help.`
      : `${label} at difficulty ${worst.difficulty} is where it broke.`,
    slowest.type === worst.type
      ? `Run a ${label} practice set tomorrow and watch your first minute.`
      : `Practise ${label}, and note ${PUZZLE_LABELS[slowest.type]} ate ${Math.round(slowest.timeMs / 1000)}s.`,
  ];
  return parts.join(" ");
}
