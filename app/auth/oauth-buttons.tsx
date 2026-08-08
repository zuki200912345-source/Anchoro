"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Google and Apple sign-in. Both buttons follow the providers' brand rules
// exactly and are exempt from the app palette (see SPEC §3).

export function OAuthButtons({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "apple" | null>(null);
  const appleEnabled = process.env.NEXT_PUBLIC_APPLE_AUTH_ENABLED === "true";

  async function signInWith(provider: "google" | "apple") {
    setError(null);
    setBusy(provider);
    const supabase = createClient();
    const site = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const target =
      next && next.startsWith("/") && !next.startsWith("//")
        ? `?next=${encodeURIComponent(next)}`
        : "";
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${site}/auth/callback${target}` },
    });
    if (oauthError) {
      setBusy(null);
      setError(
        provider === "google"
          ? "Google sign-in didn't start. Try again."
          : "Apple sign-in didn't start. Try again.",
      );
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => signInWith("google")}
        disabled={busy !== null}
        className="flex h-11 w-full cursor-pointer items-center justify-center gap-3 rounded-(--radius-ctl) border border-ink bg-white px-4 text-sm font-semibold text-[#1f1f1f] hover:bg-[#f6f6f6] disabled:pointer-events-none disabled:opacity-60"
      >
        <svg
          aria-hidden
          width="18"
          height="18"
          viewBox="0 0 48 48"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
        Continue with Google
      </button>

      {appleEnabled && (
        <button
          type="button"
          onClick={() => signInWith("apple")}
          disabled={busy !== null}
          className="flex h-11 w-full cursor-pointer items-center justify-center gap-3 rounded-(--radius-ctl) border border-black bg-black px-4 text-sm font-semibold text-white hover:bg-black/85 disabled:pointer-events-none disabled:opacity-60"
        >
          <svg
            aria-hidden
            width="17"
            height="17"
            viewBox="0 0 16 16"
            fill="white"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.955-1.345.762-2.391.728-2.43Zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.692 3.692 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56.244.729.625 1.924 1.273 2.796.576.984 1.34 1.667 1.659 1.899.319.232 1.219.386 1.843.067.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758.347-.79.505-1.217.473-1.282Z" />
          </svg>
          Sign in with Apple
        </button>
      )}

      {error && <p className="text-sm text-flag">{error}</p>}
    </div>
  );
}
