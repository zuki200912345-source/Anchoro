import { describe, expect, it } from "vitest";
import * as independenceModule from "../independence";
import {
  DIMENSION_ORDER,
  MIN_SAMPLE,
  assistedUnaidedGap,
  buildProfile,
  trend,
  wilsonInterval,
  type DimensionKey,
  type IndependenceDailyRow,
} from "../independence";
import {
  CALIBRATION_TOLERANCE_PP,
  calibrationCurve,
  calibrationError,
  calibrationVerdict,
  type CalibrationPoint,
} from "../calibration";
import type { Dimension } from "../types";

function row(day: string, over: Partial<IndependenceDailyRow> = {}): IndependenceDailyRow {
  return {
    day,
    unaided_attempts: 0,
    unaided_correct: 0,
    delayed_retention_due: 0,
    delayed_retention_correct: 0,
    transfer_attempts: 0,
    transfer_correct: 0,
    total_attempts: 0,
    hints_requested: 0,
    solutions_revealed: 0,
    skipped: 0,
    median_think_ms: null,
    calibration_error: null,
    self_explanations: 0,
    assisted_correct: 0,
    assisted_attempts: 0,
    ...over,
  };
}

function pick(dimensions: Dimension[], key: DimensionKey): Dimension {
  const found = dimensions.find((d) => d.key === key);
  if (!found) throw new Error(`missing dimension ${key}`);
  return found;
}

// A single day carrying enough of everything to clear the sample floor.
const FULL_DAY = row("2026-08-05", {
  unaided_attempts: 20,
  unaided_correct: 12,
  total_attempts: 25,
  hints_requested: 5,
  skipped: 5,
  delayed_retention_due: 8,
  delayed_retention_correct: 6,
  transfer_attempts: 6,
  transfer_correct: 3,
  calibration_error: 30,
  assisted_attempts: 5,
  assisted_correct: 5,
});

// ---------------------------------------------------------------------------
// F3 — Wilson score interval
// ---------------------------------------------------------------------------

describe("wilsonInterval", () => {
  // Reference half-widths, derived from the published 95% Wilson bounds:
  // 5/10 → (0.2366, 0.7634); 0/10 → (0, 0.2775); 10/10 → (0.7225, 1);
  // 50/100 → (0.4038, 0.5962); 80/100 → (0.7111, 0.8666);
  // 1/5 → (0.0362, 0.6245); 8/10 → (0.4902, 0.9433).
  it.each([
    [5, 10, 26.3407],
    [0, 10, 13.8766],
    [10, 10, 13.8766],
    [50, 100, 9.6168],
    [80, 100, 7.7731],
    [1, 5, 29.4121],
    [8, 10, 22.6578],
    [12, 20, 19.7306],
  ])("matches the reference half-width for %i/%i", (k, n, expected) => {
    expect(wilsonInterval(k, n)).toBeCloseTo(expected, 3);
  });

  it("is symmetric in successes and failures", () => {
    expect(wilsonInterval(3, 17)).toBeCloseTo(wilsonInterval(14, 17), 10);
  });

  it("narrows as the sample grows at a fixed rate", () => {
    const widths = [10, 40, 160, 640].map((n) => wilsonInterval(n / 2, n));
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
    // Roughly halving for each 4x in the sample, give or take the correction
    // term the Wilson form carries at small n.
    expect(widths[3]).toBeGreaterThan(widths[0] / 10);
    expect(widths[3]).toBeLessThan(widths[0] / 6);
  });

  it("is widest at p = 0.5 for a fixed sample", () => {
    expect(wilsonInterval(50, 100)).toBeGreaterThan(wilsonInterval(20, 100));
    expect(wilsonInterval(50, 100)).toBeGreaterThan(wilsonInterval(90, 100));
  });

  it("reports total uncertainty rather than false precision with no data", () => {
    expect(wilsonInterval(0, 0)).toBe(50);
    expect(wilsonInterval(3, -1)).toBe(50);
  });

  it("clamps successes into the sample", () => {
    expect(wilsonInterval(99, 10)).toBeCloseTo(wilsonInterval(10, 10), 10);
    expect(wilsonInterval(-4, 10)).toBeCloseTo(wilsonInterval(0, 10), 10);
  });
});

// ---------------------------------------------------------------------------
// F1, F2, F5, F6 — the profile
// ---------------------------------------------------------------------------

describe("buildProfile", () => {
  it("returns the six dimensions from F2, in order", () => {
    const profile = buildProfile([FULL_DAY], 7);
    expect(profile.dimensions.map((d) => d.key)).toEqual([
      "unaided_accuracy",
      "hint_reliance",
      "persistence",
      "delayed_retention",
      "transfer",
      "calibration",
    ]);
    expect(DIMENSION_ORDER).toHaveLength(6);
  });

  it("computes every dimension from the counters", () => {
    const { dimensions } = buildProfile([FULL_DAY], 7);

    expect(pick(dimensions, "unaided_accuracy").value).toBe(60); // 12 / 20
    expect(pick(dimensions, "hint_reliance").value).toBe(20); //  5 / 25
    expect(pick(dimensions, "persistence").value).toBe(80); // 1 - 5 / 25
    expect(pick(dimensions, "delayed_retention").value).toBe(75); //  6 /  8
    expect(pick(dimensions, "transfer").value).toBe(50); //  3 /  6
    expect(pick(dimensions, "calibration").value).toBe(30); // mean error
  });

  it("carries the sample size and a matching Wilson interval", () => {
    const unaided = pick(buildProfile([FULL_DAY], 7).dimensions, "unaided_accuracy");
    expect(unaided.sample).toBe(20);
    expect(unaided.ci).toBeCloseTo(19.7, 5);
  });

  it("marks the dimensions where a lower number is better", () => {
    const { dimensions } = buildProfile([FULL_DAY], 7);
    const lower = dimensions.filter((d) => d.lowerIsBetter).map((d) => d.key);
    expect(lower).toEqual(["hint_reliance", "calibration"]);
  });

  it("weights the calibration mean by attempts and counts them as the sample", () => {
    const rows = [
      row("2026-08-04", { total_attempts: 10, calibration_error: 40 }),
      row("2026-08-05", { total_attempts: 30, calibration_error: 20 }),
    ];
    const calibration = pick(buildProfile(rows, 7).dimensions, "calibration");
    expect(calibration.value).toBe(25); // (40*10 + 20*30) / 40
    expect(calibration.sample).toBe(40);
  });

  it("ignores days with no confidence rating when computing calibration", () => {
    const rows = [
      row("2026-08-04", { total_attempts: 10, calibration_error: null }),
      row("2026-08-05", { total_attempts: 10, calibration_error: 12 }),
    ];
    const calibration = pick(buildProfile(rows, 7).dimensions, "calibration");
    expect(calibration.value).toBe(12);
    expect(calibration.sample).toBe(10);
  });

  it("only counts rows inside the requested window", () => {
    const rows = [
      row("2026-07-01", { unaided_attempts: 100, unaided_correct: 100 }),
      row("2026-08-05", { unaided_attempts: 10, unaided_correct: 5 }),
    ];
    const unaided = pick(buildProfile(rows, 7).dimensions, "unaided_accuracy");
    expect(unaided.value).toBe(50);
    expect(unaided.sample).toBe(10);
  });

  it("accepts rows in any order", () => {
    const rows = [
      row("2026-08-05", { unaided_attempts: 4, unaided_correct: 4 }),
      row("2026-08-01", { unaided_attempts: 6, unaided_correct: 2 }),
    ];
    const shuffled = [rows[1], rows[0]];
    expect(buildProfile(rows, 7)).toEqual(buildProfile(shuffled, 7));
  });

  it("reports the window it covered", () => {
    expect(buildProfile([FULL_DAY], 30).daysCovered).toBe(30);
    expect(buildProfile([FULL_DAY], 0).daysCovered).toBe(1);
  });

  it("handles no rows at all without inventing numbers", () => {
    const profile = buildProfile([], 7);
    expect(profile.dimensions).toHaveLength(6);
    for (const dimension of profile.dimensions) {
      expect(dimension.value).toBeNull();
      expect(dimension.ci).toBeNull();
      expect(dimension.trend).toBeNull();
      expect(dimension.sample).toBe(0);
    }
    expect(profile.assistedUnaidedGap).toBeNull();
    expect(profile.gapSample).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The sample floor — no number we cannot support
// ---------------------------------------------------------------------------

describe("the sample floor", () => {
  it("withholds every dimension below the minimum", () => {
    const thin = row("2026-08-05", {
      unaided_attempts: MIN_SAMPLE - 1,
      unaided_correct: MIN_SAMPLE - 1,
      total_attempts: MIN_SAMPLE - 1,
      hints_requested: 1,
      skipped: 1,
      delayed_retention_due: MIN_SAMPLE - 1,
      delayed_retention_correct: 1,
      transfer_attempts: MIN_SAMPLE - 1,
      transfer_correct: 1,
      calibration_error: 30,
    });
    for (const dimension of buildProfile([thin], 7).dimensions) {
      expect(dimension.value).toBeNull();
      expect(dimension.ci).toBeNull();
    }
  });

  it("reports a figure at exactly the minimum", () => {
    const atFloor = row("2026-08-05", {
      unaided_attempts: MIN_SAMPLE,
      unaided_correct: MIN_SAMPLE,
    });
    const unaided = pick(buildProfile([atFloor], 7).dimensions, "unaided_accuracy");
    expect(unaided.value).toBe(100);
    expect(unaided.ci).not.toBeNull();
    expect(unaided.sample).toBe(MIN_SAMPLE);
  });

  it("still reports the sample size when the value is withheld", () => {
    const thin = row("2026-08-05", { unaided_attempts: 3, unaided_correct: 3 });
    const unaided = pick(buildProfile([thin], 7).dimensions, "unaided_accuracy");
    expect(unaided.value).toBeNull();
    expect(unaided.sample).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// G1 — definitions alongside the facts
// ---------------------------------------------------------------------------

describe("definitions", () => {
  it("states what was counted for every dimension", () => {
    for (const dimension of buildProfile([FULL_DAY], 7).dimensions) {
      expect(dimension.definition.length).toBeGreaterThan(30);
      expect(dimension.definition).toMatch(/Counted/);
      expect(dimension.definition).toMatch(/last 7 days/);
    }
  });

  it("names the numerator and denominator that produced the figure", () => {
    const unaided = pick(buildProfile([FULL_DAY], 7).dimensions, "unaided_accuracy");
    expect(unaided.definition).toContain("Counted 12 of 20");
  });

  it("says why a figure is missing when the sample is too thin", () => {
    const thin = row("2026-08-05", { unaided_attempts: 3, unaided_correct: 2 });
    const unaided = pick(buildProfile([thin], 7).dimensions, "unaided_accuracy");
    expect(unaided.definition).toContain("Counted 2 of 3");
    expect(unaided.definition).toContain(`under the ${MIN_SAMPLE}-item floor`);
  });

  it("says nothing was counted when there is no data", () => {
    expect(pick(buildProfile([], 7).dimensions, "transfer").definition).toContain(
      "Nothing counted",
    );
  });

  it("never claims intelligence, IQ, or general ability (A8, G4)", () => {
    const text = buildProfile([FULL_DAY], 7)
      .dimensions.map((d) => `${d.label} ${d.definition}`)
      .join(" ");
    expect(text).not.toMatch(/\b(iq|intelligence|smart|clever|brain ?power|ability)\b/i);
  });
});

// ---------------------------------------------------------------------------
// M4 — assisted − unaided gap
// ---------------------------------------------------------------------------

describe("assistedUnaidedGap", () => {
  it("subtracts unaided accuracy from assisted accuracy", () => {
    const rows = [
      row("2026-08-05", {
        assisted_attempts: 10,
        assisted_correct: 9,
        unaided_attempts: 10,
        unaided_correct: 5,
      }),
    ];
    expect(assistedUnaidedGap(rows)).toBe(40);
  });

  it("goes negative when unaided work is the stronger of the two", () => {
    const rows = [
      row("2026-08-05", {
        assisted_attempts: 8,
        assisted_correct: 4,
        unaided_attempts: 8,
        unaided_correct: 6,
      }),
    ];
    expect(assistedUnaidedGap(rows)).toBe(-25);
  });

  it("sums across days before dividing", () => {
    const rows = [
      row("2026-08-04", { assisted_attempts: 5, assisted_correct: 5, unaided_attempts: 5, unaided_correct: 0 }),
      row("2026-08-05", { assisted_attempts: 5, assisted_correct: 0, unaided_attempts: 5, unaided_correct: 5 }),
    ];
    expect(assistedUnaidedGap(rows)).toBe(0);
  });

  it("returns null until both arms clear the sample floor", () => {
    const thinUnaided = [
      row("2026-08-05", {
        assisted_attempts: 40,
        assisted_correct: 40,
        unaided_attempts: MIN_SAMPLE - 1,
        unaided_correct: 0,
      }),
    ];
    expect(assistedUnaidedGap(thinUnaided)).toBeNull();

    const thinAssisted = [
      row("2026-08-05", {
        assisted_attempts: MIN_SAMPLE - 1,
        assisted_correct: 4,
        unaided_attempts: 40,
        unaided_correct: 10,
      }),
    ];
    expect(assistedUnaidedGap(thinAssisted)).toBeNull();
  });

  it("reports the smaller arm as the sample, since that is what limits it", () => {
    const profile = buildProfile(
      [
        row("2026-08-05", {
          assisted_attempts: 40,
          assisted_correct: 40,
          unaided_attempts: 6,
          unaided_correct: 3,
        }),
      ],
      7,
    );
    expect(profile.assistedUnaidedGap).toBe(50);
    expect(profile.gapSample).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// G1 — trend against the previous equivalent window
// ---------------------------------------------------------------------------

describe("trend", () => {
  const rows = [
    // Previous week: 10 hints across 50 attempts → 20%.
    row("2026-07-25", { total_attempts: 50, hints_requested: 10 }),
    // This week: 3 hints across 50 attempts → 6%.
    row("2026-08-05", { total_attempts: 50, hints_requested: 3 }),
  ];

  it("reports the change in percentage points", () => {
    expect(trend(rows, "hint_reliance", 7)).toBe(-14);
  });

  it("splits the covered span in half when no window is given", () => {
    expect(trend(rows, "hint_reliance")).toBe(-14);
  });

  it("returns null when either window is under the sample floor", () => {
    const thin = [
      row("2026-07-25", { total_attempts: 2, hints_requested: 1 }),
      row("2026-08-05", { total_attempts: 50, hints_requested: 3 }),
    ];
    expect(trend(thin, "hint_reliance", 7)).toBeNull();
  });

  it("returns null with no previous window to compare against", () => {
    expect(trend([rows[1]], "hint_reliance", 7)).toBeNull();
    expect(trend([], "unaided_accuracy")).toBeNull();
  });

  it("is the same figure the profile attaches to the dimension", () => {
    const profile = buildProfile(rows, 7);
    expect(pick(profile.dimensions, "hint_reliance").trend).toBe(-14);
  });

  it("is positive when the figure went up, whichever direction is good", () => {
    const improving = [
      row("2026-07-25", { unaided_attempts: 20, unaided_correct: 8 }),
      row("2026-08-05", { unaided_attempts: 20, unaided_correct: 14 }),
    ];
    expect(trend(improving, "unaided_accuracy", 7)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// R1 — no composite score, ever
// ---------------------------------------------------------------------------

describe("R1: there is no composite score", () => {
  it("exports nothing that collapses the dimensions into one number", () => {
    for (const name of Object.keys(independenceModule)) {
      expect(name).not.toMatch(/score|composite|overall|ranking|aggregate|average/i);
    }
  });

  it("returns only dimensions, a gap, and the window", () => {
    expect(Object.keys(buildProfile([FULL_DAY], 7)).sort()).toEqual([
      "assistedUnaidedGap",
      "daysCovered",
      "dimensions",
      "gapSample",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Feature H — calibration
// ---------------------------------------------------------------------------

describe("calibrationError", () => {
  it("scores a set that is sure and right at zero", () => {
    const points: CalibrationPoint[] = [
      { confidence: 100, correct: true },
      { confidence: 100, correct: true },
      { confidence: 0, correct: false },
      { confidence: 0, correct: false },
    ];
    expect(calibrationError(points)).toBe(0);
  });

  it("scores a set that is sure and wrong at 100", () => {
    expect(
      calibrationError([
        { confidence: 100, correct: false },
        { confidence: 0, correct: true },
      ]),
    ).toBe(100);
  });

  it("averages the absolute distances", () => {
    // |80-100| + |60-0| + |50-100| = 20 + 60 + 50 = 130 over 3.
    expect(
      calibrationError([
        { confidence: 80, correct: true },
        { confidence: 60, correct: false },
        { confidence: 50, correct: true },
      ]),
    ).toBeCloseTo(43.3, 1);
  });

  it("clamps ratings outside 0–100", () => {
    expect(calibrationError([{ confidence: 140, correct: true }])).toBe(0);
    expect(calibrationError([{ confidence: -20, correct: false }])).toBe(0);
  });

  it("returns null when nothing was rated", () => {
    expect(calibrationError([])).toBeNull();
  });
});

describe("calibrationCurve", () => {
  it("buckets by stated confidence and reports what happened in each", () => {
    const points: CalibrationPoint[] = [
      { confidence: 10, correct: false },
      { confidence: 10, correct: false },
      { confidence: 90, correct: true },
      { confidence: 90, correct: true },
      { confidence: 90, correct: false },
    ];
    const curve = calibrationCurve(points, 5);
    expect(curve).toHaveLength(2);

    expect(curve[0]).toMatchObject({
      bin: 0,
      rangeLabel: "0–19%",
      meanConfidence: 10,
      actualAccuracy: 0,
      n: 2,
      classification: "calibrated",
    });

    expect(curve[1]).toMatchObject({
      bin: 4,
      rangeLabel: "80–100%",
      meanConfidence: 90,
      n: 3,
    });
    expect(curve[1].actualAccuracy).toBeCloseTo(66.7, 1);
    expect(curve[1].classification).toBe("overconfident");
  });

  it("puts a rating of 100 in the top bucket", () => {
    const curve = calibrationCurve([{ confidence: 100, correct: true }], 5);
    expect(curve).toHaveLength(1);
    expect(curve[0].bin).toBe(4);
  });

  it("skips empty buckets but keeps the bucket index", () => {
    const curve = calibrationCurve([{ confidence: 45, correct: true }], 4);
    expect(curve).toHaveLength(1);
    expect(curve[0].bin).toBe(1);
    expect(curve[0].rangeLabel).toBe("25–49%");
  });

  it("classifies under-confidence too", () => {
    const curve = calibrationCurve(
      [
        { confidence: 30, correct: true },
        { confidence: 30, correct: true },
        { confidence: 30, correct: true },
      ],
      5,
    );
    expect(curve[0].gap).toBe(-70);
    expect(curve[0].classification).toBe("underconfident");
  });

  it("treats a gap at the tolerance as calibrated", () => {
    const curve = calibrationCurve(
      [
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 90, correct: false },
        { confidence: 90, correct: false },
      ],
      5,
    );
    expect(curve[0].gap).toBe(CALIBRATION_TOLERANCE_PP);
    expect(curve[0].classification).toBe("calibrated");
  });

  it("handles no ratings", () => {
    expect(calibrationCurve([], 5)).toEqual([]);
  });
});

describe("calibrationVerdict", () => {
  const overconfident = calibrationCurve(
    [
      { confidence: 95, correct: true },
      { confidence: 95, correct: false },
      { confidence: 95, correct: false },
      { confidence: 95, correct: false },
    ],
    5,
  );

  it("names the band and gives something to do about it", () => {
    const verdict = calibrationVerdict(overconfident);
    expect(verdict).toContain("80–100%");
    expect(verdict).toContain("Re-check one step");
  });

  it("names the item type when one is supplied", () => {
    expect(calibrationVerdict(overconfident, "transfer")).toContain("on transfer items");
  });

  it("stays on the task rather than the student (H6)", () => {
    const verdicts = [
      calibrationVerdict(overconfident),
      calibrationVerdict(overconfident, "transfer"),
      calibrationVerdict([]),
    ];
    for (const verdict of verdicts) {
      expect(verdict).not.toMatch(/\b(lazy|careless|bad at|weak|failing|stupid|smart)\b/i);
      expect(verdict.length).toBeLessThan(200);
    }
  });

  it("says so plainly when the ratings line up", () => {
    const good = calibrationCurve(
      [
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 90, correct: true },
        { confidence: 10, correct: false },
        { confidence: 10, correct: false },
        { confidence: 10, correct: false },
      ],
      5,
    );
    expect(calibrationVerdict(good)).toContain("match your results");
  });

  it("asks for more ratings rather than reading a thin bucket", () => {
    const thin = calibrationCurve([{ confidence: 90, correct: false }], 5);
    expect(calibrationVerdict(thin)).toContain("Not enough confidence ratings yet");
  });
});
