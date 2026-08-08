import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/wordmark";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = { title: "Sign in" };

// Callback and reset flows land here with short error codes, never raw text.
const ERROR_MESSAGES: Record<string, string> = {
  callback: "Sign-in didn't finish. Try again.",
  reset_expired: "That reset link has expired. Request a new one from the sign-in form.",
};

const NOTICES: Record<string, string> = {
  deleted: "Your account and all its data have been deleted.",
};

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/today");

  const params = await searchParams;
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : (v ?? "");

  const mode = first(params.mode) === "signup" ? "signup" : "signin";
  const next = first(params.next);
  const refCode = first(params.ref);
  const errorCode = first(params.error);
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.callback) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-5 py-6">
      <header>
        <Link
          href="/"
          className="inline-block rounded-(--radius-ctl)"
          aria-label="Anchor home"
        >
          <Wordmark />
        </Link>
      </header>

      <div className="flex flex-1 flex-col justify-center py-10">
        <AuthForm
          initialMode={mode}
          next={next}
          refCode={refCode}
          errorMessage={errorMessage}
        />
        <p className="mt-4 text-center text-xs text-slate">
          Five puzzles a day. The first 45 seconds are yours alone.
        </p>
        {NOTICES[first(params.deleted) ? "deleted" : ""] ? (
          <p className="mt-2 text-center text-xs" role="status">
            {NOTICES.deleted}
          </p>
        ) : null}
      </div>

      <footer className="flex justify-center gap-4 pb-2 text-xs text-slate">
        <Link className="underline" href="/privacy">
          Privacy
        </Link>
        <Link className="underline" href="/terms">
          Terms
        </Link>
        <Link className="underline" href="/support">
          Support
        </Link>
      </footer>
    </main>
  );
}
