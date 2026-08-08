import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="plane w-full max-w-sm p-6 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          This page doesn&apos;t exist.
        </h1>
        <p className="mt-2 text-sm text-slate">
          The puzzles are at <span className="font-data">/today</span>.
        </p>
        <Link
          href="/today"
          className="mt-5 inline-flex items-center justify-center rounded-full border border-ink bg-ink px-6 py-3 text-sm font-semibold text-chalk transition-colors hover:bg-ink/85"
        >
          Go to /today
        </Link>
      </div>
    </main>
  );
}
