import { describe, expect, it } from "vitest";
import { advanceStreak, daysBetween, localDate } from "../streak";

const base = { current: 0, longest: 0, freezes: 0, lastSessionDate: null };

describe("advanceStreak", () => {
  it("starts a streak on the first ever session", () => {
    const r = advanceStreak(base, "2026-08-04");
    expect(r.current).toBe(1);
    expect(r.longest).toBe(1);
    expect(r.extended).toBe(true);
  });

  it("increments across a day boundary", () => {
    const r = advanceStreak(
      { current: 3, longest: 5, freezes: 0, lastSessionDate: "2026-08-03" },
      "2026-08-04",
    );
    expect(r.current).toBe(4);
    expect(r.longest).toBe(5);
    expect(r.extended).toBe(true);
    expect(r.frozeUsed).toBe(false);
  });

  it("increments across a month boundary", () => {
    const r = advanceStreak(
      { current: 9, longest: 9, freezes: 0, lastSessionDate: "2026-07-31" },
      "2026-08-01",
    );
    expect(r.current).toBe(10);
    expect(r.longest).toBe(10);
  });

  it("consumes a freeze on exactly one missed day", () => {
    const r = advanceStreak(
      { current: 10, longest: 10, freezes: 2, lastSessionDate: "2026-08-01" },
      "2026-08-03",
    );
    expect(r.current).toBe(11);
    expect(r.freezes).toBe(1);
    expect(r.frozeUsed).toBe(true);
  });

  it("resets on one missed day with no freeze banked", () => {
    const r = advanceStreak(
      { current: 10, longest: 10, freezes: 0, lastSessionDate: "2026-08-01" },
      "2026-08-03",
    );
    expect(r.current).toBe(1);
    expect(r.longest).toBe(10);
    expect(r.frozeUsed).toBe(false);
  });

  it("resets on a two-day gap even with freezes banked", () => {
    const r = advanceStreak(
      { current: 10, longest: 10, freezes: 2, lastSessionDate: "2026-08-01" },
      "2026-08-04",
    );
    expect(r.current).toBe(1);
    expect(r.freezes).toBe(2);
    expect(r.frozeUsed).toBe(false);
  });

  it("does not double-count the same local day", () => {
    const r = advanceStreak(
      { current: 4, longest: 4, freezes: 1, lastSessionDate: "2026-08-04" },
      "2026-08-04",
    );
    expect(r.current).toBe(4);
    expect(r.extended).toBe(false);
  });

  it("earns a freeze every 7 days, capped at 2", () => {
    const day7 = advanceStreak(
      { current: 6, longest: 6, freezes: 0, lastSessionDate: "2026-08-03" },
      "2026-08-04",
    );
    expect(day7.current).toBe(7);
    expect(day7.freezes).toBe(1);

    const day14capped = advanceStreak(
      { current: 13, longest: 13, freezes: 2, lastSessionDate: "2026-08-03" },
      "2026-08-04",
    );
    expect(day14capped.current).toBe(14);
    expect(day14capped.freezes).toBe(2);
  });

  it("freeze consumption and earning can happen on the same day", () => {
    // Day 13 → missed one → freeze burns → day 14 earns one back.
    const r = advanceStreak(
      { current: 13, longest: 13, freezes: 1, lastSessionDate: "2026-08-01" },
      "2026-08-03",
    );
    expect(r.current).toBe(14);
    expect(r.frozeUsed).toBe(true);
    expect(r.freezes).toBe(1); // burned one, earned one
  });
});

describe("date helpers", () => {
  it("daysBetween counts calendar days", () => {
    expect(daysBetween("2026-08-01", "2026-08-04")).toBe(3);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-08-04", "2026-08-04")).toBe(0);
  });

  it("localDate formats YYYY-MM-DD in a timezone and survives junk input", () => {
    const at = new Date("2026-08-04T23:30:00Z");
    expect(localDate("UTC", at)).toBe("2026-08-04");
    expect(localDate("Pacific/Auckland", at)).toBe("2026-08-05");
    expect(localDate("not-a-zone", at)).toBe("2026-08-04");
  });
});
