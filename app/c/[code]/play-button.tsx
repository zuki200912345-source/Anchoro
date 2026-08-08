"use client";

// Starts (or resumes) a challenge session for a signed-in viewer. The engine
// owns the rules: 409 if already played, 410 if expired; we surface its error.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function PlayChallengeButton({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const play = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "challenge", code }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not start the challenge.");
      router.push(`/session/${d.sessionId}`);
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof Error
          ? e.message
          : "Could not start the challenge. Try again.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={play} disabled={busy}>
        {busy ? "Setting up" : "Play this challenge"}
      </Button>
      {error && <p className="text-sm text-flag">{error}</p>}
    </div>
  );
}
