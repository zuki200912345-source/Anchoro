import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPracticeSlots, selectDailySlots } from "@/lib/engine";
import { localDate } from "@/lib/streak";
import { CATEGORIES, PUZZLE_TYPES, type SessionSlot } from "@/lib/types";

// Defence in depth: challenge rows are service-role-written, but the seeds
// they carry drive grading, so re-check their shape before playing them.
const slotSchema = z.object({
  type: z.enum(PUZZLE_TYPES),
  category: z.enum(CATEGORIES),
  seed: z.string().min(1).max(64),
  difficulty: z.number().int().min(1).max(10),
});

function validateSlots(raw: unknown): SessionSlot[] {
  const parsed = z.array(slotSchema).length(5).safeParse(raw);
  if (!parsed.success) throw new Error("bad-slots");
  return parsed.data;
}

const bodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({
    type: z.literal("practice"),
    category: z.enum(CATEGORIES),
    difficulty: z.number().int().min(1).max(10),
  }),
  z.object({ type: z.literal("challenge"), code: z.string().min(4).max(12) }),
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad session request." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  const today = localDate(profile?.timezone ?? "UTC");

  if (parsed.data.type === "daily") {
    const { data: existing } = await admin
      .from("sessions")
      .select("id")
      .eq("user_id", user.id)
      .eq("type", "daily")
      .eq("date", today)
      .maybeSingle();
    if (existing) return NextResponse.json({ sessionId: existing.id });

    const slots = await selectDailySlots(admin, user.id);
    const { data: created, error } = await admin
      .from("sessions")
      .insert({
        user_id: user.id,
        type: "daily",
        date: today,
        puzzle_seeds: slots,
      })
      .select("id")
      .single();
    if (error || !created) {
      // Unique-index race: someone double-clicked Start. Return today's.
      const { data: raced } = await admin
        .from("sessions")
        .select("id")
        .eq("user_id", user.id)
        .eq("type", "daily")
        .eq("date", today)
        .maybeSingle();
      if (raced) return NextResponse.json({ sessionId: raced.id });
      return NextResponse.json(
        { error: "Could not start the session. Try again." },
        { status: 500 },
      );
    }
    return NextResponse.json({ sessionId: created.id });
  }

  if (parsed.data.type === "practice") {
    const slots = buildPracticeSlots(parsed.data.category, parsed.data.difficulty);
    const { data: created, error } = await admin
      .from("sessions")
      .insert({
        user_id: user.id,
        type: "practice",
        date: today,
        puzzle_seeds: slots,
      })
      .select("id")
      .single();
    if (error || !created) {
      return NextResponse.json(
        { error: "Could not start practice. Try again." },
        { status: 500 },
      );
    }
    return NextResponse.json({ sessionId: created.id });
  }

  // Challenge.
  const code = parsed.data.code.toUpperCase();
  const { data: challenge } = await admin
    .from("challenges")
    .select("id, puzzle_seeds, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!challenge) {
    return NextResponse.json(
      { error: "No challenge with that code." },
      { status: 404 },
    );
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "This challenge expired. Make a new one." },
      { status: 410 },
    );
  }
  const { data: played } = await admin
    .from("challenge_results")
    .select("id")
    .eq("challenge_id", challenge.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (played) {
    return NextResponse.json(
      { error: "You already played this challenge." },
      { status: 409 },
    );
  }
  // Resume an unfinished run instead of opening a second one.
  const { data: open } = await admin
    .from("sessions")
    .select("id")
    .eq("user_id", user.id)
    .eq("challenge_id", challenge.id)
    .eq("status", "in_progress")
    .maybeSingle();
  if (open) return NextResponse.json({ sessionId: open.id });

  let challengeSlots: SessionSlot[];
  try {
    challengeSlots = validateSlots(challenge.puzzle_seeds);
  } catch {
    return NextResponse.json(
      { error: "This challenge is malformed. Ask for a new link." },
      { status: 422 },
    );
  }

  const { data: created, error } = await admin
    .from("sessions")
    .insert({
      user_id: user.id,
      type: "challenge",
      date: today,
      puzzle_seeds: challengeSlots,
      challenge_id: challenge.id,
    })
    .select("id")
    .single();
  if (error || !created) {
    return NextResponse.json(
      { error: "Could not start the challenge. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ sessionId: created.id });
}
