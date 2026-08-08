import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_METADATA,
  EXPERIMENT_NAMES,
  armsFor,
  assignArm,
  describeArm,
  ensureAssignment,
  experimentMeta,
  isTreatment,
  type ExperimentAdminClient,
} from "../experiments";
import { EXPERIMENTS, type Arm, type ExperimentName } from "../types";

const users = Array.from({ length: 400 }, (_, i) => `user-${i}-9f3a`);

describe("assignArm — deterministic and sticky (E1)", () => {
  it("returns the same arm every call", () => {
    for (const name of EXPERIMENT_NAMES) {
      for (const user of users.slice(0, 50)) {
        const first = assignArm(user, name);
        for (let i = 0; i < 5; i++) expect(assignArm(user, name)).toBe(first);
      }
    }
  });

  it("only ever returns an arm the experiment declares", () => {
    for (const name of EXPERIMENT_NAMES) {
      const arms = armsFor(name) as readonly string[];
      for (const user of users) expect(arms).toContain(assignArm(user, name));
    }
  });

  it("fills every arm of every experiment across a population", () => {
    for (const name of EXPERIMENT_NAMES) {
      const seen = new Set(users.map((u) => assignArm(u, name)));
      expect(seen.size, name).toBe(armsFor(name).length);
    }
  });

  it("splits roughly evenly, so an arm is not starved", () => {
    for (const name of EXPERIMENT_NAMES) {
      const arms = armsFor(name);
      const counts = new Map<Arm, number>();
      for (const u of users) counts.set(assignArm(u, name), (counts.get(assignArm(u, name)) ?? 0) + 1);
      for (const arm of arms) {
        const share = (counts.get(arm) ?? 0) / users.length;
        expect(share, `${name}/${arm}`).toBeGreaterThan(0.5 / arms.length);
      }
    }
  });

  it("assigns each experiment independently", () => {
    const sameEverywhere = users.filter((u) => {
      const first = assignArm(u, "attempt_first");
      return (["tutor_style", "feedback_style", "fading"] as ExperimentName[]).every(
        (n) => assignArm(u, n) === first,
      );
    });
    expect(sameEverywhere.length).toBeLessThan(users.length / 2);
  });

  it("is not thrown by unusual user ids", () => {
    for (const id of ["", "  ", "🙂", "a".repeat(500)]) {
      expect(armsFor("fading") as readonly string[]).toContain(assignArm(id, "fading"));
    }
  });
});

describe("isTreatment", () => {
  it("is true only for the treatment arm", () => {
    expect(isTreatment("treatment")).toBe(true);
    expect(isTreatment("control")).toBe(false);
    expect(isTreatment("arm_a")).toBe(false);
    expect(isTreatment("arm_b")).toBe(false);
    expect(isTreatment("arm_c")).toBe(false);
  });
});

describe("metadata for the admin view", () => {
  it("covers every experiment in the contract", () => {
    expect(EXPERIMENT_METADATA.map((e) => e.name).sort()).toEqual(
      Object.keys(EXPERIMENTS).sort(),
    );
  });

  it("marks the model-switch probe unmarketed (R5, E7)", () => {
    expect(experimentMeta("model_switch").unmarketed).toBe(true);
    expect(EXPERIMENT_METADATA.filter((e) => e.unmarketed)).toHaveLength(1);
  });

  it("carries a question and a primary outcome for each experiment", () => {
    for (const meta of EXPERIMENT_METADATA) {
      expect(meta.question.length).toBeGreaterThan(10);
      expect(meta.primaryOutcome.length).toBeGreaterThan(3);
      expect(meta.arms.length).toBeGreaterThan(1);
    }
  });

  it("describes each arm of the three-arm gamification study separately", () => {
    const described = (["arm_a", "arm_b", "arm_c"] as Arm[]).map((a) =>
      describeArm("gamification", a),
    );
    expect(described).toEqual(["independence XP", "completion XP", "no XP"]);
  });

  it("describes control and treatment from the definitions", () => {
    expect(describeArm("fading", "control")).toBe("Fixed support level");
    expect(describeArm("fading", "treatment")).toBe("Adaptive fading");
  });
});

// A stand-in for the service-role client: enough of the chain to exercise the
// read-then-insert path without a database.
function fakeAdmin(existingArm: string | null) {
  const upserts: unknown[] = [];
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: existingArm === null ? null : { arm: existingArm },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
        upsert(values: unknown) {
          upserts.push(values);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { admin: client as unknown as ExperimentAdminClient, upserts };
}

describe("ensureAssignment", () => {
  it("keeps a stored arm even when it differs from the hash", async () => {
    const stored: Arm = assignArm("u1", "fading") === "control" ? "treatment" : "control";
    const { admin, upserts } = fakeAdmin(stored);
    expect(await ensureAssignment(admin, "u1", "fading")).toBe(stored);
    expect(upserts).toHaveLength(0);
  });

  it("inserts the deterministic arm the first time", async () => {
    const { admin, upserts } = fakeAdmin(null);
    const arm = await ensureAssignment(admin, "u2", "attempt_first");
    expect(arm).toBe(assignArm("u2", "attempt_first"));
    expect(upserts).toEqual([
      { user_id: "u2", experiment: "attempt_first", arm },
    ]);
  });

  it("ignores a stored value that is not an arm of this experiment", async () => {
    const { admin } = fakeAdmin("arm_z");
    expect(await ensureAssignment(admin, "u3", "tutor_style")).toBe(
      assignArm("u3", "tutor_style"),
    );
  });
});
