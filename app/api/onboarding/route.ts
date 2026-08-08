import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CATEGORIES, type Category } from "@/lib/types";
import type { ProfileRow } from "@/lib/database.types";

// Completes onboarding: fills in the profile row the signup trigger created
// and seeds category ratings from the three calibration checks.

const bodySchema = z.object({
  display_name: z.string().trim().min(1).max(32),
  avatar_emoji: z.string().min(1).max(8).nullable(),
  school: z.string().trim().min(1).max(120).nullable(),
  year_group: z.enum([
    "Year 9",
    "Year 10",
    "Year 11",
    "Year 12",
    "Year 13",
    "Uni",
    "Other",
  ]),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(64),
  calibration: z.object({
    pattern: z.boolean(),
    mental_math: z.boolean(),
    memory: z.boolean(),
  }),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Your session has ended. Sign in again." },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request body wasn't valid JSON." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some fields didn't validate. Go back and check each step." },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const admin = createAdminClient();

  // Payload casts: the hand-written Database types collapse to `never` under
  // supabase-js's schema constraint, so writes are typed at the call site.
  const profilePatch: Partial<ProfileRow> = {
    display_name: body.display_name,
    avatar_emoji: body.avatar_emoji,
    school: body.school,
    year_group: body.year_group,
    reminder_time: body.reminder_time,
    timezone: body.timezone,
  };
  // Onboarding runs once (§3). Re-posting would otherwise reset earned
  // category ratings back to their calibration seeds.
  const { data: existing } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();
  if (existing?.display_name) {
    return NextResponse.json(
      { error: "You already finished onboarding. Edit this on your profile." },
      { status: 409 },
    );
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update(profilePatch as never)
    .eq("id", user.id);

  if (profileError) {
    return NextResponse.json(
      { error: "The profile didn't save. Try again." },
      { status: 500 },
    );
  }

  // Calibration seeds: 1100 where the check was right, 900 where it wasn't,
  // 1000 for the categories the checks don't cover.
  const calibrated: Partial<Record<Category, boolean>> = {
    pattern: body.calibration.pattern,
    mental_math: body.calibration.mental_math,
    memory: body.calibration.memory,
  };
  const rows = CATEGORIES.map((category) => {
    const result = calibrated[category];
    return {
      user_id: user.id,
      category,
      rating: result === undefined ? 1000 : result ? 1100 : 900,
    };
  });

  const { error: ratingError } = await admin
    .from("category_ratings")
    .upsert(rows as never[], { onConflict: "user_id,category" });

  if (ratingError) {
    return NextResponse.json(
      { error: "Starting ratings didn't save. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
