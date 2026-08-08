// B6 — the framing line. It names how independently the item came out, in
// exactly those terms: "You cracked it with one hint."
//
// Two constraints shape the wording. I1 (Kluger & DeNisi): stay on the task,
// never on the person — so nothing here describes the student, only the work.
// Counts are spelled as words on purpose: the numeral rule reserves `.num` for
// data, and these are sentences.

import type { AttemptOutcome } from "@/lib/research/types";

const COUNT_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

export function countWord(n: number): string {
  return n >= 0 && n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

export interface FramingInput {
  outcome: AttemptOutcome | null;
  /** Hints taken, worked solution excluded. */
  hintsTaken: number;
  attempts: number;
  solutionRevealed: boolean;
}

/** One sentence, ready to show above the feedback. */
export function framingLine(f: FramingInput): string {
  const hintPhrase = `${countWord(f.hintsTaken)} hint${f.hintsTaken === 1 ? "" : "s"}`;

  switch (f.outcome) {
    case "correct":
      if (f.solutionRevealed) {
        return "Solved after the worked solution. The next one of these is the real test.";
      }
      if (f.hintsTaken === 0) {
        return f.attempts <= 1
          ? "First attempt, no hints. That one was all yours."
          : `No hints, and it came out on attempt ${countWord(f.attempts)}. All of it was yours.`;
      }
      return `You cracked it with ${hintPhrase}.`;

    case "partial":
      return "Part of it landed. The feedback below says which part.";

    case "incorrect":
      return f.attempts >= 2
        ? `Not solved this time, across ${countWord(f.attempts)} attempts. The feedback says where the reasoning went.`
        : "Not solved this time. The feedback says where the reasoning went.";

    case "skipped":
      return "You stopped this one here. The feedback still applies.";

    case "low_effort":
      return "That attempt was too thin to count as one. Hints stay shut until there is something to work from.";

    default:
      return "";
  }
}

/** The one-line status shown right after grading, before any feedback loads. */
export function outcomeHeadline(outcome: AttemptOutcome | null): string {
  switch (outcome) {
    case "correct":
      return "Correct.";
    case "partial":
      return "Partly right.";
    case "incorrect":
      return "Not correct.";
    case "skipped":
      return "Skipped.";
    case "low_effort":
      return "Too thin to count.";
    default:
      return "";
  }
}
