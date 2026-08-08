import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/wordmark";
import { BlockMeter } from "@/components/ui/think-timer";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/today");

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <Wordmark />
        <Link
          href="/auth"
          className="rounded-(--radius-ctl) px-3 py-2 text-sm font-semibold underline decoration-slate underline-offset-4 hover:decoration-ink"
        >
          Sign in
        </Link>
      </header>

      <section className="flex flex-1 flex-col justify-center py-16">
        <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
          Five puzzles.
          <br />
          No help for 45 seconds.
        </h1>
        <p className="mt-6 max-w-md text-lg text-slate">
          You have outsourced enough thinking this week. Anchor gives you a
          short daily session you solve yourself, then shows you exactly where
          you cracked.
        </p>

        <div className="mt-10 flex items-center gap-4">
          <Link
            href="/auth?mode=signup"
            className="inline-flex items-center rounded-full border border-ink bg-ink px-7 py-3.5 font-semibold text-chalk hover:bg-ink/85"
          >
            Start training
          </Link>
          <div className="flex items-center gap-2 text-sm text-slate">
            <BlockMeter filled={11} label="timer, 11 of 16 blocks filled" />
            <span>the timer is watching</span>
          </div>
        </div>

        <ul className="mt-16 grid gap-3 text-sm sm:grid-cols-2">
          <li className="plane-sm px-4 py-3">
            Hints ask questions before they give answers. The answer never
            comes first.
          </li>
          <li className="plane-sm px-4 py-3">
            Four puzzle types, difficulty that tracks you puzzle by puzzle.
          </li>
          <li className="plane-sm px-4 py-3">
            A hint-independence score with equal billing to accuracy.
          </li>
          <li className="plane-sm px-4 py-3">
            Streaks, leaderboards, and challenges your classmates will lose.
          </li>
        </ul>
      </section>

      <footer className="pb-2 text-xs text-slate">
        Built for people who want their working memory back.
      </footer>
    </main>
  );
}
