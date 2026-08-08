import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateHint } from "@/lib/ai";
import type { SessionSlot } from "@/lib/types";

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  seed: z.string().min(1).max(64),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  attempt: z.unknown().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to get hints." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad hint request." }, { status: 400 });
  }
  const { sessionId, seed, tier, attempt } = parsed.data;

  // Scope to the session the puzzle actually came from: a user can have a
  // daily and a practice session open at once, so "newest in progress" is
  // not good enough.
  const { data: session } = await supabase
    .from("sessions")
    .select("id, puzzle_seeds, hint_log")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .eq("status", "in_progress")
    .maybeSingle();

  const slots = (session?.puzzle_seeds ?? []) as SessionSlot[];
  const slot = Array.isArray(slots) ? slots.find((s) => s?.seed === seed) : undefined;
  if (!session || !slot) {
    return NextResponse.json(
      { error: "That puzzle is not in your current session." },
      { status: 403 },
    );
  }

  // Already answered? No hints for a graded slot.
  const { data: answered } = await supabase
    .from("attempts")
    .select("id")
    .eq("session_id", session.id)
    .eq("seed", seed)
    .maybeSingle();
  if (answered) {
    return NextResponse.json(
      { error: "That one is already answered." },
      { status: 409 },
    );
  }

  // Tiers go strictly in order: 1, then 2, then 3.
  const log = (session.hint_log ?? {}) as Record<string, number[]>;
  const already = log[seed] ?? [];
  const highest = already.length ? Math.max(...already) : 0;
  if (tier > highest + 1) {
    return NextResponse.json(
      { error: `Tier ${highest + 1} comes first.` },
      { status: 400 },
    );
  }

  // Record the served tier atomically before generating: the scoring route
  // reads this log, never anything the client claims.
  const admin = createAdminClient();
  if (!already.includes(tier)) {
    const { error } = await admin.rpc("record_hint", {
      p_session: session.id,
      p_user: user.id,
      p_seed: seed,
      p_tier: tier,
    });
    if (error) {
      return NextResponse.json(
        { error: "Could not log that hint. Try again." },
        { status: 500 },
      );
    }
  }

  // Type and difficulty come from the stored slot, never from the client:
  // otherwise a caller could request an easier puzzle's hint text or poison
  // the shared hint cache.
  const hint = await generateHint({
    type: slot.type,
    seed,
    difficulty: slot.difficulty,
    tier,
    attempt,
  });

  return NextResponse.json({ hint });
}
