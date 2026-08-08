// The Anchor wordmark: four blocks and the name. Used in the nav, auth page,
// and share cards. Keep it quiet; the mark is the block motif, not a logo.

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span aria-hidden className="grid grid-cols-2 gap-0.5">
        <span className="size-2 rounded-[1px] bg-ink" />
        <span className="size-2 rounded-[1px] bg-flag" />
        <span className="size-2 rounded-[1px] bg-ink" />
        <span className="size-2 rounded-[1px] bg-ink" />
      </span>
      <span className="font-display text-xl font-extrabold tracking-tight">
        anchor
      </span>
    </span>
  );
}
