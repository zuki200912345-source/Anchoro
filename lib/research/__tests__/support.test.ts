import { describe, expect, it } from "vitest";
import {
  FADE_STREAK,
  SUPPORT_LEVELS,
  attemptsRequiredFor,
  computeSupportLevel,
  fadingRationale,
  helpGate,
  summariseEvidence,
  type CompetenceSignal,
} from "../support";
import { HELP_LEVELS, SUPPORT_POLICIES, type SupportLevel } from "../types";

const solvedUnaided: CompetenceSignal = {
  unaided: true,
  outcome: "correct",
  maxHelpLevel: "none",
};
const solvedWithHint: CompetenceSignal = {
  unaided: false,
  outcome: "correct",
  maxHelpLevel: "narrow",
};
const gotItWrong: CompetenceSignal = {
  unaided: true,
  outcome: "incorrect",
  maxHelpLevel: "none",
};
const skipped: CompetenceSignal = {
  unaided: false,
  outcome: "skipped",
  maxHelpLevel: "none",
};

const times = (n: number, s: CompetenceSignal) => Array.from({ length: n }, () => s);

describe("computeSupportLevel — fading on sustained unaided success (D4)", () => {
  it("fades one level after three consecutive unaided solves", () => {
    const d = computeSupportLevel({ current: 2, recent: times(3, solvedUnaided) });
    expect(d.level).toBe(3);
    expect(d.previous).toBe(2);
    expect(d.direction).toBe("up");
    expect(d.evidence.unaidedStreak).toBe(3);
    expect(d.policy).toBe(SUPPORT_POLICIES[3]);
  });

  it("holds below the streak requirement", () => {
    const d = computeSupportLevel({ current: 2, recent: times(FADE_STREAK - 1, solvedUnaided) });
    expect(d.level).toBe(2);
    expect(d.direction).toBe("hold");
    expect(d.rationale).toContain("1 more unaided solve");
  });

  it("requires the success to be sustained, not scattered", () => {
    const d = computeSupportLevel({
      current: 2,
      recent: [solvedUnaided, solvedWithHint, solvedUnaided, solvedUnaided],
    });
    expect(d.evidence.unaidedStreak).toBe(2);
    expect(d.level).toBe(2);
  });

  it("moves at most one level at a time", () => {
    const d = computeSupportLevel({ current: 1, recent: times(5, solvedUnaided) });
    expect(d.level).toBe(2);
  });

  it("never fades past level 5", () => {
    const d = computeSupportLevel({ current: 5, recent: times(5, solvedUnaided) });
    expect(d.level).toBe(5);
    expect(d.direction).toBe("hold");
    expect(d.rationale).toContain("nothing lighter");
  });

  it("does not fade on an empty history", () => {
    const d = computeSupportLevel({ current: 3, recent: [] });
    expect(d.level).toBe(3);
    expect(d.direction).toBe("hold");
    expect(d.evidence.window).toBe(0);
  });
});

describe("computeSupportLevel — reversibility on regression (D2)", () => {
  it("restores support after two items that did not come out unaided", () => {
    const d = computeSupportLevel({
      current: 4,
      recent: [solvedUnaided, gotItWrong, solvedUnaided, solvedWithHint],
    });
    expect(d.level).toBe(3);
    expect(d.direction).toBe("down");
    expect(d.evidence.regressions).toBe(2);
  });

  it("counts a skip as a regression", () => {
    const d = computeSupportLevel({ current: 3, recent: [skipped, skipped] });
    expect(d.level).toBe(2);
  });

  it("holds on a single regression", () => {
    const d = computeSupportLevel({ current: 3, recent: [solvedUnaided, gotItWrong] });
    expect(d.level).toBe(3);
    expect(d.direction).toBe("hold");
  });

  it("never drops below level 1", () => {
    const d = computeSupportLevel({ current: 1, recent: times(5, gotItWrong) });
    expect(d.level).toBe(1);
    expect(d.direction).toBe("hold");
  });

  it("lets recent unaided success outrank older misses", () => {
    const d = computeSupportLevel({
      current: 2,
      recent: [gotItWrong, gotItWrong, solvedUnaided, solvedUnaided, solvedUnaided],
    });
    expect(d.level).toBe(3);
  });

  it("round-trips: a fade can be undone by regressions", () => {
    const up = computeSupportLevel({ current: 2, recent: times(3, solvedUnaided) });
    const down = computeSupportLevel({ current: up.level, recent: times(2, gotItWrong) });
    expect(up.level).toBe(3);
    expect(down.level).toBe(2);
  });
});

describe("computeSupportLevel — the student's own choice (D3)", () => {
  it("honours a pinned level", () => {
    const d = computeSupportLevel({
      current: 2,
      recent: times(3, solvedUnaided),
      studentPreference: 5,
    });
    expect(d.level).toBe(5);
    expect(d.studentPinned).toBe(true);
    expect(d.rationale).toContain("until you change it");
  });

  it("surfaces what the evidence would have picked instead", () => {
    const d = computeSupportLevel({
      current: 2,
      recent: times(3, solvedUnaided),
      studentPreference: 1,
    });
    expect(d.level).toBe(1);
    expect(d.suggestion?.level).toBe(3);
    expect(d.suggestion?.reason).toContain("unaided");
  });
});

describe("fadingRationale (D5, D7)", () => {
  it("uses the spec's sentence when support fades", () => {
    const evidence = summariseEvidence(times(3, solvedUnaided));
    const line = fadingRationale(2, 3, evidence);
    expect(line).toContain("You've solved 3 unaided");
    expect(line).toContain("lighter hints");
  });

  it("states the way back when support returns, without a verdict", () => {
    const evidence = summariseEvidence(times(2, gotItWrong));
    const line = fadingRationale(4, 3, evidence);
    expect(line).toContain("Unaided solves move it again");
    expect(line).not.toMatch(/fail|bad|weak|struggl/i);
  });

  it("never claims intelligence or ability gains", () => {
    const evidence = summariseEvidence(times(3, solvedUnaided));
    for (const [from, to] of [
      [2, 3],
      [3, 2],
      [3, 3],
      [5, 5],
    ] as [SupportLevel, SupportLevel][]) {
      expect(fadingRationale(from, to, evidence)).not.toMatch(
        /\bIQ\b|intelligen|smarter|brain power/i,
      );
    }
  });
});

describe("helpGate — the attempt is the gate (B1)", () => {
  it("refuses every hint at zero attempts, at every support level", () => {
    for (const level of SUPPORT_LEVELS) {
      const gate = helpGate({
        attemptsMade: 0,
        maxHelpReached: "none",
        support: SUPPORT_POLICIES[level],
      });
      expect(gate.nextHelpAvailable, `level ${level}`).toBeNull();
      expect(gate.reason, `level ${level}`).toBeTruthy();
    }
  });

  it("says what to do when nothing has been submitted", () => {
    const gate = helpGate({
      attemptsMade: 0,
      maxHelpReached: "none",
      support: SUPPORT_POLICIES[1],
    });
    expect(gate.reason).toBe("Submit an attempt first.");
  });

  it("opens the first hint once the attempt bar is met", () => {
    expect(
      helpGate({ attemptsMade: 1, maxHelpReached: "none", support: SUPPORT_POLICIES[1] }),
    ).toEqual({ nextHelpAvailable: "strategy", reason: null, solutionAvailable: false });
  });

  it("holds the first hint at level 3 until two attempts are in", () => {
    const one = helpGate({
      attemptsMade: 1,
      maxHelpReached: "none",
      support: SUPPORT_POLICIES[3],
    });
    expect(one.nextHelpAvailable).toBeNull();
    expect(one.reason).toBe("One more attempt before the next hint.");

    const two = helpGate({
      attemptsMade: 2,
      maxHelpReached: "none",
      support: SUPPORT_POLICIES[3],
    });
    expect(two.nextHelpAvailable).toBe("strategy");
  });

  it("charges another attempt for each escalation", () => {
    const gate = helpGate({
      attemptsMade: 1,
      maxHelpReached: "strategy",
      support: SUPPORT_POLICIES[1],
    });
    expect(gate.nextHelpAvailable).toBeNull();
    expect(gate.reason).toBe("One more attempt before the next hint.");

    expect(
      helpGate({ attemptsMade: 2, maxHelpReached: "strategy", support: SUPPORT_POLICIES[1] })
        .nextHelpAvailable,
    ).toBe("question");
  });

  it("counts down when more than one attempt is missing", () => {
    const gate = helpGate({
      attemptsMade: 1,
      maxHelpReached: "strategy",
      support: SUPPORT_POLICIES[3],
    });
    expect(gate.reason).toBe("2 more attempts before the next hint.");
  });

  it("does not let 'I'm stuck' open the gate (B7)", () => {
    const gate = helpGate({
      attemptsMade: 0,
      maxHelpReached: "none",
      support: SUPPORT_POLICIES[1],
      stuck: true,
    });
    expect(gate.nextHelpAvailable).toBeNull();
    expect(gate.reason).toContain("Submit an attempt first.");
  });

  it("ignores nonsense attempt counts rather than opening the gate", () => {
    const gate = helpGate({
      attemptsMade: -5,
      maxHelpReached: "none",
      support: SUPPORT_POLICIES[1],
    });
    expect(gate.nextHelpAvailable).toBeNull();
  });
});

describe("helpGate — the worked solution bar (B4)", () => {
  it("withholds the solution until the effort bar is met", () => {
    const early = helpGate({
      attemptsMade: 2,
      maxHelpReached: "next_step",
      support: SUPPORT_POLICIES[1],
    });
    expect(early.solutionAvailable).toBe(false);
    expect(early.nextHelpAvailable).toBeNull();
    expect(early.reason).toBe("The worked solution opens after 3 attempts. You're on 2.");

    const met = helpGate({
      attemptsMade: 3,
      maxHelpReached: "next_step",
      support: SUPPORT_POLICIES[1],
    });
    expect(met.solutionAvailable).toBe(true);
    expect(met.nextHelpAvailable).toBe("solution");
  });

  it("never offers a solution at levels that do not carry one", () => {
    for (const level of [3, 4, 5] as SupportLevel[]) {
      const gate = helpGate({
        attemptsMade: 99,
        maxHelpReached: "none",
        support: SUPPORT_POLICIES[level],
      });
      expect(gate.solutionAvailable, `level ${level}`).toBe(false);
    }
  });

  it("stops at the level ceiling once every rung is spent", () => {
    const gate = helpGate({
      attemptsMade: 20,
      maxHelpReached: "next_step",
      support: SUPPORT_POLICIES[3],
    });
    expect(gate.nextHelpAvailable).toBeNull();
    expect(gate.reason).toContain("every hint this level offers");
  });
});

describe("helpGate — level 5 and brain-only have no AI (D1, E1)", () => {
  it("never returns a help level at support level 5", () => {
    for (const reached of HELP_LEVELS) {
      for (const attemptsMade of [0, 1, 3, 10, 99]) {
        const gate = helpGate({
          attemptsMade,
          maxHelpReached: reached,
          support: SUPPORT_POLICIES[5],
        });
        expect(gate.nextHelpAvailable, `${reached}/${attemptsMade}`).toBeNull();
        expect(gate.solutionAvailable).toBe(false);
        expect(gate.reason).toContain("check your answer against the key");
      }
    }
  });

  it("withholds AI for a brain-only session at any support level", () => {
    for (const level of SUPPORT_LEVELS) {
      const gate = helpGate({
        attemptsMade: 10,
        maxHelpReached: "none",
        support: SUPPORT_POLICIES[level],
        mode: "brain_only",
      });
      expect(gate.nextHelpAvailable, `level ${level}`).toBeNull();
      expect(gate.solutionAvailable).toBe(false);
    }
  });
});

describe("attemptsRequiredFor", () => {
  it("never asks for more work than the solution bar", () => {
    for (const level of SUPPORT_LEVELS) {
      const support = SUPPORT_POLICIES[level];
      for (const help of HELP_LEVELS) {
        expect(attemptsRequiredFor(help, support)).toBeLessThanOrEqual(
          support.attemptsBeforeSolution,
        );
      }
    }
  });

  it("rises monotonically up the ladder", () => {
    for (const level of SUPPORT_LEVELS) {
      const support = SUPPORT_POLICIES[level];
      const required = HELP_LEVELS.map((h) => attemptsRequiredFor(h, support));
      for (let i = 1; i < required.length; i++) {
        expect(required[i], `level ${level} rung ${HELP_LEVELS[i]}`).toBeGreaterThanOrEqual(
          required[i - 1],
        );
      }
    }
  });
});
