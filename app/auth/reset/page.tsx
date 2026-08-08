import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/wordmark";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Set a new password" };

// Reached from the emailed recovery link via /auth/callback?next=/auth/reset.
// The callback already exchanged the code, so a valid link means a session.
export default async function ResetPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth?error=reset_expired");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-5 py-6">
      <header>
        <Wordmark />
      </header>
      <div className="flex flex-1 flex-col justify-center py-10">
        <ResetForm />
      </div>
    </main>
  );
}
