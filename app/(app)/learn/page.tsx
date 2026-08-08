// Feature B — the attempt-first screen. Everything the student needs is
// fetched by the client from /api/learn, because every one of those calls is
// gated server-side and none of them may be prefetched into the page: the
// verified key, the worked solution and the correctness decision all stay
// behind the routes (I3, I6).
//
// The page's only job is to pick the mode and say what the deal is before the
// first problem loads.

import { SESSION_MODES, type SessionMode } from "@/lib/research/types";
import { LearnClient } from "./learn-client";

export const metadata = { title: "Learn" };

function readMode(value: string | undefined): SessionMode {
  return SESSION_MODES.includes(value as SessionMode)
    ? (value as SessionMode)
    : "assisted";
}

export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; subject?: string; topic?: string }>;
}) {
  const sp = await searchParams;
  const mode = readMode(sp.mode);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Learn
        </h1>
        <p className="mt-1 text-sm text-slate">
          You attempt first. Hints open after that, one step at a time, and the
          worked solution only after real work. Nothing here answers on demand.
        </p>
      </header>

      <LearnClient mode={mode} subject={sp.subject} topic={sp.topic} />
    </div>
  );
}
