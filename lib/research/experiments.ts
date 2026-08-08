// Experimental framework (RESEARCH-SPEC.md §13, E1).
//
// Every claim Anchor makes is a hypothesis (H4), so the features that carry the
// claims ship behind arms and the assignment is sticky per user per experiment.
// Assignment is a deterministic hash of user + experiment name: the same user
// always lands in the same arm, with or without a database round trip, so a
// failed read can never silently reassign someone mid-study.

import {
  EXPERIMENTS,
  EXPERIMENT_DEFINITIONS,
  type Arm,
  type ExperimentName,
} from "./types";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Typed loosely on purpose: `lib/database.types.ts` was
 * hand-written before the research migration and does not know about
 * `experiment_assignments`.
 */
export type ExperimentAdminClient = SupabaseClient;

export const EXPERIMENT_NAMES = Object.keys(EXPERIMENTS) as ExperimentName[];

export function armsFor(experiment: ExperimentName): readonly Arm[] {
  return EXPERIMENTS[experiment] as readonly Arm[];
}

// ---------------------------------------------------------------------------
// Deterministic assignment
// ---------------------------------------------------------------------------

/** FNV-1a, 32-bit. Stable across runtimes and versions — the arm must not move. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * E1 — pure, deterministic arm assignment. Hashes `userId:experiment` so a
 * user's arm in one experiment says nothing about their arm in another.
 */
export function assignArm(userId: string, experiment: ExperimentName): Arm {
  const arms = armsFor(experiment);
  return arms[fnv1a(`${userId}:${experiment}`) % arms.length];
}

export function isTreatment(arm: Arm): arm is "treatment" {
  return arm === "treatment";
}

function isKnownArm(value: unknown, experiment: ExperimentName): value is Arm {
  return typeof value === "string" && (armsFor(experiment) as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Reads the stored arm, inserting the deterministic one the first time. Writes
 * go through the service role: `experiment_assignments` has no client write
 * path, so a student cannot pick their own arm.
 *
 * A read or write failure is not fatal — `assignArm` is the source of truth and
 * the row is only a record — so the caller still gets the right arm.
 */
export async function ensureAssignment(
  admin: ExperimentAdminClient,
  userId: string,
  experiment: ExperimentName,
): Promise<Arm> {
  const arm = assignArm(userId, experiment);

  const { data } = await admin
    .from("experiment_assignments")
    .select("arm")
    .eq("user_id", userId)
    .eq("experiment", experiment)
    .maybeSingle();

  const stored = (data as { arm?: unknown } | null)?.arm;
  if (isKnownArm(stored, experiment)) return stored;

  // ignoreDuplicates keeps a race between two concurrent sessions harmless:
  // both compute the same arm, the second insert is a no-op.
  await admin
    .from("experiment_assignments")
    .upsert(
      { user_id: userId, experiment, arm },
      { onConflict: "user_id,experiment", ignoreDuplicates: true },
    );

  return arm;
}

/** Every arm for a user, for the routes that need more than one. */
export async function ensureAllAssignments(
  admin: ExperimentAdminClient,
  userId: string,
): Promise<Record<ExperimentName, Arm>> {
  const entries = await Promise.all(
    EXPERIMENT_NAMES.map(
      async (name) => [name, await ensureAssignment(admin, userId, name)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<ExperimentName, Arm>;
}

// ---------------------------------------------------------------------------
// Metadata for the admin / debug view
// ---------------------------------------------------------------------------

export interface ExperimentMeta {
  name: ExperimentName;
  arms: readonly Arm[];
  question: string;
  control: string;
  treatment: string;
  primaryOutcome: string;
  /** §13 E7 / R5 — the model-switch probe runs last and is never marketed. */
  unmarketed: boolean;
}

export const EXPERIMENT_METADATA: ExperimentMeta[] = EXPERIMENT_NAMES.map((name) => ({
  name,
  arms: armsFor(name),
  ...EXPERIMENT_DEFINITIONS[name],
  unmarketed: name === "model_switch",
}));

export function experimentMeta(name: ExperimentName): ExperimentMeta {
  return EXPERIMENT_METADATA.find((e) => e.name === name) as ExperimentMeta;
}

/**
 * What an arm actually does, for the debug view. The three-arm gamification
 * study lists its arms in one string in the spec table, so they are split out
 * in order: arm_a, arm_b, arm_c.
 */
export function describeArm(name: ExperimentName, arm: Arm): string {
  const definition = EXPERIMENT_DEFINITIONS[name];
  if (arm === "control") return definition.control;
  if (arm === "treatment") return definition.treatment;

  const parts = definition.control
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const index = { arm_a: 0, arm_b: 1, arm_c: 2 }[arm];
  return parts[index] ?? arm;
}
