"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Shared shape for every auth form action, consumed via useActionState.
export interface AuthActionState {
  error?: string;
  // Set when an email went out; the form swaps to the check-your-inbox screen.
  sent?: "confirm" | "reset";
  email?: string;
}

const emailSchema = z.email();

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

// Only allow same-origin relative paths as post-auth targets.
function safeNext(raw: string): string {
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/today";
}

export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ref = String(formData.get("ref") ?? "").trim();

  if (!emailSchema.safeParse(email).success) {
    return { error: "That doesn't look like an email address. Check it and try again." };
  }
  if (password.length < 8) {
    return { error: "Password needs at least 8 characters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback`,
      // The DB trigger reads `ref` from user metadata to credit the referrer.
      data: ref ? { ref } : undefined,
    },
  });

  if (error) {
    if (
      error.code === "user_already_exists" ||
      /already registered/i.test(error.message)
    ) {
      return { error: "This email already has an account. Sign in instead." };
    }
    return { error: error.message };
  }

  // With email confirmation on, Supabase obfuscates existing accounts by
  // returning a user with no identities. Route those people to sign in.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: "This email already has an account. Sign in instead." };
  }

  // Confirmation disabled: the session exists now, go straight to onboarding.
  if (data.session) redirect("/onboarding");

  return { sent: "confirm", email };
}

export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "That email and password don't match" };
  }

  redirect(safeNext(next));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth");
}

export async function requestResetAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!emailSchema.safeParse(email).success) {
    return { error: "That doesn't look like an email address. Check it and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent("/auth/reset")}`,
  });

  if (error) {
    return { error: "The reset email didn't send. Wait a minute and try again." };
  }

  return { sent: "reset", email };
}

export async function updatePasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Password needs at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "The two passwords don't match. Type them again." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?error=reset_expired");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "That password didn't save. Try a different one." };
  }

  redirect("/today");
}
