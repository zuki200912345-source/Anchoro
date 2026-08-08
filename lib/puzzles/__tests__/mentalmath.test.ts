import { describe, expect, it } from "vitest";
import { explain, generate, grade } from "../mentalmath";
import type { MentalMathAnswer, MentalMathData } from "@/lib/types";

type Format = MentalMathData["format"];
type DataOf<F extends Format> = Extract<MentalMathData, { format: F }>;
type AnswerOf<F extends Format> = Extract<MentalMathAnswer, { format: F }>;

function findSeed(format: Format, difficulty: number): string {
  for (let i = 0; i < 800; i++) {
    const seed = `mm-${format}-${difficulty}-${i}`;
    if (generate(seed, difficulty).data.format === format) return seed;
  }
  throw new Error(`no ${format} seed found at difficulty ${difficulty}`);
}

function instance<F extends Format>(format: F, difficulty: number) {
  const seed = findSeed(format, difficulty);
  const { data, solution } = generate(seed, difficulty);
  return { seed, data: data as DataOf<F>, solution: solution as AnswerOf<F> };
}

// Brute-force alternative solutions over two parenthesization shapes,
// integer intermediates only. Used to prove the grader accepts equivalent
// expressions it did not generate itself.
function searchExpressions(numbers: number[], target: number): string[] {
  const out: string[] = [];
  const ops = ["+", "-", "*", "/"] as const;
  const apply = (x: number, op: string, y: number): number | null => {
    if (op === "+") return x + y;
    if (op === "-") return x - y;
    if (op === "*") return x * y;
    return y !== 0 && x % y === 0 ? x / y : null;
  };
  const permutations = (nums: number[]): number[][] => {
    if (nums.length <= 1) return [nums];
    const res: number[][] = [];
    for (let i = 0; i < nums.length; i++) {
      const rest = [...nums.slice(0, i), ...nums.slice(i + 1)];
      for (const p of permutations(rest)) res.push([nums[i], ...p]);
    }
    return res;
  };
  for (const [a, b, c, e] of permutations(numbers)) {
    for (const o1 of ops) {
      const ab = apply(a, o1, b);
      if (ab === null) continue;
      for (const o2 of ops) {
        for (const o3 of ops) {
          const abc = apply(ab, o2, c);
          if (abc !== null && apply(abc, o3, e) === target) {
            out.push(`((${a} ${o1} ${b}) ${o2} ${c}) ${o3} ${e}`);
          }
          const de = apply(c, o3, e);
          if (de !== null && apply(ab, o2, de) === target) {
            out.push(`(${a} ${o1} ${b}) ${o2} (${c} ${o3} ${e})`);
          }
        }
      }
    }
  }
  return out;
}

describe("mentalmath determinism", () => {
  it("returns identical puzzles for the same seed and difficulty", () => {
    for (let d = 1; d <= 10; d++) {
      for (let i = 0; i < 5; i++) {
        const seed = `det-${i}`;
        expect(generate(seed, d)).toEqual(generate(seed, d));
      }
    }
  });

  it("scales the time limit from 45s down to 20s", () => {
    const limits = [1, 5, 10].map((d) => generate("det-0", d).data.timeLimitMs);
    expect(limits[0]).toBe(45000);
    expect(limits[2]).toBe(20000);
    expect(limits[1]).toBeLessThan(limits[0]);
    expect(limits[1]).toBeGreaterThan(limits[2]);
  });
});

describe("canonical solutions", () => {
  it("grade accepts the generated solution at difficulties 1, 5 and 10", () => {
    for (const d of [1, 5, 10]) {
      for (let i = 0; i < 25; i++) {
        const seed = `canon-${d}-${i}`;
        const { solution } = generate(seed, d);
        expect(grade(seed, d, solution), `seed ${seed} difficulty ${d}`).toBe(true);
      }
    }
  });

  it("grade never throws on junk answers", () => {
    for (const d of [1, 5, 10]) {
      for (const junk of [null, undefined, 42, "x", [], {}, { format: "target" }]) {
        expect(() => grade(`canon-${d}-0`, d, junk)).not.toThrow();
        expect(grade(`canon-${d}-0`, d, junk)).toBe(false);
      }
    }
  });
});

describe("target format", () => {
  const d = 8;
  const { seed, data, solution } = instance("target", d);

  it("provides four numbers from 1 to 13 and an integer target", () => {
    expect(data.numbers).toHaveLength(4);
    for (const n of data.numbers) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(13);
    }
    expect(Number.isInteger(data.target)).toBe(true);
    expect(data.target).toBeGreaterThanOrEqual(1);
  });

  it("accepts the canonical expression", () => {
    expect(grade(seed, d, solution)).toBe(true);
  });

  it("accepts equivalent expressions written differently", () => {
    const ascii = solution.expression.replaceAll("×", "*").replaceAll("÷", "/");
    expect(grade(seed, d, { format: "target", expression: ascii })).toBe(true);
    expect(grade(seed, d, { format: "target", expression: `(${ascii})` })).toBe(true);
    expect(
      grade(seed, d, { format: "target", expression: ascii.replaceAll(" ", "") }),
    ).toBe(true);
  });

  it("accepts solver-found expressions that hit the target", () => {
    const found = searchExpressions(data.numbers, data.target);
    expect(found.length).toBeGreaterThan(0);
    for (const expression of found.slice(0, 5)) {
      expect(grade(seed, d, { format: "target", expression }), expression).toBe(true);
    }
  });

  it("rejects expressions that misuse the numbers", () => {
    // right value, wrong multiset
    expect(grade(seed, d, { format: "target", expression: String(data.target) })).toBe(false);
    expect(
      grade(seed, d, { format: "target", expression: `${data.target} * 1` }),
    ).toBe(false);
    // a number reused: multiset of two can never equal the four given
    const [first] = data.numbers;
    expect(
      grade(seed, d, { format: "target", expression: `${first} + ${first}` }),
    ).toBe(false);
  });

  it("rejects malformed and malicious expressions without throwing", () => {
    const bad = [
      "1)(2",
      "alert(1)",
      "1e9**9",
      "",
      "   ",
      "1;2",
      "()",
      "1 + ",
      "+ 1",
      "((1+2)",
      "1..2",
      "0x10",
      "Math.max(1,2)",
      "1 ** 2",
      "--1",
      "1//2",
      "process.exit()",
      "${7}+${7}",
      "99999",
      "1(2)",
      `${data.numbers.join("+")})`,
    ];
    for (const expression of bad) {
      expect(() => grade(seed, d, { format: "target", expression })).not.toThrow();
      expect(grade(seed, d, { format: "target", expression }), expression).toBe(false);
    }
    expect(grade(seed, d, { format: "target", expression: 42 })).toBe(false);
    expect(grade(seed, d, { format: "target" })).toBe(false);
  });

  it("rejects division by zero without throwing", () => {
    const expression = `${data.numbers.join(" + ")} / 0`;
    expect(() => grade(seed, d, { format: "target", expression })).not.toThrow();
    expect(grade(seed, d, { format: "target", expression })).toBe(false);
  });
});

describe("missing_op format", () => {
  const d = 3;
  const { seed, data, solution } = instance("missing_op", d);

  it("has exactly one operator that fits", () => {
    const fits = (["+", "-", "×", "÷"] as const).filter((op) => {
      if (op === "+") return data.a + data.b === data.result;
      if (op === "-") return data.a - data.b === data.result;
      if (op === "×") return data.a * data.b === data.result;
      return data.b !== 0 && data.a === data.result * data.b;
    });
    expect(fits).toEqual([solution.op]);
  });

  it("accepts the right operator and its ascii spelling", () => {
    expect(grade(seed, d, solution)).toBe(true);
    const ascii =
      solution.op === "×" ? "*" : solution.op === "÷" ? "/" : solution.op;
    expect(grade(seed, d, { format: "missing_op", op: ascii })).toBe(true);
  });

  it("rejects every other operator and malformed input", () => {
    for (const op of ["+", "-", "×", "÷"] as const) {
      if (op !== solution.op) {
        expect(grade(seed, d, { format: "missing_op", op })).toBe(false);
      }
    }
    expect(grade(seed, d, { format: "missing_op", op: "%" })).toBe(false);
    expect(grade(seed, d, { format: "missing_op", op: 3 })).toBe(false);
    expect(grade(seed, d, {})).toBe(false);
  });
});

describe("larger format", () => {
  const d = 6;
  const { seed, data, solution } = instance("larger", d);

  const valueOf = (side: string): number => {
    const [a, b] = side.split("×").map((p) => parseInt(p.trim(), 10));
    return a * b;
  };

  it("keeps the two values within 15% and never equal", () => {
    const l = valueOf(data.left);
    const r = valueOf(data.right);
    expect(l).not.toBe(r);
    expect(Math.abs(l - r) / Math.max(l, r)).toBeLessThanOrEqual(0.15);
    expect(solution.choice).toBe(l > r ? 0 : 1);
  });

  it("grades the pick", () => {
    expect(grade(seed, d, solution)).toBe(true);
    expect(
      grade(seed, d, { format: "larger", choice: solution.choice === 0 ? 1 : 0 }),
    ).toBe(false);
    expect(grade(seed, d, { format: "larger", choice: "0" })).toBe(false);
    expect(grade(seed, d, { format: "larger" })).toBe(false);
  });
});

describe("backwards format", () => {
  const d = 5;
  const { seed, data, solution } = instance("backwards", d);

  it("has 2-4 steps and an all-integer chain from the start value", () => {
    expect(data.steps.length).toBeGreaterThanOrEqual(2);
    expect(data.steps.length).toBeLessThanOrEqual(4);
    expect(Number.isInteger(data.result)).toBe(true);
    let v = solution.value;
    for (const step of data.steps) {
      if (step === "double it") v *= 2;
      else if (step === "triple it") v *= 3;
      else if (step === "halve it") {
        expect(v % 2).toBe(0);
        v /= 2;
      } else {
        const m = step.match(/^(add|subtract) (\d+)$/);
        expect(m, step).not.toBeNull();
        v = m![1] === "add" ? v + Number(m![2]) : v - Number(m![2]);
      }
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(v).toBe(data.result);
  });

  it("grades the start value", () => {
    expect(grade(seed, d, solution)).toBe(true);
    expect(grade(seed, d, { format: "backwards", value: solution.value + 1 })).toBe(false);
    expect(grade(seed, d, { format: "backwards", value: String(solution.value) })).toBe(false);
    expect(grade(seed, d, { format: "backwards" })).toBe(false);
    expect(grade(seed, d, null)).toBe(false);
  });
});

describe("mentalmath explain", () => {
  it("shows the working for each format", () => {
    for (const format of ["target", "missing_op", "larger", "backwards"] as const) {
      const seed = findSeed(format, 5);
      const text = explain(seed, 5);
      expect(text.length).toBeGreaterThan(10);
      expect(text).toMatch(/\d/);
    }
  });

  it("target working walks through the steps to the target", () => {
    const { seed, data } = instance("target", 7);
    const text = explain(seed, 7);
    expect(text).toContain("=");
    expect(text).toContain(String(data.target));
  });
});
