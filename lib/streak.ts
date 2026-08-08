// Streak arithmetic (§6): consecutive days with a completed daily session,
// computed in the user's timezone. One freeze earned every 7 days of streak,
// max 2 banked; a freeze is consumed automatically when exactly one day was
// missed. Pure functions so the rules are unit-testable without a database.

export interface StreakState {
  current: number;
  longest: number;
  freezes: number;
  lastSessionDate: string | null; // YYYY-MM-DD in the user's timezone
}

export interface StreakResult extends StreakState {
  extended: boolean; // this completion moved the streak forward
  frozeUsed: boolean;
}

export function localDate(timezone: string, at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(at);
  }
}

export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.UTC(
    Number(fromDate.slice(0, 4)),
    Number(fromDate.slice(5, 7)) - 1,
    Number(fromDate.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toDate.slice(0, 4)),
    Number(toDate.slice(5, 7)) - 1,
    Number(toDate.slice(8, 10)),
  );
  return Math.round((to - from) / 86_400_000);
}

export function advanceStreak(
  state: StreakState,
  todayLocalDate: string,
): StreakResult {
  const { longest, freezes, lastSessionDate } = state;
  let { current } = state;
  let extended = false;
  let frozeUsed = false;
  let newFreezes = freezes;

  if (lastSessionDate === null) {
    current = 1;
    extended = true;
  } else {
    const gap = daysBetween(lastSessionDate, todayLocalDate);
    if (gap <= 0) {
      // Same day (or clock skew): daily uniqueness means this shouldn't
      // happen twice, but never double-count.
      return { current, longest, freezes, lastSessionDate, extended: false, frozeUsed: false };
    }
    if (gap === 1) {
      current += 1;
      extended = true;
    } else if (gap === 2 && newFreezes > 0) {
      // Exactly one missed day and a freeze in the bank: it burns, streak lives.
      newFreezes -= 1;
      frozeUsed = true;
      current += 1;
      extended = true;
    } else {
      current = 1;
      extended = true;
    }
  }

  // Earn a freeze at every 7th consecutive day, bank capped at 2.
  if (extended && current > 0 && current % 7 === 0) {
    newFreezes = Math.min(2, newFreezes + 1);
  }

  return {
    current,
    longest: Math.max(longest, current),
    freezes: newFreezes,
    lastSessionDate: todayLocalDate,
    extended,
    frozeUsed,
  };
}
