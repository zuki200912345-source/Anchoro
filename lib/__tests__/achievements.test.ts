import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  computeHintFreeRun,
  countChallengeWins,
  hasComebackSolve,
  pickEarnedKeys,
  type AchievementStats,
  type AttemptLite,
} from "../achievements";

const solve = (hints = 0): AttemptLite => ({ correct: true, hintsUsed: hints });
const miss = (hints = 0): AttemptLite => ({ correct: false, hintsUsed: hints });

const zeroStats: AchievementStats = {
  completedSessions: 0,
  solvedPuzzles: 0,
  bestHintFreeRun: 0,
  hasNoHintSession: false,
  hasPerfectSession: false,
  hasPerfectNoHintSession: false,
  streakBest: 0,
  bestCategoryRating: 1000,
  categoriesAt1400: 0,
  hasD10Solve: false,
  hasSub10sSolve: false,
  hasComeback: false,
  acceptedFriends: 0,
  challengeWins: 0,
};

describe("ACHIEVEMENTS definitions", () => {
  it("defines at least 16 with unique keys", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(16);
    const keys = ACHIEVEMENTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every definition has non-empty copy in sentence case", () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
      expect(a.hint.length).toBeGreaterThan(0);
      // Names stay lowercase; the app never uses Title Case.
      expect(a.name).toBe(a.name.toLowerCase());
    }
  });

  it("no banned vocabulary anywhere in the strings", () => {
    const banned =
      /unlock|delve|seamless|robust|leverage|elevate|empower|harness|tapestry|realm|journey|landscape|testament|underscore|showcase|foster|pivotal|crucial|meticulous|intricate|vibrant|transformative|unleash|supercharge|game-changer|cutting-edge|holistic|curated|bespoke|dive in|level up your/i;
    for (const a of ACHIEVEMENTS) {
      const all = `${a.key} ${a.name} ${a.description} ${a.hint}`;
      expect(all).not.toMatch(banned);
    }
  });

  it("every key has a qualification predicate", () => {
    // A stats snapshot that maxes everything must qualify for every key.
    const maxed: AchievementStats = {
      completedSessions: 1000,
      solvedPuzzles: 1000,
      bestHintFreeRun: 100,
      hasNoHintSession: true,
      hasPerfectSession: true,
      hasPerfectNoHintSession: true,
      streakBest: 365,
      bestCategoryRating: 2000,
      categoriesAt1400: 6,
      hasD10Solve: true,
      hasSub10sSolve: true,
      hasComeback: true,
      acceptedFriends: 10,
      challengeWins: 5,
    };
    expect(pickEarnedKeys(maxed)).toEqual(ACHIEVEMENTS.map((a) => a.key));
  });
});

describe("computeHintFreeRun", () => {
  it("returns 0 for no attempts", () => {
    expect(computeHintFreeRun([])).toBe(0);
  });

  it("counts consecutive hint-free solves", () => {
    expect(computeHintFreeRun([solve(), solve(), solve()])).toBe(3);
  });

  it("a hinted solve breaks the run", () => {
    const run = [solve(), solve(), solve(1), solve(), solve()];
    expect(computeHintFreeRun(run)).toBe(2);
  });

  it("a miss breaks the run", () => {
    const run = [solve(), solve(), solve(), miss(), solve()];
    expect(computeHintFreeRun(run)).toBe(3);
  });

  it("finds the best run anywhere in the window", () => {
    const run = [
      solve(),
      miss(),
      solve(),
      solve(),
      solve(),
      solve(),
      solve(),
      solve(2),
      solve(),
    ];
    expect(computeHintFreeRun(run)).toBe(5);
  });
});

describe("hasComebackSolve", () => {
  it("true when a solve follows 3 straight misses", () => {
    expect(hasComebackSolve([miss(), miss(), miss(), solve()])).toBe(true);
  });

  it("false after only 2 misses", () => {
    expect(hasComebackSolve([miss(), miss(), solve()])).toBe(false);
  });

  it("false when the misses never resolve", () => {
    expect(hasComebackSolve([miss(), miss(), miss(), miss()])).toBe(false);
  });

  it("a solve between misses resets the count", () => {
    expect(
      hasComebackSolve([miss(), miss(), solve(), miss(), solve()]),
    ).toBe(false);
  });

  it("works mid-window with more than 3 misses", () => {
    expect(
      hasComebackSolve([solve(), miss(), miss(), miss(), miss(), solve()]),
    ).toBe(true);
  });
});

describe("countChallengeWins", () => {
  const row = (challenge_id: string, user_id: string, score: number) => ({
    challenge_id,
    user_id,
    score,
  });

  it("counts a top score among 2+ results as a win", () => {
    const results = [row("c1", "me", 450), row("c1", "them", 300)];
    expect(countChallengeWins("me", results)).toBe(1);
  });

  it("a solo result is not a win", () => {
    expect(countChallengeWins("me", [row("c1", "me", 500)])).toBe(0);
  });

  it("losing scores do not count", () => {
    const results = [row("c1", "me", 200), row("c1", "them", 300)];
    expect(countChallengeWins("me", results)).toBe(0);
  });

  it("a shared top score still holds top", () => {
    const results = [row("c1", "me", 300), row("c1", "them", 300)];
    expect(countChallengeWins("me", results)).toBe(1);
  });

  it("sums wins across challenges", () => {
    const results = [
      row("c1", "me", 400),
      row("c1", "a", 100),
      row("c2", "me", 250),
      row("c2", "b", 500),
      row("c3", "me", 350),
      row("c3", "a", 340),
      row("c3", "b", 300),
    ];
    expect(countChallengeWins("me", results)).toBe(2);
  });
});

describe("pickEarnedKeys", () => {
  it("a blank account earns nothing", () => {
    expect(pickEarnedKeys(zeroStats)).toEqual([]);
  });

  it("one completed session earns exactly first_session", () => {
    const keys = pickEarnedKeys({
      ...zeroStats,
      completedSessions: 1,
      solvedPuzzles: 3,
    });
    expect(keys).toEqual(["first_session"]);
  });

  it("volume thresholds stack", () => {
    const keys = pickEarnedKeys({
      ...zeroStats,
      completedSessions: 25,
      solvedPuzzles: 100,
    });
    expect(keys).toContain("solved_10");
    expect(keys).toContain("solved_50");
    expect(keys).toContain("solved_100");
    expect(keys).not.toContain("solved_250");
  });

  it("hint-free runs gate at 5 and 20", () => {
    const at5 = pickEarnedKeys({ ...zeroStats, bestHintFreeRun: 5 });
    expect(at5).toContain("no_hint_5");
    expect(at5).not.toContain("no_hint_20");

    const at20 = pickEarnedKeys({ ...zeroStats, bestHintFreeRun: 20 });
    expect(at20).toContain("no_hint_20");
  });

  it("streak keys gate at 3, 7, 14, 30", () => {
    const week = pickEarnedKeys({ ...zeroStats, streakBest: 7 });
    expect(week).toContain("streak_3");
    expect(week).toContain("streak_7");
    expect(week).not.toContain("streak_14");
    expect(week).not.toContain("iron_streak_30");

    const month = pickEarnedKeys({ ...zeroStats, streakBest: 30 });
    expect(month).toContain("iron_streak_30");
  });

  it("mastery needs 1400 exactly, three categories for the second key", () => {
    const below = pickEarnedKeys({ ...zeroStats, bestCategoryRating: 1399 });
    expect(below).not.toContain("rating_1400");

    const one = pickEarnedKeys({
      ...zeroStats,
      bestCategoryRating: 1400,
      categoriesAt1400: 1,
    });
    expect(one).toContain("rating_1400");
    expect(one).not.toContain("rating_1400_x3");

    const three = pickEarnedKeys({
      ...zeroStats,
      bestCategoryRating: 1520,
      categoriesAt1400: 3,
    });
    expect(three).toContain("rating_1400_x3");
  });

  it("performance flags map to their keys", () => {
    const keys = pickEarnedKeys({
      ...zeroStats,
      hasPerfectSession: true,
      hasPerfectNoHintSession: true,
      hasNoHintSession: true,
      hasD10Solve: true,
      hasSub10sSolve: true,
      hasComeback: true,
    });
    expect(keys).toContain("perfect_session");
    expect(keys).toContain("flawless_session");
    expect(keys).toContain("clean_session");
    expect(keys).toContain("d10_solve");
    expect(keys).toContain("sub_10s");
    expect(keys).toContain("comeback");
  });

  it("social keys need a friend and a challenge win", () => {
    const keys = pickEarnedKeys({
      ...zeroStats,
      acceptedFriends: 1,
      challengeWins: 1,
    });
    expect(keys).toEqual(["first_friend", "challenge_win"]);
  });

  it("returns keys in definition order", () => {
    const keys = pickEarnedKeys({
      ...zeroStats,
      completedSessions: 1,
      streakBest: 3,
      acceptedFriends: 2,
    });
    const order = ACHIEVEMENTS.map((a) => a.key);
    const sorted = [...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    expect(keys).toEqual(sorted);
  });
});
