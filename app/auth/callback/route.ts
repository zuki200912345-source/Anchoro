import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth and email-link landing point. Exchanges the code for a session, then
// routes: password recovery → /auth/reset, first sign-in (no display name yet)
// → /onboarding, otherwise the requested target or /today.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "";

  if (!code) {
    return NextResponse.redirect(`${origin}/auth?error=callback`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/auth?error=callback`);
  }

  // Recovery links must reach the set-new-password screen even for accounts
  // that never finished onboarding.
  if (next === "/auth/reset" || next.startsWith("/auth/reset?")) {
    return NextResponse.redirect(`${origin}/auth/reset`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/auth?error=callback`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string | null }>();

  if (!profile?.display_name) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  return NextResponse.redirect(`${origin}${next || "/today"}`);
}
