// Calendar heatmap of the last 90 days: 13 week columns x 7 day rows,
// intensity as a single-hue flag ramp. Server-safe (no client hooks).

export function CalendarHeatmap({
  counts,
}: {
  counts: Record<string, number>; // YYYY-MM-DD -> puzzles completed
}) {
  // Build the day grid ending today, aligned so columns are whole weeks.
  const today = new Date();
  const days: { date: string; count: number }[] = [];
  for (let i = 90; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, count: counts[iso] ?? 0 });
  }
  // Pad the start so the first column begins on Monday.
  const firstDow = (new Date(days[0].date).getDay() + 6) % 7; // Mon=0
  const cells: ({ date: string; count: number } | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...days,
  ];
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const tint = (count: number) =>
    count === 0
      ? "var(--chalk)"
      : count <= 2
        ? "color-mix(in srgb, var(--flag) 25%, var(--chalk))"
        : count <= 5
          ? "color-mix(in srgb, var(--flag) 55%, var(--chalk))"
          : "var(--flag)";

  return (
    <div className="overflow-x-auto">
      <div
        role="img"
        aria-label="puzzles completed per day, last 90 days"
        className="flex w-max gap-1"
      >
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-1">
            {week.map((cell, d) =>
              cell === null ? (
                <span key={d} className="size-3" />
              ) : (
                <span
                  key={d}
                  title={`${cell.date}: ${cell.count} puzzle${cell.count === 1 ? "" : "s"}`}
                  className="size-3 rounded-[1px]"
                  style={{
                    background: tint(cell.count),
                    boxShadow:
                      cell.count === 0
                        ? "inset 0 0 0 1px rgb(93 104 82 / 0.35)"
                        : undefined,
                  }}
                />
              ),
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate">
        none
        {[0, 1, 3, 6].map((n) => (
          <span
            key={n}
            className="size-3 rounded-[1px]"
            style={{
              background: tint(n),
              boxShadow:
                n === 0 ? "inset 0 0 0 1px rgb(93 104 82 / 0.35)" : undefined,
            }}
          />
        ))}
        a lot
      </p>
    </div>
  );
}
