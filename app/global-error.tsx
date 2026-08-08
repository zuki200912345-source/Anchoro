"use client";

import "./globals.css";

// Last-resort boundary: replaces the root layout, so it renders its own
// html/body and stays dependency-free. Font variables from next/font are
// gone here; globals.css falls back to system faces.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <main className="flex min-h-dvh items-center justify-center px-4">
          <div className="plane w-full max-w-sm p-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight">
              Something broke on our side.
            </h1>
            <p className="mt-2 text-sm text-slate">
              Reload, and if it happens twice tell us.
            </p>
            <button
              onClick={reset}
              className="mt-5 inline-flex cursor-pointer items-center justify-center rounded-full border border-ink bg-ink px-6 py-3 text-sm font-semibold text-chalk hover:bg-ink/85"
            >
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
