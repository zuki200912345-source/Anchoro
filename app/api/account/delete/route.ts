import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// In-app account deletion (App Store guideline 5.1.1(v)). Immediate and
// permanent: deleting the auth user cascades through profiles and every
// user-owned table (all FKs are ON DELETE CASCADE). The only exception is the
// profiles.referred_by self-reference (NO ACTION), which is nulled first so a
// player who referred friends can still be deleted.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const admin = createAdminClient();

  const { error: unrefError } = await admin
    .from("profiles")
    .update({ referred_by: null } as never)
    .eq("referred_by", user.id);
  if (unrefError) {
    return NextResponse.json(
      { error: "Deletion failed. Try again, or contact support." },
      { status: 500 },
    );
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return NextResponse.json(
      { error: "Deletion failed. Try again, or contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
