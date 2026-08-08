import { describe, expect, it } from "vitest";
import { scoreAttempt, type XpInput } from "../xp";
import { XP } from "../types";

const base: XpInput = {
  unaided: false,
  outcome: "correct",
  attemptsCount: 1,
  maxHelpLevel: "none",
  selfCorrected: false,
  persistedAfterError: false,
  selfExplanation: false,
  itemKind: "reasoning",
};

const input = (patch: Partial<XpInput>): XpInput => ({ ...base, ...patch });
const keys = (a: XpInput) => scoreAttempt(a).lines.map((l) => l.key);

describe("scoreAttempt — the §10 table, exactly", () => {
  it("keeps the award amounts the spec fixed", () => {
    expect(XP).toEqual({
      independentSolution: 10,
      persistenceAfterError: 5,
      selfExplanation: 5,
      selfCorrection: 5,
      transferSolved: 10,
      strategicHintUse: 2,
      unnecessaryDependence: 0,
    });
  });

  const cases: [string, Partial<XpInput>, number][] = [
    ["independent solution", { unaided: true }, 10],
    [
      "persistence after an incorrect attempt",
      { outcome: "incorrect", attemptsCount: 3, persistedAfterError: true },
      5,
    ],
    ["self-explanation", { unaided: true, selfExplanation: true }, 15],
    ["self-correction", { unaided: true, selfCorrected: true }, 15],
    ["transfer solved unaided", { unaided: true, itemKind: "transfer" }, 20],
    [
      "strategic hint use",
      { maxHelpLevel: "narrow", attemptsCount: 2 },
      2,
    ],
    [
      "unnecessary dependence — solution revealed",
      { maxHelpLevel: "solution", attemptsCount: 3 },
      0,
    ],
    ["unnecessary dependence — filler attempt", { outcome: "low_effort" }, 0],
    [
      "everything at once",
      {
        unaided: true,
        attemptsCount: 3,
        selfCorrected: true,
        persistedAfterError: true,
        selfExplanation: true,
        itemKind: "transfer",
      },
      35,
    ],
  ];

  for (const [name, patch, total] of cases) {
    it(`awards ${total} for ${name}`, () => {
      expect(scoreAttempt(input(patch)).total).toBe(total);
    });
  }

  it("totals exactly the sum of its lines", () => {
    for (const [, patch] of cases) {
      const r = scoreAttempt(input(patch));
      expect(r.total).toBe(r.lines.reduce((sum, l) => sum + l.amount, 0));
    }
  });
});

describe("scoreAttempt — completion and speed earn nothing (R4)", () => {
  it("scores 0 for finishing an item with the solution handed over", () => {
    const r = scoreAttempt(input({ maxHelpLevel: "solution", attemptsCount: 5 }));
    expect(r.total).toBe(0);
    expect(keys(input({ maxHelpLevel: "solution", attemptsCount: 5 }))).toEqual([
      "unnecessaryDependence",
    ]);
    expect(r.lines[0].amount).toBe(0);
  });

  it("scores 0 for a correct answer that shows no independence behaviour", () => {
    expect(
      scoreAttempt(input({ maxHelpLevel: "narrow", strategicHintUse: false })).total,
    ).toBe(0);
  });

  it("scores 0 for filler attempts, whatever else is flagged", () => {
    const r = scoreAttempt(
      input({
        outcome: "low_effort",
        unaided: true,
        attemptsCount: 4,
        selfCorrected: true,
        persistedAfterError: true,
        selfExplanation: true,
        itemKind: "transfer",
      }),
    );
    expect(r.total).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].key).toBe("unnecessaryDependence");
  });

  it("pays the same however long the item took — there is no time input", () => {
    expect(Object.keys(base)).not.toContain("timeMs");
    expect(Object.keys(base)).not.toContain("totalMs");
  });
});

describe("scoreAttempt — strategic help-seeking vs dependence", () => {
  it("pays +2 for a hint taken after a genuine attempt and then solving it", () => {
    const r = scoreAttempt(input({ maxHelpLevel: "question", attemptsCount: 2 }));
    expect(r.total).toBe(XP.strategicHintUse);
    expect(keys(input({ maxHelpLevel: "question", attemptsCount: 2 }))).toEqual([
      "strategicHintUse",
    ]);
  });

  it("does not pay for a hint that did not lead to a solution", () => {
    expect(
      scoreAttempt(input({ maxHelpLevel: "question", attemptsCount: 2, outcome: "incorrect" }))
        .total,
    ).toBe(0);
  });

  it("does not pay for hint avoidance — an unaided miss earns nothing on its own", () => {
    expect(scoreAttempt(input({ unaided: true, outcome: "incorrect" })).total).toBe(0);
  });

  it("does not pay strategic use when the solution was revealed", () => {
    expect(keys(input({ maxHelpLevel: "solution", attemptsCount: 4 }))).not.toContain(
      "strategicHintUse",
    );
  });

  it("does not pay an independent solution when help was used", () => {
    expect(keys(input({ unaided: true, maxHelpLevel: "question" }))).not.toContain(
      "independentSolution",
    );
  });

  it("does not pay transfer when the solution was handed over", () => {
    expect(
      scoreAttempt(
        input({ itemKind: "transfer", maxHelpLevel: "solution", attemptsCount: 4 }),
      ).total,
    ).toBe(0);
  });

  it("pays transfer plus strategic use when a hint carried it over", () => {
    expect(
      scoreAttempt(input({ itemKind: "transfer", maxHelpLevel: "narrow", attemptsCount: 2 }))
        .total,
    ).toBe(XP.transferSolved + XP.strategicHintUse);
  });
});

describe("scoreAttempt — persistence", () => {
  it("pays persistence even when the item was never solved", () => {
    const r = scoreAttempt(
      input({ outcome: "incorrect", attemptsCount: 2, persistedAfterError: true }),
    );
    expect(r.total).toBe(XP.persistenceAfterError);
  });

  it("needs a second attempt before persistence counts", () => {
    expect(
      scoreAttempt(input({ attemptsCount: 1, persistedAfterError: true })).total,
    ).toBe(0);
  });
});

describe("scoreAttempt — lines are feedback, not a payout (X1)", () => {
  it("labels the behaviour rather than celebrating a reward", () => {
    const all = [
      input({ unaided: true, selfExplanation: true, selfCorrected: true, attemptsCount: 3, persistedAfterError: true, itemKind: "transfer" }),
      input({ maxHelpLevel: "narrow", attemptsCount: 2 }),
      input({ maxHelpLevel: "solution", attemptsCount: 4 }),
      input({ outcome: "low_effort" }),
    ];
    for (const a of all) {
      for (const line of scoreAttempt(a).lines) {
        expect(line.label).toBeTruthy();
        expect(line.label).not.toMatch(/!|\bxp\b|\bpoints\b|congrat|amazing|great job/i);
        expect(line.label).not.toMatch(/\bIQ\b|intelligen|smarter/i);
        expect(line.label[0]).toBe(line.label[0].toUpperCase());
      }
    }
  });

  it("emits no line at all when nothing was earned and nothing was given away", () => {
    expect(scoreAttempt(input({ outcome: "skipped", attemptsCount: 1 })).lines).toHaveLength(0);
  });
});
