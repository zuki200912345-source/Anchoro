import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPracticeSlots } from "@/lib/engine";
import { CATEGORIES } from "@/lib/types";

// Challenge codes: unambiguous alphabet, no I, L, O, 0 or 1.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
    "",
  );
}

const bodySchema = z.object({
  category: z.enum(CATEGORIES),
  difficulty: z.number().int().min(1).max(10),
});

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
    return NextResponse.json(
      { error: "Pick a category and a difficulty from 1 to 10." },
      { status: 400 },
    );
  }

  const { category, difficulty } = parsed.data;
  const slots = buildPracticeSlots(category, difficulty);
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

  // Service role only: the seeds on a challenge row are handed to the
  // grader, so clients must never be able to author one. Slots are built
  // here from the validated category/difficulty, not taken from the body.
  // expires_at defaults to 7 days in the schema.
  const admin = createAdminClient();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const { error } = await admin.from("challenges").insert({
      code,
      creator_id: user.id,
      category,
      difficulty,
      puzzle_seeds: slots,
    });
    if (!error) {
      return NextResponse.json({ code, url: `${site}/c/${code}` });
    }
    if (error.code !== "23505") {
      return NextResponse.json(
        { error: "Could not create the challenge. Try again." },
        { status: 500 },
      );
    }
    // 23505 = unique violation on code; loop and mint a new one.
  }
  return NextResponse.json(
    { error: "Could not create the challenge. Try again." },
    { status: 500 },
  );
}
