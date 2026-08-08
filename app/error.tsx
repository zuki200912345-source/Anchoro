"use client";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="plane w-full max-w-sm p-6 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Something broke on our side.
        </h1>
        <p className="mt-2 text-sm text-slate">
          Reload, and if it happens twice tell us.
        </p>
        <Button className="mt-5" onClick={reset}>
          Reload
        </Button>
      </div>
    </main>
  );
}
