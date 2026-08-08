// The seed item bank: real curriculum items with verified answer keys.
//
// Every key here is the primary anti-hallucination device (I3). Hints, feedback
// and grading are all grounded against it, so a wrong key would poison three
// systems at once. `lib/research/__tests__/grader.test.ts` grades every item's
// own canonical answer and asserts 'correct', and grades a plausible wrong
// answer and asserts 'incorrect'. Add an item, add both.
//
// AI may later generate variants and distractors from these, but it never
// adjudicates correctness (A4, I6). Generated items stay `verified: false`
// until something deterministic or human signs the key off.

import type { ItemKind } from "./types";
import type { AnswerKey, RubricCriterion } from "./grader";
import { DEFAULT_PASS_MARK } from "./grader";

export const SEED_SUBJECTS = ["maths", "physics", "chemistry", "biology", "english"] as const;
export type SeedSubject = (typeof SEED_SUBJECTS)[number];

export const SEED_YEAR_GROUPS = ["Y9", "Y10", "Y11", "Y12", "Y13"] as const;
export type SeedYearGroup = (typeof SEED_YEAR_GROUPS)[number];

interface SeedItemInput {
  /** Stable slug. The row id is derived from it, so never rename one in place. */
  ref: string;
  kind: ItemKind;
  subject: SeedSubject;
  topic: string;
  /** Fine-grained tag. Interleaving alternates on this (N7). */
  skill: string;
  yearGroup: SeedYearGroup;
  difficulty: number;
  stem: string;
  answerKey: AnswerKey;
  workedSolution: string;
  /** Every option in display order, for `choice` keys. */
  distractors?: string[] | null;
  /** tag -> what the wrong answer tells you. Read by the tutor (C3). */
  misconceptions: Record<string, string>;
  /** Transfer items point at the item they carry a strategy over from (N6). */
  variantOfRef?: string | null;
  /** What a student who has it right types. Asserted 'correct' in the tests. */
  canonicalAnswer: string;
  /** A plausible wrong answer. Asserted 'incorrect' in the tests. */
  nearMissAnswer: string;
}

export interface SeedItem extends Omit<SeedItemInput, "variantOfRef" | "distractors"> {
  id: string;
  distractors: string[] | null;
  variantOf: string | null;
  rubric: { criteria: RubricCriterion[]; passMark: number } | null;
  source: "authored";
  verified: true;
}

// ---------------------------------------------------------------------------
// Stable ids. Derived from the ref slug so the same row can be seeded from TS
// or from supabase/seed/items.sql and land on the same primary key.
// ---------------------------------------------------------------------------

function fnv32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, "0");

/** Deterministic uuid for a ref slug. Version nibble 4, variant nibble 8. */
export function itemId(ref: string): string {
  const a = hex8(fnv32(ref, 0x811c9dc5));
  const b = hex8(fnv32(ref, 0x1000193));
  const c = hex8(fnv32(ref, 0xdeadbeef));
  const d = hex8(fnv32(ref, 0x5bf03635));
  return [a, b.slice(0, 4), `4${b.slice(5, 8)}`, `8${c.slice(1, 4)}`, c.slice(4, 8) + d].join("-");
}

// ---------------------------------------------------------------------------
// The bank. Parents are listed before the transfer items that reference them.
// ---------------------------------------------------------------------------

const INPUTS: SeedItemInput[] = [
  // ------------------------------------------------------------------ maths
  {
    ref: "maths-linear-solve-1",
    kind: "retrieval",
    subject: "maths",
    topic: "algebra",
    skill: "linear-equations",
    yearGroup: "Y9",
    difficulty: 2,
    stem: "Solve for x: 4x + 7 = 31. Give the value of x.",
    answerKey: { type: "numeric", value: 6 },
    workedSolution:
      "Subtract 7 from both sides to get 4x = 24. Divide both sides by 4, so x = 6.",
    misconceptions: {
      inverse_order: "Answering 9.5 adds 7 instead of subtracting it before dividing by 4.",
    },
    canonicalAnswer: "6",
    nearMissAnswer: "9.5",
  },
  {
    ref: "maths-percentage-change-1",
    kind: "reasoning",
    subject: "maths",
    topic: "percentages",
    skill: "percentage-change",
    yearGroup: "Y9",
    difficulty: 3,
    stem: "A jacket costs 80 pounds. The price rises by 15%, then falls by 15% in a sale. Give the final price in pounds.",
    answerKey: { type: "numeric", value: 78.2, tolerance: 0.005 },
    workedSolution:
      "A 15% rise gives 80 x 1.15 = 92. A 15% fall from 92 gives 92 x 0.85 = 78.20. The fall is taken from the larger amount, so the price does not return to 80.",
    misconceptions: {
      percent_cancel: "Answering 80 assumes a 15% rise and a 15% fall cancel out.",
      rise_only: "Answering 92 stops after the rise and never applies the sale.",
    },
    canonicalAnswer: "78.20",
    nearMissAnswer: "80",
  },
  {
    ref: "maths-index-laws-1",
    kind: "retrieval",
    subject: "maths",
    topic: "indices",
    skill: "indices-laws",
    yearGroup: "Y9",
    difficulty: 3,
    stem: "Simplify (3x^2)(4x^5). Write your answer in the form ax^n.",
    answerKey: { type: "expression", canonical: "12x^7" },
    workedSolution:
      "Multiply the numbers: 3 x 4 = 12. Add the indices: 2 + 5 = 7. The answer is 12x^7.",
    misconceptions: {
      indices_multiplied: "Answering 12x^10 multiplies the indices instead of adding them.",
    },
    canonicalAnswer: "12x^7",
    nearMissAnswer: "12x^10",
  },
  {
    ref: "maths-order-of-operations-1",
    kind: "practice",
    subject: "maths",
    topic: "arithmetic",
    skill: "order-of-operations",
    yearGroup: "Y9",
    difficulty: 2,
    stem: "Work out 7 + 3 x 4 - 2.",
    answerKey: { type: "numeric", value: 17 },
    workedSolution: "Multiplication comes first: 3 x 4 = 12. Then 7 + 12 - 2 = 17.",
    misconceptions: {
      left_to_right: "Answering 38 works strictly left to right; multiplication comes first.",
    },
    canonicalAnswer: "17",
    nearMissAnswer: "38",
  },
  {
    ref: "maths-quadratic-roots-1",
    kind: "reasoning",
    subject: "maths",
    topic: "quadratics",
    skill: "quadratic-factorising",
    yearGroup: "Y10",
    difficulty: 4,
    stem: "Solve x^2 - 7x + 12 = 0. Give both roots, separated by a comma.",
    answerKey: { type: "set", values: ["3", "4"] },
    workedSolution:
      "Two numbers multiply to 12 and add to -7: -3 and -4. So (x - 3)(x - 4) = 0, and setting each bracket to zero gives x = 3 and x = 4.",
    misconceptions: {
      bracket_signs_copied:
        "Answering -3, -4 copies the signs inside the brackets instead of solving each bracket equal to zero.",
    },
    canonicalAnswer: "3, 4",
    nearMissAnswer: "-3, -4",
  },
  {
    ref: "maths-simultaneous-1",
    kind: "reasoning",
    subject: "maths",
    topic: "simultaneous equations",
    skill: "simultaneous-equations",
    yearGroup: "Y10",
    difficulty: 5,
    stem: "Solve the simultaneous equations 2x + 3y = 12 and x - y = 1. Give your answer as x, y.",
    answerKey: { type: "set", values: ["3", "2"], ordered: true },
    workedSolution:
      "Rearrange the second equation to x = y + 1. Substitute into the first: 2(y + 1) + 3y = 12, so 5y + 2 = 12 and y = 2. Then x = 3. Check: 2(3) + 3(2) = 12.",
    misconceptions: {
      values_swapped: "Answering 2, 3 puts the values the wrong way round; the first number is x.",
    },
    canonicalAnswer: "3, 2",
    nearMissAnswer: "2, 3",
  },
  {
    ref: "maths-simultaneous-transfer-1",
    kind: "transfer",
    subject: "maths",
    topic: "simultaneous equations",
    skill: "simultaneous-equations",
    yearGroup: "Y10",
    difficulty: 6,
    variantOfRef: "maths-simultaneous-1",
    stem: "Two coffees and three teas cost 12 pounds in total. One coffee costs 1 pound more than one tea. Give the price of one coffee in pounds.",
    answerKey: { type: "numeric", value: 3 },
    workedSolution:
      "Let c and t be the prices. Then 2c + 3t = 12 and c - t = 1. Substituting c = t + 1 gives 5t + 2 = 12, so t = 2 and c = 3. Check: 2(3) + 3(2) = 12.",
    misconceptions: {
      wrong_unknown: "Answering 2 gives the price of a tea, not the coffee the question asked for.",
    },
    canonicalAnswer: "3",
    nearMissAnswer: "2",
  },
  {
    ref: "maths-probability-tree-1",
    kind: "practice",
    subject: "maths",
    topic: "probability",
    skill: "probability-tree",
    yearGroup: "Y10",
    difficulty: 5,
    stem: "A bag holds 4 red counters and 6 blue counters. Two are taken without replacement. Give the probability that both are red, as a fraction in its simplest form.",
    answerKey: { type: "exact", value: "2/15", alternates: ["2 / 15"] },
    workedSolution:
      "The first counter is red with probability 4/10. One red counter and one counter overall are then gone, so the second is red with probability 3/9. Multiplying gives 12/90, which simplifies to 2/15.",
    misconceptions: {
      replacement_assumed:
        "Answering 4/25 treats the first counter as replaced; after one red there are 3 red among 9 counters.",
    },
    canonicalAnswer: "2/15",
    nearMissAnswer: "4/25",
  },
  {
    ref: "maths-surds-1",
    kind: "reasoning",
    subject: "maths",
    topic: "surds",
    skill: "surds",
    yearGroup: "Y11",
    difficulty: 5,
    stem: "Simplify √50 + √18. Write your answer in the form a√2.",
    answerKey: { type: "expression", canonical: "8√2" },
    workedSolution:
      "√50 = √25 x √2 = 5√2 and √18 = √9 x √2 = 3√2. Adding the like terms gives 8√2.",
    misconceptions: {
      roots_added: "Answering √68 adds the numbers under the roots; √a + √b is not √(a + b).",
    },
    canonicalAnswer: "8√2",
    nearMissAnswer: "√68",
  },
  {
    ref: "maths-standard-form-1",
    kind: "retrieval",
    subject: "maths",
    topic: "standard form",
    skill: "standard-form",
    yearGroup: "Y11",
    difficulty: 3,
    stem: "Write 0.00042 in standard form, in the form a x 10^n.",
    answerKey: { type: "expression", canonical: "4.2×10^-4" },
    workedSolution:
      "Move the decimal point four places to the right to reach 4.2. Because the number is smaller than 1, the power is negative: 4.2 x 10^-4.",
    misconceptions: {
      positive_power: "Answering 4.2 x 10^4 uses a positive power; a number below 1 needs a negative power.",
    },
    canonicalAnswer: "4.2 x 10^-4",
    nearMissAnswer: "4.2 x 10^4",
  },
  {
    ref: "maths-pythagoras-1",
    kind: "reasoning",
    subject: "maths",
    topic: "pythagoras",
    skill: "pythagoras",
    yearGroup: "Y11",
    difficulty: 5,
    stem: "A right-angled triangle has a hypotenuse of 13 cm and one shorter side of 5 cm. Give the length of the third side in cm.",
    answerKey: { type: "numeric", value: 12 },
    workedSolution:
      "The hypotenuse is the longest side, so subtract: 13^2 - 5^2 = 169 - 25 = 144. The third side is √144 = 12 cm.",
    misconceptions: {
      squares_added:
        "Answering 13.9 adds the squares, which would make the given hypotenuse a shorter side.",
    },
    canonicalAnswer: "12",
    nearMissAnswer: "13.9",
  },
  {
    ref: "maths-pythagoras-transfer-1",
    kind: "transfer",
    subject: "maths",
    topic: "pythagoras",
    skill: "pythagoras",
    yearGroup: "Y11",
    difficulty: 6,
    variantOfRef: "maths-pythagoras-1",
    stem: "A ladder 13 m long leans against a vertical wall with its foot 5 m from the base of the wall. Give the height it reaches up the wall in metres.",
    answerKey: { type: "numeric", value: 12 },
    workedSolution:
      "The wall, the ground and the ladder form a right-angled triangle with the ladder as the hypotenuse. The height is √(13^2 - 5^2) = √144 = 12 m.",
    misconceptions: {
      hypotenuse_misread: "Answering 13.9 treats the ladder as a shorter side; the ladder is the hypotenuse.",
    },
    canonicalAnswer: "12",
    nearMissAnswer: "13.9",
  },
  {
    ref: "maths-circle-theorem-1",
    kind: "retrieval",
    subject: "maths",
    topic: "circle theorems",
    skill: "circle-theorems",
    yearGroup: "Y11",
    difficulty: 4,
    stem: "A triangle is drawn inside a circle with one side as the diameter. Give the size in degrees of the angle opposite that side.",
    answerKey: { type: "numeric", value: 90 },
    workedSolution:
      "The angle in a semicircle is a right angle, so the angle opposite the diameter is 90 degrees.",
    misconceptions: {
      straight_line_used:
        "Answering 180 uses the straight line through the centre rather than the angle in the semicircle.",
    },
    canonicalAnswer: "90",
    nearMissAnswer: "180",
  },
  {
    ref: "maths-differentiate-1",
    kind: "reasoning",
    subject: "maths",
    topic: "differentiation",
    skill: "differentiation-power-rule",
    yearGroup: "Y12",
    difficulty: 5,
    stem: "Differentiate y = 3x^4 - 2x^2 + 7 with respect to x. Give dy/dx.",
    answerKey: { type: "expression", canonical: "12x^3-4x" },
    workedSolution:
      "Multiply by the index and drop the index by one: 3x^4 gives 12x^3 and -2x^2 gives -4x. The derivative of the constant 7 is zero, so dy/dx = 12x^3 - 4x.",
    misconceptions: {
      constant_kept: "Answering 12x^3 - 4x + 7 keeps the constant; the derivative of a constant is zero.",
    },
    canonicalAnswer: "12x^3 - 4x",
    nearMissAnswer: "12x^3 - 4x + 7",
  },
  {
    ref: "maths-logarithm-1",
    kind: "retrieval",
    subject: "maths",
    topic: "logarithms",
    skill: "logarithms",
    yearGroup: "Y12",
    difficulty: 4,
    stem: "Evaluate log to base 2 of 32.",
    answerKey: { type: "numeric", value: 5 },
    workedSolution: "Ask which power of 2 gives 32. Since 2^5 = 32, the logarithm is 5.",
    misconceptions: {
      halved: "Answering 16 halves 32 rather than asking which power of 2 gives 32.",
    },
    canonicalAnswer: "5",
    nearMissAnswer: "16",
  },
  {
    ref: "maths-binomial-1",
    kind: "reasoning",
    subject: "maths",
    topic: "binomial expansion",
    skill: "binomial-expansion",
    yearGroup: "Y12",
    difficulty: 6,
    stem: "In the expansion of (1 + 2x)^5, give the coefficient of x^2.",
    answerKey: { type: "numeric", value: 40 },
    workedSolution:
      "The x^2 term is C(5,2) x 1^3 x (2x)^2 = 10 x 4x^2 = 40x^2, so the coefficient is 40.",
    misconceptions: {
      coefficient_only:
        "Answering 10 uses the binomial coefficient alone and leaves the 2 in 2x unsquared.",
    },
    canonicalAnswer: "40",
    nearMissAnswer: "10",
  },
  {
    ref: "maths-arithmetic-sequence-1",
    kind: "practice",
    subject: "maths",
    topic: "sequences",
    skill: "sequences-arithmetic",
    yearGroup: "Y12",
    difficulty: 4,
    stem: "An arithmetic sequence starts 5, 9, 13 and continues in the same way. Give the 20th term.",
    answerKey: { type: "numeric", value: 81 },
    workedSolution:
      "The first term is 5 and the common difference is 4. There are 19 steps after the first term, so the 20th term is 5 + 19 x 4 = 81.",
    misconceptions: {
      extra_step: "Answering 85 uses 20 steps; the 20th term sits 19 steps after the first.",
    },
    canonicalAnswer: "81",
    nearMissAnswer: "85",
  },
  {
    ref: "maths-definite-integral-1",
    kind: "reasoning",
    subject: "maths",
    topic: "integration",
    skill: "integration-definite",
    yearGroup: "Y13",
    difficulty: 7,
    stem: "Evaluate the definite integral of 3x^2 with respect to x, from x = 1 to x = 4.",
    answerKey: { type: "numeric", value: 63 },
    workedSolution:
      "Integrating 3x^2 gives x^3. Substituting the limits gives 4^3 - 1^3 = 64 - 1 = 63.",
    misconceptions: {
      lower_limit_dropped:
        "Answering 64 substitutes only the upper limit; subtract the value at the lower limit.",
    },
    canonicalAnswer: "63",
    nearMissAnswer: "64",
  },
  {
    ref: "maths-integral-transfer-1",
    kind: "transfer",
    subject: "maths",
    topic: "kinematics with calculus",
    skill: "integration-definite",
    yearGroup: "Y13",
    difficulty: 8,
    variantOfRef: "maths-definite-integral-1",
    stem: "A particle moves in a straight line with velocity v = 3t^2 metres per second. Give the distance travelled in metres between t = 1 and t = 4 seconds.",
    answerKey: { type: "numeric", value: 63 },
    workedSolution:
      "Distance is the integral of velocity. Integrating 3t^2 gives t^3, so the distance is 4^3 - 1^3 = 63 metres.",
    misconceptions: {
      velocity_read_off:
        "Answering 48 substitutes t = 4 into the velocity instead of integrating it.",
    },
    canonicalAnswer: "63",
    nearMissAnswer: "48",
  },
  {
    ref: "maths-vector-magnitude-1",
    kind: "reasoning",
    subject: "maths",
    topic: "vectors",
    skill: "vectors",
    yearGroup: "Y13",
    difficulty: 6,
    stem: "Vectors a = (3, 4) and b = (-1, 2). Give the magnitude of a + b to 2 decimal places.",
    answerKey: { type: "numeric", value: 6.32, tolerance: 0.005 },
    workedSolution:
      "Add the components: a + b = (2, 6). The magnitude is √(2^2 + 6^2) = √40 = 6.32 to 2 decimal places.",
    misconceptions: {
      components_added:
        "Answering 8 adds the components of the resultant instead of using Pythagoras on them.",
    },
    canonicalAnswer: "6.32",
    nearMissAnswer: "8",
  },
  {
    ref: "maths-integration-by-parts-1",
    kind: "reasoning",
    subject: "maths",
    topic: "integration",
    skill: "integration-by-parts",
    yearGroup: "Y13",
    difficulty: 9,
    stem: "Evaluate the integral of x e^x with respect to x, from x = 0 to x = 1.",
    answerKey: { type: "numeric", value: 1, tolerance: 0.005 },
    workedSolution:
      "Integrate by parts with u = x and dv = e^x dx, which gives x e^x - e^x. At x = 1 that is e - e = 0, and at x = 0 it is 0 - 1 = -1. The definite integral is 0 - (-1) = 1.",
    misconceptions: {
      product_of_integrals:
        "Answering 2.72, the value of e, integrates the two factors separately; the integral of a product is not the product of the integrals.",
    },
    canonicalAnswer: "1",
    nearMissAnswer: "2.72",
  },
  {
    ref: "maths-log-equation-1",
    kind: "reasoning",
    subject: "maths",
    topic: "logarithms",
    skill: "logarithms",
    yearGroup: "Y13",
    difficulty: 9,
    stem: "Solve log to base 3 of x, plus log to base 3 of (x - 2), equals 1. Give the valid value of x.",
    answerKey: { type: "numeric", value: 3 },
    workedSolution:
      "Combine the logarithms: log base 3 of x(x - 2) = 1, so x(x - 2) = 3. That gives x^2 - 2x - 3 = 0, which factorises to (x - 3)(x + 1) = 0. Only x = 3 is valid, because x = -1 would take the logarithm of a negative number.",
    misconceptions: {
      invalid_root_kept: "Answering -1 keeps the root that makes the logarithm undefined.",
    },
    canonicalAnswer: "3",
    nearMissAnswer: "-1",
  },

  // ---------------------------------------------------------------- physics
  {
    ref: "physics-density-1",
    kind: "retrieval",
    subject: "physics",
    topic: "density",
    skill: "density",
    yearGroup: "Y9",
    difficulty: 2,
    stem: "A block has a mass of 240 g and a volume of 30 cm^3. Give its density in g per cm^3.",
    answerKey: { type: "numeric", value: 8, unit: "g/cm^3" },
    workedSolution: "Density is mass divided by volume: 240 divided by 30 is 8 g per cm^3.",
    misconceptions: {
      formula_inverted: "Answering 0.125 divides volume by mass instead of mass by volume.",
    },
    canonicalAnswer: "8",
    nearMissAnswer: "0.125",
  },
  {
    ref: "physics-speed-1",
    kind: "reasoning",
    subject: "physics",
    topic: "motion",
    skill: "speed-distance-time",
    yearGroup: "Y9",
    difficulty: 3,
    stem: "A runner covers 1500 m in 300 s. Give the average speed in m/s.",
    answerKey: { type: "numeric", value: 5, unit: "m/s" },
    workedSolution: "Speed is distance divided by time: 1500 divided by 300 is 5 m/s.",
    misconceptions: {
      time_over_distance: "Answering 0.2 divides time by distance.",
    },
    canonicalAnswer: "5",
    nearMissAnswer: "0.2",
  },
  {
    ref: "physics-ohms-law-1",
    kind: "retrieval",
    subject: "physics",
    topic: "electricity",
    skill: "ohms-law",
    yearGroup: "Y10",
    difficulty: 3,
    stem: "A resistor carries a current of 0.5 A when 12 V is across it. Give its resistance in ohms.",
    answerKey: { type: "numeric", value: 24, unit: "ohms" },
    workedSolution: "Rearranging V = IR gives R = V divided by I, so R = 12 divided by 0.5 = 24 ohms.",
    misconceptions: {
      power_formula_used:
        "Answering 6 multiplies voltage by current, which gives power rather than resistance.",
    },
    canonicalAnswer: "24",
    nearMissAnswer: "6",
  },
  {
    ref: "physics-newton-second-1",
    kind: "reasoning",
    subject: "physics",
    topic: "forces",
    skill: "newton-second-law",
    yearGroup: "Y10",
    difficulty: 4,
    stem: "A car of mass 1200 kg accelerates at 2.5 m/s^2. Give the resultant force in newtons.",
    answerKey: { type: "numeric", value: 3000, unit: "N" },
    workedSolution: "Force is mass times acceleration: 1200 x 2.5 = 3000 N.",
    misconceptions: {
      divided_instead: "Answering 480 divides mass by acceleration instead of multiplying.",
    },
    canonicalAnswer: "3000",
    nearMissAnswer: "480",
  },
  {
    ref: "physics-parallel-resistance-1",
    kind: "reasoning",
    subject: "physics",
    topic: "electricity",
    skill: "series-parallel-resistance",
    yearGroup: "Y10",
    difficulty: 5,
    stem: "A 6 ohm resistor and a 3 ohm resistor are connected in parallel. Give the total resistance in ohms.",
    answerKey: { type: "numeric", value: 2, unit: "ohms" },
    workedSolution:
      "For resistors in parallel, 1/R = 1/6 + 1/3 = 1/2, so R = 2 ohms. The total is always smaller than the smallest single resistor.",
    misconceptions: {
      series_rule_used: "Answering 9 adds the resistances, which is the rule for series, not parallel.",
    },
    canonicalAnswer: "2",
    nearMissAnswer: "9",
  },
  {
    ref: "physics-parallel-transfer-1",
    kind: "transfer",
    subject: "physics",
    topic: "electricity",
    skill: "series-parallel-resistance",
    yearGroup: "Y10",
    difficulty: 6,
    variantOfRef: "physics-parallel-resistance-1",
    stem: "A 6 ohm heater and a 3 ohm lamp are connected side by side across a 12 V supply. Give the total current drawn from the supply in amps.",
    answerKey: { type: "numeric", value: 6, unit: "A" },
    workedSolution:
      "Each branch has the full 12 V across it. The heater draws 12 divided by 6 = 2 A and the lamp draws 12 divided by 3 = 4 A, so the supply provides 6 A.",
    misconceptions: {
      one_branch_only:
        "Answering 2 uses the heater branch alone; the supply current is the sum of the branch currents.",
    },
    canonicalAnswer: "6",
    nearMissAnswer: "2",
  },
  {
    ref: "physics-free-fall-1",
    kind: "reasoning",
    subject: "physics",
    topic: "motion",
    skill: "kinematics-suvat",
    yearGroup: "Y11",
    difficulty: 6,
    stem: "A ball is dropped from rest and falls for 3.0 s. Taking g = 9.8 m/s^2 and ignoring air resistance, give the distance fallen in metres.",
    answerKey: { type: "numeric", value: 44.1, tolerance: 0.05, unit: "m" },
    workedSolution:
      "Use s = ut + half a t^2 with u = 0. That gives s = 0.5 x 9.8 x 3.0^2 = 44.1 m.",
    misconceptions: {
      speed_given_as_distance: "Answering 29.4 gives the speed after 3 s, not the distance fallen.",
    },
    canonicalAnswer: "44.1",
    nearMissAnswer: "29.4",
  },
  {
    ref: "physics-wave-equation-1",
    kind: "retrieval",
    subject: "physics",
    topic: "waves",
    skill: "waves-equation",
    yearGroup: "Y11",
    difficulty: 4,
    stem: "A wave has a frequency of 50 Hz and a wavelength of 6 m. Give its speed in m/s.",
    answerKey: { type: "numeric", value: 300, unit: "m/s" },
    workedSolution: "Wave speed is frequency times wavelength: 50 x 6 = 300 m/s.",
    misconceptions: {
      divided_instead: "Answering 0.12 divides wavelength by frequency instead of multiplying.",
    },
    canonicalAnswer: "300",
    nearMissAnswer: "0.12",
  },
  {
    ref: "physics-energy-drop-1",
    kind: "reasoning",
    subject: "physics",
    topic: "energy",
    skill: "energy-conservation",
    yearGroup: "Y11",
    difficulty: 6,
    stem: "A 0.5 kg ball is dropped from a height of 20 m. Taking g = 10 N/kg and ignoring air resistance, give its speed just before it lands, in m/s.",
    answerKey: { type: "numeric", value: 20, unit: "m/s" },
    workedSolution:
      "The gravitational store mgh becomes the kinetic store half m v^2, so v = √(2gh) = √(2 x 10 x 20) = 20 m/s. The mass cancels.",
    misconceptions: {
      energy_given_as_speed: "Answering 100 gives the energy in joules rather than the speed.",
    },
    canonicalAnswer: "20",
    nearMissAnswer: "100",
  },
  {
    ref: "physics-moments-1",
    kind: "practice",
    subject: "physics",
    topic: "moments",
    skill: "moments",
    yearGroup: "Y11",
    difficulty: 5,
    stem: "A uniform plank balances on a pivot at its centre. A 30 N weight sits 0.8 m from the pivot on the left. Give the distance from the pivot, in metres, at which a 40 N weight balances it on the right.",
    answerKey: { type: "numeric", value: 0.6, tolerance: 0.005, unit: "m" },
    workedSolution:
      "Balance the moments. The left moment is 30 x 0.8 = 24 N m, so 40 x d = 24 and d = 0.6 m.",
    misconceptions: {
      distances_matched:
        "Answering 0.8 matches the distances; it is the moments, force times distance, that must match.",
    },
    canonicalAnswer: "0.6",
    nearMissAnswer: "0.8",
  },
  {
    ref: "physics-momentum-1",
    kind: "reasoning",
    subject: "physics",
    topic: "momentum",
    skill: "momentum",
    yearGroup: "Y12",
    difficulty: 6,
    stem: "A 2 kg trolley moving at 3 m/s collides with a stationary 1 kg trolley and the two move off together. Give their common velocity in m/s.",
    answerKey: { type: "numeric", value: 2, unit: "m/s" },
    workedSolution:
      "Momentum before the collision is 2 x 3 = 6 kg m/s. Afterwards the combined mass is 3 kg, so v = 6 divided by 3 = 2 m/s.",
    misconceptions: {
      speeds_averaged: "Answering 1.5 averages the two speeds; it is momentum that is conserved.",
    },
    canonicalAnswer: "2",
    nearMissAnswer: "1.5",
  },
  {
    ref: "physics-power-1",
    kind: "retrieval",
    subject: "physics",
    topic: "electricity",
    skill: "power-electrical",
    yearGroup: "Y12",
    difficulty: 4,
    stem: "A kettle runs from 230 V and draws 9.0 A. Give its power in watts.",
    answerKey: { type: "numeric", value: 2070, unit: "W" },
    workedSolution: "Electrical power is voltage times current: 230 x 9.0 = 2070 W.",
    misconceptions: {
      divided_instead: "Answering 25.6 divides voltage by current, which gives resistance.",
    },
    canonicalAnswer: "2070",
    nearMissAnswer: "25.6",
  },
  {
    ref: "physics-specific-heat-1",
    kind: "reasoning",
    subject: "physics",
    topic: "thermal physics",
    skill: "specific-heat",
    yearGroup: "Y12",
    difficulty: 7,
    stem: "Give the energy in joules needed to raise the temperature of 2.0 kg of water by 15 degrees Celsius. Use a specific heat capacity of 4200 J per kg per degree.",
    answerKey: { type: "numeric", value: 126000, unit: "J" },
    workedSolution:
      "Energy is mass x specific heat capacity x temperature change: 2.0 x 4200 x 15 = 126000 J.",
    misconceptions: {
      mass_omitted: "Answering 63000 leaves the mass out of the calculation.",
    },
    canonicalAnswer: "126000",
    nearMissAnswer: "63000",
  },
  {
    ref: "physics-circular-motion-1",
    kind: "reasoning",
    subject: "physics",
    topic: "circular motion",
    skill: "circular-motion",
    yearGroup: "Y13",
    difficulty: 8,
    stem: "An object of mass 0.20 kg moves in a circle of radius 0.50 m at 4.0 m/s. Give the centripetal force in newtons.",
    answerKey: { type: "numeric", value: 6.4, tolerance: 0.05, unit: "N" },
    workedSolution:
      "F = m v^2 divided by r, so F = 0.20 x 4.0^2 divided by 0.50 = 0.20 x 16 divided by 0.50 = 6.4 N.",
    misconceptions: {
      speed_not_squared: "Answering 1.6 uses v rather than v squared.",
    },
    canonicalAnswer: "6.4",
    nearMissAnswer: "1.6",
  },
  {
    ref: "physics-energy-transfer-1",
    kind: "transfer",
    subject: "physics",
    topic: "energy",
    skill: "energy-conservation",
    yearGroup: "Y13",
    difficulty: 8,
    variantOfRef: "physics-energy-drop-1",
    stem: "A pendulum bob is released from rest 0.45 m above its lowest point. Taking g = 10 N/kg and ignoring resistance, give its speed at the lowest point in m/s.",
    answerKey: { type: "numeric", value: 3, unit: "m/s" },
    workedSolution:
      "All of the gravitational store becomes kinetic, so v = √(2gh) = √(2 x 10 x 0.45) = √9 = 3 m/s.",
    misconceptions: {
      height_restated: "Answering 0.45 repeats the height; convert the energy store first.",
    },
    canonicalAnswer: "3",
    nearMissAnswer: "0.45",
  },
  {
    ref: "physics-photoelectric-1",
    kind: "reasoning",
    subject: "physics",
    topic: "quantum physics",
    skill: "photoelectric-effect",
    yearGroup: "Y13",
    difficulty: 9,
    stem: "A metal has a work function of 2.0 eV. Light with photon energy 5.0 eV falls on it. Give the maximum kinetic energy of an emitted electron in eV.",
    answerKey: { type: "numeric", value: 3, tolerance: 0.05, unit: "eV" },
    workedSolution:
      "The photon energy pays for the escape first: maximum kinetic energy = 5.0 - 2.0 = 3.0 eV.",
    misconceptions: {
      energies_added:
        "Answering 7 adds the work function; the work function is spent escaping the surface, so subtract it.",
    },
    canonicalAnswer: "3.0",
    nearMissAnswer: "7",
  },
  {
    ref: "physics-impulse-1",
    kind: "reasoning",
    subject: "physics",
    topic: "momentum",
    skill: "momentum",
    yearGroup: "Y13",
    difficulty: 10,
    stem: "A 0.150 kg ball travelling at 8.0 m/s hits a wall and rebounds at 6.0 m/s in the opposite direction. The contact lasts 0.020 s. Give the size of the average force on the ball in newtons.",
    answerKey: { type: "numeric", value: 105, tolerance: 0.5, unit: "N" },
    workedSolution:
      "The velocity changes from +8.0 to -6.0 m/s, a change of 14.0 m/s. The change in momentum is 0.150 x 14.0 = 2.1 kg m/s, and dividing by the contact time gives 2.1 divided by 0.020 = 105 N.",
    misconceptions: {
      direction_ignored:
        "Answering 15 uses the difference in speeds, 8.0 minus 6.0, and misses that the ball reverses direction.",
    },
    canonicalAnswer: "105",
    nearMissAnswer: "15",
  },

  // -------------------------------------------------------------- chemistry
  {
    ref: "chem-neutrons-1",
    kind: "retrieval",
    subject: "chemistry",
    topic: "atomic structure",
    skill: "atomic-structure",
    yearGroup: "Y9",
    difficulty: 2,
    stem: "An atom of sodium has atomic number 11 and mass number 23. Give the number of neutrons.",
    answerKey: { type: "numeric", value: 12 },
    workedSolution:
      "Neutrons are the mass number minus the number of protons: 23 - 11 = 12.",
    misconceptions: {
      mass_number_used: "Answering 23 gives the mass number, which counts protons and neutrons together.",
    },
    canonicalAnswer: "12",
    nearMissAnswer: "23",
  },
  {
    ref: "chem-balancing-1",
    kind: "retrieval",
    subject: "chemistry",
    topic: "chemical equations",
    skill: "balancing-equations",
    yearGroup: "Y9",
    difficulty: 3,
    stem: "Balance this equation by giving the three missing numbers in order, separated by commas: __ H2 + __ O2 gives __ H2O.",
    answerKey: { type: "set", values: ["2", "1", "2"], ordered: true },
    workedSolution:
      "Two molecules of hydrogen and one of oxygen make two of water: 2H2 + O2 gives 2H2O. That is 4 hydrogen atoms and 2 oxygen atoms on each side.",
    misconceptions: {
      wrong_side_adjusted:
        "Answering 1, 2, 1 doubles the oxygen on the left instead of doubling the water on the right, which leaves oxygen unbalanced.",
    },
    canonicalAnswer: "2, 1, 2",
    nearMissAnswer: "1, 2, 1",
  },
  {
    ref: "chem-separation-1",
    kind: "practice",
    subject: "chemistry",
    topic: "separation techniques",
    skill: "separation-techniques",
    yearGroup: "Y9",
    difficulty: 3,
    stem: "Which method separates a dissolved solid from its solution?",
    answerKey: { type: "choice", index: 1 },
    distractors: ["Filtration", "Crystallisation", "Chromatography", "Decanting"],
    workedSolution:
      "A dissolved solid passes straight through filter paper. Evaporating the solvent leaves the solid behind as crystals, so crystallisation is the method.",
    misconceptions: {
      filtration_assumed:
        "Choosing filtration assumes the solid is undissolved; a dissolved solid passes through the paper.",
    },
    canonicalAnswer: "Crystallisation",
    nearMissAnswer: "Filtration",
  },
  {
    ref: "chem-moles-1",
    kind: "reasoning",
    subject: "chemistry",
    topic: "moles",
    skill: "mole-calculations",
    yearGroup: "Y10",
    difficulty: 5,
    stem: "Give the number of moles in 8.0 g of magnesium oxide, MgO. Use Mr = 40.",
    answerKey: { type: "numeric", value: 0.2, tolerance: 0.005, unit: "mol" },
    workedSolution: "Moles are mass divided by Mr: 8.0 divided by 40 is 0.2 mol.",
    misconceptions: {
      multiplied_instead: "Answering 320 multiplies mass by Mr instead of dividing.",
    },
    canonicalAnswer: "0.2",
    nearMissAnswer: "320",
  },
  {
    ref: "chem-moles-transfer-1",
    kind: "transfer",
    subject: "chemistry",
    topic: "moles",
    skill: "mole-calculations",
    yearGroup: "Y10",
    difficulty: 7,
    variantOfRef: "chem-moles-1",
    stem: "A tablet contains 0.50 g of calcium carbonate, CaCO3, with Mr = 100. Give the number of moles of calcium carbonate in the tablet.",
    answerKey: { type: "numeric", value: 0.005, tolerance: 0.00005, unit: "mol" },
    workedSolution: "Moles are mass divided by Mr: 0.50 divided by 100 is 0.005 mol.",
    misconceptions: {
      decimal_slipped: "Answering 0.05 slips one decimal place; 0.50 divided by 100 is 0.005.",
    },
    canonicalAnswer: "0.005",
    nearMissAnswer: "0.05",
  },
  {
    ref: "chem-percentage-yield-1",
    kind: "reasoning",
    subject: "chemistry",
    topic: "yield",
    skill: "percentage-yield",
    yearGroup: "Y10",
    difficulty: 5,
    stem: "A reaction has a theoretical yield of 25.0 g and produces 18.0 g of product. Give the percentage yield.",
    answerKey: { type: "numeric", value: 72, tolerance: 0.05 },
    workedSolution:
      "Percentage yield is actual divided by theoretical, times 100: 18.0 divided by 25.0 x 100 = 72.",
    misconceptions: {
      fraction_inverted: "Answering 139 divides theoretical by actual; the actual mass goes on top.",
    },
    canonicalAnswer: "72",
    nearMissAnswer: "139",
  },
  {
    ref: "chem-ionic-formula-1",
    kind: "retrieval",
    subject: "chemistry",
    topic: "bonding",
    skill: "ionic-bonding",
    yearGroup: "Y10",
    difficulty: 4,
    stem: "Give the formula of the ionic compound formed between magnesium and chlorine.",
    answerKey: { type: "exact", value: "MgCl2" },
    workedSolution:
      "Magnesium forms a 2+ ion and chlorine forms a 1- ion. Two chloride ions balance one magnesium ion, giving MgCl2.",
    misconceptions: {
      charges_unbalanced:
        "Answering MgCl leaves the charges unbalanced; the 2+ on magnesium needs two chloride ions.",
    },
    canonicalAnswer: "MgCl2",
    nearMissAnswer: "MgCl",
  },
  {
    ref: "chem-empirical-formula-1",
    kind: "reasoning",
    subject: "chemistry",
    topic: "formulae",
    skill: "empirical-formula",
    yearGroup: "Y11",
    difficulty: 6,
    stem: "A compound contains 2.4 g of carbon and 0.6 g of hydrogen. Using Ar values of 12 for carbon and 1 for hydrogen, give its empirical formula.",
    answerKey: { type: "exact", value: "CH3" },
    workedSolution:
      "Divide each mass by its Ar: carbon gives 2.4 divided by 12 = 0.2 mol and hydrogen gives 0.6 divided by 1 = 0.6 mol. Dividing both by the smaller gives a ratio of 1 to 3, so the empirical formula is CH3.",
    misconceptions: {
      mass_ratio_used: "Answering C4H uses the ratio of masses; divide each mass by its Ar first.",
    },
    canonicalAnswer: "CH3",
    nearMissAnswer: "C4H",
  },
  {
    ref: "chem-titration-1",
    kind: "reasoning",
    subject: "chemistry",
    topic: "titration",
    skill: "titration-calculation",
    yearGroup: "Y11",
    difficulty: 7,
    stem: "25.0 cm^3 of 0.100 mol/dm^3 sodium hydroxide is neutralised by 20.0 cm^3 of hydrochloric acid. The reaction is 1 to 1. Give the concentration of the acid in mol/dm^3.",
    answerKey: { type: "numeric", value: 0.125, tolerance: 0.0005, unit: "mol/dm^3" },
    workedSolution:
      "Moles of sodium hydroxide are 0.0250 x 0.100 = 0.00250 mol. The ratio is 1 to 1, so the acid supplies 0.00250 mol as well. Its concentration is 0.00250 divided by 0.0200 = 0.125 mol/dm^3.",
    misconceptions: {
      volumes_swapped:
        "Answering 0.08 divides by the wrong volume; the acid's moles go over the acid's volume.",
    },
    canonicalAnswer: "0.125",
    nearMissAnswer: "0.08",
  },
  {
    ref: "chem-rates-explain-1",
    kind: "reasoning",
    subject: "chemistry",
    topic: "rates of reaction",
    skill: "rates-collision-theory",
    yearGroup: "Y11",
    difficulty: 6,
    stem: "Explain why raising the temperature increases the rate of a chemical reaction. Write two or three sentences.",
    answerKey: {
      type: "rubric",
      passMark: 0.6,
      criteria: [
        {
          id: "collision_frequency",
          weight: 1,
          keywords: [
            "collide more often",
            "more collisions",
            "collision frequency",
            "collide more frequently",
            "more frequent collisions",
          ],
        },
        {
          id: "particle_speed",
          weight: 1,
          keywords: [
            "move faster",
            "moving faster",
            "more kinetic energy",
            "greater kinetic energy",
            "particles speed up",
          ],
        },
        {
          id: "activation_energy",
          weight: 1,
          keywords: ["activation energy", "enough energy to react", "sufficient energy"],
        },
      ],
    },
    workedSolution:
      "At a higher temperature the particles have more kinetic energy, so they move faster and collide more often. More importantly, a greater proportion of those collisions have at least the activation energy, so more of them are successful.",
    misconceptions: {
      collisions_only:
        "Saying only that particles collide more often misses the larger effect: more collisions now reach the activation energy.",
    },
    canonicalAnswer:
      "The particles move faster, so they collide more often, and more of those collisions have at least the activation energy.",
    nearMissAnswer: "The mixture gets hotter and the reaction looks different.",
  },
  {
    ref: "chem-ph-1",
    kind: "reasoning",
    subject: "chemistry",
    topic: "acids and bases",
    skill: "acid-base-ph",
    yearGroup: "Y12",
    difficulty: 6,
    stem: "Give the pH of a 0.010 mol/dm^3 solution of a strong monoprotic acid.",
    answerKey: { type: "numeric", value: 2 },
    workedSolution:
      "A strong monoprotic acid fully dissociates, so the hydrogen ion concentration is 0.010 mol/dm^3. pH is minus the log to base 10 of that, which is 2.",
    misconceptions: {
      sign_dropped: "Answering -2 leaves out the minus sign in the pH definition.",
    },
    canonicalAnswer: "2",
    nearMissAnswer: "-2",
  },
  {
    ref: "chem-electrolysis-1",
    kind: "reasoning",
    subject: "chemistry",
    topic: "electrolysis",
    skill: "electrolysis",
    yearGroup: "Y12",
    difficulty: 6,
    stem: "Molten lead bromide is electrolysed. Name the product formed at the cathode.",
    answerKey: { type: "exact", value: "lead", alternates: ["pb", "lead metal", "molten lead"] },
    workedSolution:
      "Positive ions move to the cathode. Lead ions gain electrons there and form lead metal.",
    misconceptions: {
      electrodes_swapped:
        "Answering bromine names the product at the anode; positive ions move to the cathode.",
    },
    canonicalAnswer: "lead",
    nearMissAnswer: "bromine",
  },
  {
    ref: "chem-alkane-formula-1",
    kind: "retrieval",
    subject: "chemistry",
    topic: "organic chemistry",
    skill: "organic-nomenclature",
    yearGroup: "Y13",
    difficulty: 6,
    stem: "Give the molecular formula of butane.",
    answerKey: { type: "exact", value: "C4H10" },
    workedSolution:
      "Butane has four carbon atoms, and alkanes follow CnH2n+2, so the formula is C4H10.",
    misconceptions: {
      alkene_formula_used: "Answering C4H8 uses the alkene formula CnH2n; alkanes are CnH2n+2.",
    },
    canonicalAnswer: "C4H10",
    nearMissAnswer: "C4H8",
  },
  {
    ref: "chem-equilibrium-1",
    kind: "reasoning",
    subject: "chemistry",
    topic: "equilibrium",
    skill: "equilibrium-le-chatelier",
    yearGroup: "Y13",
    difficulty: 8,
    stem: "Nitrogen and hydrogen react reversibly to form ammonia: N2 + 3H2 gives 2NH3, and the forward reaction is exothermic. State and explain the effect of raising the pressure on the yield of ammonia.",
    answerKey: {
      type: "rubric",
      passMark: 0.6,
      criteria: [
        {
          id: "direction",
          weight: 1,
          keywords: [
            "yield increases",
            "increases",
            "shifts right",
            "moves right",
            "more ammonia",
            "goes up",
          ],
        },
        {
          id: "moles",
          weight: 1,
          keywords: [
            "fewer moles",
            "fewer molecules",
            "four moles",
            "two moles",
            "side with fewer",
            "fewer gas molecules",
          ],
        },
        {
          id: "principle",
          weight: 1,
          keywords: ["oppose", "opposes", "counteract", "le chatelier", "reduce the pressure"],
        },
      ],
    },
    workedSolution:
      "There are four moles of gas on the left and two on the right. Raising the pressure shifts the position of equilibrium towards the side with fewer moles of gas, which opposes the change, so the yield of ammonia increases.",
    misconceptions: {
      temperature_argument:
        "Explaining the shift with the exothermic forward reaction answers a temperature change, not a pressure change.",
    },
    canonicalAnswer:
      "The yield increases, because the equilibrium shifts towards the side with fewer moles of gas to oppose the rise in pressure.",
    nearMissAnswer: "The yield falls because the forward reaction gives out heat.",
  },

  // ---------------------------------------------------------------- biology
  {
    ref: "bio-nucleus-1",
    kind: "retrieval",
    subject: "biology",
    topic: "cell biology",
    skill: "cell-structure",
    yearGroup: "Y9",
    difficulty: 1,
    stem: "Name the part of an animal cell that holds the genetic material.",
    answerKey: { type: "exact", value: "nucleus", alternates: ["the nucleus"] },
    workedSolution: "The nucleus holds the chromosomes, which carry the cell's DNA.",
    misconceptions: {
      mitochondria_named:
        "Answering mitochondria names the site of aerobic respiration; almost all of the cell's DNA sits in the nucleus.",
    },
    canonicalAnswer: "nucleus",
    nearMissAnswer: "mitochondria",
  },
  {
    ref: "bio-photosynthesis-gas-1",
    kind: "retrieval",
    subject: "biology",
    topic: "photosynthesis",
    skill: "photosynthesis",
    yearGroup: "Y9",
    difficulty: 2,
    stem: "Name the gas a leaf takes in during photosynthesis.",
    answerKey: { type: "exact", value: "carbon dioxide", alternates: ["co2", "carbon-dioxide"] },
    workedSolution:
      "Photosynthesis uses carbon dioxide and water to make glucose, and releases oxygen.",
    misconceptions: {
      oxygen_named: "Answering oxygen names the gas the leaf releases, not the gas it takes in.",
    },
    canonicalAnswer: "carbon dioxide",
    nearMissAnswer: "oxygen",
  },
  {
    ref: "bio-destarch-1",
    kind: "reasoning",
    subject: "biology",
    topic: "photosynthesis",
    skill: "photosynthesis",
    yearGroup: "Y9",
    difficulty: 4,
    stem: "A plant is kept in darkness for 48 hours before a starch test. Explain why.",
    answerKey: {
      type: "rubric",
      passMark: 0.9,
      criteria: [
        {
          id: "removes_starch",
          weight: 1,
          keywords: [
            "use up the starch",
            "uses up the starch",
            "used up the starch",
            "uses up its starch",
            "remove the starch",
            "removes the starch",
            "destarch",
            "no starch left",
          ],
        },
        {
          id: "valid_test",
          weight: 1,
          keywords: [
            "fair test",
            "valid",
            "control",
            "made during the experiment",
            "made during the test",
            "comes from the experiment",
          ],
        },
      ],
    },
    workedSolution:
      "Without light the plant cannot photosynthesise, so it uses up the starch it had already stored. Any starch found afterwards must have been made during the experiment, which makes the test fair.",
    misconceptions: {
      plant_harmed:
        "Saying the darkness harms the plant confuses stopping photosynthesis with damaging the plant.",
    },
    canonicalAnswer:
      "Darkness stops photosynthesis so the leaves use up the starch already stored, which makes it a fair test of what is made afterwards.",
    nearMissAnswer: "The plant needs a rest from bright light before an experiment like this.",
  },
  {
    ref: "bio-magnification-1",
    kind: "practice",
    subject: "biology",
    topic: "microscopy",
    skill: "microscopy-magnification",
    yearGroup: "Y9",
    difficulty: 4,
    stem: "A cell appears 40 mm wide under a microscope at a total magnification of 200 times. Give the real width of the cell in micrometres.",
    answerKey: { type: "numeric", value: 200, unit: "micrometres" },
    workedSolution:
      "Real size is image size divided by magnification: 40 divided by 200 is 0.2 mm. There are 1000 micrometres in a millimetre, so the width is 200 micrometres.",
    misconceptions: {
      unit_not_converted: "Answering 0.2 stops at millimetres; the question asks for micrometres.",
      multiplied_instead: "Answering 8000 multiplies by the magnification instead of dividing.",
    },
    canonicalAnswer: "200",
    nearMissAnswer: "0.2",
  },
  {
    ref: "bio-enzyme-protein-1",
    kind: "retrieval",
    subject: "biology",
    topic: "enzymes",
    skill: "enzymes",
    yearGroup: "Y10",
    difficulty: 3,
    stem: "Name the type of molecule that every enzyme is made from.",
    answerKey: { type: "exact", value: "protein", alternates: ["proteins", "a protein"] },
    workedSolution:
      "Enzymes are proteins. The folded shape of the protein gives each enzyme an active site that fits one substrate.",
    misconceptions: {
      substrate_named:
        "Answering carbohydrate names a substrate that many enzymes act on, not the enzyme itself.",
    },
    canonicalAnswer: "protein",
    nearMissAnswer: "carbohydrate",
  },
  {
    ref: "bio-denaturation-1",
    kind: "transfer",
    subject: "biology",
    topic: "enzymes",
    skill: "enzymes",
    yearGroup: "Y13",
    difficulty: 8,
    variantOfRef: "bio-enzyme-protein-1",
    stem: "An enzyme is heated to 80 degrees Celsius and stops working permanently. Name the change to the enzyme that explains this.",
    answerKey: {
      type: "exact",
      value: "denaturation",
      alternates: ["denatured", "it is denatured", "denaturing", "denatures", "the enzyme denatures"],
    },
    workedSolution:
      "Heat breaks the bonds that hold the folded shape, so the active site changes shape permanently and the substrate no longer fits. The enzyme has been denatured.",
    misconceptions: {
      enzyme_killed:
        "Saying the enzyme is killed treats it as alive; an enzyme is a molecule that loses its shape.",
    },
    canonicalAnswer: "denaturation",
    nearMissAnswer: "it is killed",
  },
  {
    ref: "bio-osmosis-1",
    kind: "reasoning",
    subject: "biology",
    topic: "transport in cells",
    skill: "osmosis",
    yearGroup: "Y10",
    difficulty: 5,
    stem: "Potato cylinders are left in a concentrated sugar solution for an hour. State what happens to their mass.",
    answerKey: {
      type: "exact",
      value: "decreases",
      alternates: [
        "decrease",
        "decreased",
        "it decreases",
        "mass decreases",
        "goes down",
        "falls",
        "loses mass",
        "it loses mass",
      ],
    },
    workedSolution:
      "The solution outside is more concentrated than the cell contents, so water leaves the cells by osmosis and the cylinders lose mass.",
    misconceptions: {
      water_direction_reversed:
        "Answering that the mass increases has water moving into the more concentrated solution; water moves the other way.",
    },
    canonicalAnswer: "decreases",
    nearMissAnswer: "increases",
  },
  {
    ref: "bio-punnett-1",
    kind: "reasoning",
    subject: "biology",
    topic: "genetics",
    skill: "genetics-punnett",
    yearGroup: "Y10",
    difficulty: 5,
    stem: "Two parents are both heterozygous for a recessive condition, Bb crossed with Bb. Give the percentage of offspring expected to show the recessive phenotype.",
    answerKey: { type: "numeric", value: 25 },
    workedSolution:
      "The cross gives BB, Bb, Bb and bb. Only bb shows the recessive phenotype, which is one outcome in four, or 25%.",
    misconceptions: {
      carriers_counted:
        "Answering 50 counts the heterozygous offspring as showing the trait; only bb shows it.",
    },
    canonicalAnswer: "25",
    nearMissAnswer: "50",
  },
  {
    ref: "bio-punnett-transfer-1",
    kind: "transfer",
    subject: "biology",
    topic: "genetics",
    skill: "genetics-punnett",
    yearGroup: "Y11",
    difficulty: 6,
    variantOfRef: "bio-punnett-1",
    stem: "Cystic fibrosis is caused by a recessive allele. Both parents are carriers. Out of 100 children, give the number expected to have cystic fibrosis.",
    answerKey: { type: "numeric", value: 25 },
    workedSolution:
      "Two carriers give a one in four chance that a child inherits both recessive alleles, so 25 of 100 children are expected to have the condition.",
    misconceptions: {
      carriers_as_affected:
        "Answering 50 counts the carriers as affected; a carrier has one working allele and does not have the condition.",
    },
    canonicalAnswer: "25",
    nearMissAnswer: "50",
  },
  {
    ref: "bio-anaerobic-1",
    kind: "reasoning",
    subject: "biology",
    topic: "respiration",
    skill: "respiration",
    yearGroup: "Y11",
    difficulty: 5,
    stem: "During hard exercise a muscle cell runs short of oxygen. Name the substance that then builds up in the muscle.",
    answerKey: { type: "exact", value: "lactic acid", alternates: ["lactate"] },
    workedSolution:
      "Without enough oxygen the muscle respires anaerobically, breaking glucose down to lactic acid.",
    misconceptions: {
      aerobic_product_named:
        "Answering carbon dioxide names the aerobic product; anaerobic respiration in muscle gives lactic acid.",
    },
    canonicalAnswer: "lactic acid",
    nearMissAnswer: "carbon dioxide",
  },
  {
    ref: "bio-plant-cell-1",
    kind: "retrieval",
    subject: "biology",
    topic: "cell biology",
    skill: "cell-structure",
    yearGroup: "Y11",
    difficulty: 3,
    stem: "Which structure is found in a plant cell but not in an animal cell?",
    answerKey: { type: "choice", index: 1 },
    distractors: ["Ribosome", "Cell wall", "Mitochondrion", "Nucleus"],
    workedSolution:
      "Plant cells have a cellulose cell wall outside the membrane. Ribosomes, mitochondria and a nucleus are found in both cell types.",
    misconceptions: {
      plants_lack_mitochondria:
        "Choosing mitochondrion assumes plants do not respire; plant cells respire and have mitochondria.",
    },
    canonicalAnswer: "Cell wall",
    nearMissAnswer: "Mitochondrion",
  },
  {
    ref: "bio-glucose-control-1",
    kind: "reasoning",
    subject: "biology",
    topic: "homeostasis",
    skill: "homeostasis-blood-glucose",
    yearGroup: "Y12",
    difficulty: 6,
    stem: "Blood glucose rises after a meal. Explain how the body brings it back down.",
    answerKey: {
      type: "rubric",
      passMark: 0.6,
      criteria: [
        { id: "hormone", weight: 1, keywords: ["insulin"] },
        { id: "source", weight: 1, keywords: ["pancreas"] },
        {
          id: "effect",
          weight: 1,
          keywords: ["glycogen", "liver", "take up glucose", "takes up glucose", "stored", "absorb glucose"],
        },
      ],
    },
    workedSolution:
      "The pancreas detects the rise and releases insulin. Insulin makes liver and muscle cells take glucose out of the blood and store it as glycogen, so blood glucose falls.",
    misconceptions: {
      glucagon_swapped:
        "Naming glucagon reverses the pair; glucagon raises blood glucose and insulin lowers it.",
    },
    canonicalAnswer:
      "The pancreas releases insulin, which makes liver and muscle cells take up glucose and store it as glycogen.",
    nearMissAnswer: "The kidneys filter the extra sugar out of the blood.",
  },
  {
    ref: "bio-transpiration-1",
    kind: "reasoning",
    subject: "biology",
    topic: "transport in plants",
    skill: "transport-xylem",
    yearGroup: "Y12",
    difficulty: 6,
    stem: "Which change increases the rate of transpiration from a leaf?",
    answerKey: { type: "choice", index: 2 },
    distractors: ["Higher humidity", "Lower temperature", "Faster air movement", "Less light"],
    workedSolution:
      "Moving air carries water vapour away from the leaf surface, which keeps the concentration gradient steep, so transpiration speeds up.",
    misconceptions: {
      humidity_reversed:
        "Choosing higher humidity reverses the gradient; damp air slows evaporation from the leaf.",
    },
    canonicalAnswer: "Faster air movement",
    nearMissAnswer: "Higher humidity",
  },
  {
    ref: "bio-antibiotic-resistance-1",
    kind: "reasoning",
    subject: "biology",
    topic: "evolution",
    skill: "natural-selection",
    yearGroup: "Y12",
    difficulty: 7,
    stem: "Explain how a population of bacteria becomes resistant to an antibiotic.",
    answerKey: {
      type: "rubric",
      passMark: 0.6,
      criteria: [
        { id: "variation", weight: 1, keywords: ["mutation", "mutations", "random change", "variation"] },
        {
          id: "selection",
          weight: 1,
          keywords: ["survive", "survives", "survived", "killed", "are killed", "selection pressure"],
        },
        {
          id: "reproduction",
          weight: 1,
          keywords: ["reproduce", "reproduces", "pass on", "passed on", "offspring", "divide"],
        },
      ],
    },
    workedSolution:
      "Bacteria in the population vary because of random mutation. When the antibiotic is used, the bacteria without resistance are killed and the resistant ones survive. The survivors reproduce and pass the allele on, so the resistant form becomes common.",
    misconceptions: {
      adaptation_on_demand:
        "Saying the bacteria become resistant because they need to be treats the change as deliberate; resistance appears by chance mutation and is then selected.",
    },
    canonicalAnswer:
      "A random mutation makes a few bacteria resistant, those bacteria survive the antibiotic while the rest are killed, and they reproduce so the resistant form spreads.",
    nearMissAnswer: "The bacteria get used to the antibiotic over time and grow stronger.",
  },
  {
    ref: "bio-antibody-cell-1",
    kind: "retrieval",
    subject: "biology",
    topic: "immunity",
    skill: "immune-response",
    yearGroup: "Y13",
    difficulty: 7,
    stem: "Name the type of white blood cell that produces antibodies.",
    answerKey: {
      type: "exact",
      value: "lymphocyte",
      alternates: [
        "lymphocytes",
        "b lymphocyte",
        "b lymphocytes",
        "b-lymphocyte",
        "b cell",
        "b cells",
        "plasma cell",
        "plasma cells",
      ],
    },
    workedSolution:
      "B lymphocytes recognise an antigen and divide. Their plasma cells release antibodies against that antigen.",
    misconceptions: {
      phagocyte_named:
        "Answering phagocyte names the cell that engulfs pathogens, not the one that makes antibodies.",
    },
    canonicalAnswer: "lymphocyte",
    nearMissAnswer: "phagocyte",
  },

  // ---------------------------------------------------------------- english
  {
    ref: "eng-personification-1",
    kind: "retrieval",
    subject: "english",
    topic: "language analysis",
    skill: "language-devices",
    yearGroup: "Y9",
    difficulty: 2,
    stem: "Name the device used in this line: The wind whispered through the trees.",
    answerKey: { type: "exact", value: "personification", alternates: ["personified"] },
    workedSolution:
      "Whispering is something a person does. Giving a human action to the wind is personification.",
    misconceptions: {
      metaphor_default:
        "Answering metaphor is close, but the line gives a human action to something non-human, which is personification.",
    },
    canonicalAnswer: "personification",
    nearMissAnswer: "metaphor",
  },
  {
    ref: "eng-personification-transfer-1",
    kind: "transfer",
    subject: "english",
    topic: "language analysis",
    skill: "language-devices",
    yearGroup: "Y13",
    difficulty: 7,
    variantOfRef: "eng-personification-1",
    stem: "Name the device used in this advertising line: Our engines wake the city.",
    answerKey: { type: "exact", value: "personification", alternates: ["personified"] },
    workedSolution:
      "Waking is something a person does. Giving that action to the engines is personification.",
    misconceptions: {
      hyperbole_default:
        "Answering hyperbole reads the line as exaggeration; the line gives a human action to the engines, which is personification.",
    },
    canonicalAnswer: "personification",
    nearMissAnswer: "hyperbole",
  },
  {
    ref: "eng-apostrophe-1",
    kind: "retrieval",
    subject: "english",
    topic: "punctuation",
    skill: "apostrophes",
    yearGroup: "Y9",
    difficulty: 3,
    stem: "Which sentence uses the apostrophe correctly?",
    answerKey: { type: "choice", index: 1 },
    distractors: [
      "The dog wagged it's tail.",
      "The dogs' owners waited outside.",
      "The dog's are barking.",
      "Its' collar was red.",
    ],
    workedSolution:
      "The owners belong to more than one dog, so the apostrophe goes after the plural s. The possessive its never takes an apostrophe.",
    misconceptions: {
      its_contraction:
        "Choosing the tail option uses it's, which is short for it is; the possessive its takes no apostrophe.",
    },
    canonicalAnswer: "The dogs' owners waited outside.",
    nearMissAnswer: "The dog wagged it's tail.",
  },
  {
    ref: "eng-homophone-1",
    kind: "practice",
    subject: "english",
    topic: "spelling",
    skill: "spelling-homophones",
    yearGroup: "Y9",
    difficulty: 2,
    stem: "Choose the correct word to fill the gap: The team lost ___ nerve.",
    answerKey: { type: "choice", index: 1 },
    distractors: ["they're", "their", "there", "theirs"],
    workedSolution:
      "The nerve belongs to the team, so the possessive their is correct. They're is short for they are, and there refers to a place.",
    misconceptions: {
      contraction_chosen:
        "Choosing they're uses the contraction of they are; the sentence needs the possessive their.",
    },
    canonicalAnswer: "their",
    nearMissAnswer: "they're",
  },
  {
    ref: "eng-active-voice-1",
    kind: "reasoning",
    subject: "english",
    topic: "grammar",
    skill: "active-passive-voice",
    yearGroup: "Y10",
    difficulty: 4,
    stem: "Rewrite this sentence in the active voice: The window was broken by the boy.",
    answerKey: { type: "exact", value: "the boy broke the window" },
    workedSolution:
      "The active voice puts the person doing the action first, so the sentence becomes: The boy broke the window.",
    misconceptions: {
      agent_removed:
        "Answering that the window broke drops the boy; the active voice keeps him as the subject.",
    },
    canonicalAnswer: "The boy broke the window.",
    nearMissAnswer: "The window broke.",
  },
  {
    ref: "eng-word-class-1",
    kind: "practice",
    subject: "english",
    topic: "grammar",
    skill: "word-class",
    yearGroup: "Y10",
    difficulty: 3,
    stem: "Give the word class of quickly in this sentence: She quickly closed the door.",
    answerKey: { type: "exact", value: "adverb", alternates: ["an adverb", "adverbs"] },
    workedSolution: "Quickly describes how the verb closed was done, so it is an adverb.",
    misconceptions: {
      adjective_chosen:
        "Answering adjective describes a word that modifies a noun; quickly modifies the verb closed.",
    },
    canonicalAnswer: "adverb",
    nearMissAnswer: "adjective",
  },
  {
    ref: "eng-analysis-sentence-1",
    kind: "reasoning",
    subject: "english",
    topic: "language analysis",
    skill: "essay-structure-point-evidence",
    yearGroup: "Y10",
    difficulty: 5,
    stem: "Write one analytical sentence about the effect of the verb whispered in: The wind whispered through the trees.",
    answerKey: {
      type: "rubric",
      passMark: 0.6,
      criteria: [
        { id: "device", weight: 1, keywords: ["personification", "personifies", "verb"] },
        {
          id: "effect",
          weight: 1,
          keywords: ["gentle", "quiet", "soft", "calm", "peaceful", "soothing", "secretive", "intimate"],
        },
        {
          id: "reader",
          weight: 1,
          keywords: ["suggests", "implies", "creates", "conveys", "makes the reader", "gives the impression"],
        },
      ],
    },
    workedSolution:
      "Name the device, then say what it makes the reader picture or feel. For example: the personification in whispered suggests a gentle, secretive movement rather than a violent one.",
    misconceptions: {
      feature_spotting:
        "Naming the device without saying what it makes the reader think or feel stops at feature spotting.",
    },
    canonicalAnswer:
      "The personification in whispered suggests a gentle, secretive movement rather than a violent one.",
    nearMissAnswer: "The writer uses good description here which is very effective.",
  },
  {
    ref: "eng-structure-effect-1",
    kind: "reasoning",
    subject: "english",
    topic: "poetry",
    skill: "unseen-poetry-analysis",
    yearGroup: "Y11",
    difficulty: 6,
    stem: "A poem ends with a single-word line: Alone. Explain the effect of this structural choice.",
    answerKey: {
      type: "rubric",
      passMark: 0.6,
      criteria: [
        {
          id: "meaning",
          weight: 1,
          keywords: ["isolation", "isolated", "loneliness", "lonely", "separated", "cut off", "abandoned"],
        },
        {
          id: "structure",
          weight: 1,
          keywords: [
            "single word",
            "one word",
            "short line",
            "final line",
            "last line",
            "white space",
            "pause",
            "stands apart",
          ],
        },
        {
          id: "reader",
          weight: 1,
          keywords: ["reader", "emphasis", "emphasises", "lingers", "draws attention", "stark"],
        },
      ],
    },
    workedSolution:
      "The line is held apart by white space, so the eye rests on it. The single word acts out the isolation it describes, and because it is the last thing on the page it stays with the reader.",
    misconceptions: {
      structure_without_effect:
        "Saying only that the line is short describes the choice without explaining what it does to the reader.",
    },
    canonicalAnswer:
      "Ending on a single word leaves it standing apart on the page, and that isolation mirrors the speaker's state, so the reader is left holding it.",
    nearMissAnswer: "It makes the poem finish quickly and sounds quite sad at the end.",
  },
  {
    ref: "eng-soliloquy-1",
    kind: "retrieval",
    subject: "english",
    topic: "drama",
    skill: "shakespeare-context",
    yearGroup: "Y11",
    difficulty: 4,
    stem: "Give the term fo