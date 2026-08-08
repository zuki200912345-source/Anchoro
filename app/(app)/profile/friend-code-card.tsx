"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export interface FriendCodeCardProps {
  code: string;
  shareUrl: string;
}

export function FriendCodeCard({ code, shareUrl }: FriendCodeCardProps) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy(kind: "code" | "link", text: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(
        "Copying didn't work in this browser. Select the text and copy it yourself.",
      );
    }
  }

  return (
    <section className="plane p-5" aria-label="Friend code">
      <h2 className="text-sm font-semibold text-slate">Your friend code</h2>
      <p className="mt-1 select-all font-data text-4xl font-bold tracking-[0.25em] sm:text-5xl">
        {code}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          onClick={() => copy("code", code)}
        >
          {copied === "code" ? "Copied" : "Copy code"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          onClick={() => copy("link", shareUrl)}
        >
          {copied === "link" ? "Copied" : "Copy signup link"}
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </p>

      <p className="mt-3 text-sm text-slate">
        Anyone who signs up through your link earns you 50 xp.
      </p>

      {error && (
        <p className="mt-2 text-sm text-flag" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
