"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function StartSessionButton({
  label,
  sessionId,
}: {
  label: string;
  sessionId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    if (sessionId) {
      router.push(`/session/${sessionId}`);
      return;
    }
    try {
      const r = await fetch("/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "daily" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not start the session.");
      router.push(`/session/${d.sessionId}`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Could not start the session. Try again.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={go} disabled={busy} className="self-start">
        {busy ? "Setting up" : label}
      </Button>
      {error && <p className="text-sm text-flag">{error}</p>}
    </div>
  );
}
