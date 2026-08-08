"use client";

// H1 — "How confident are you?" stated BEFORE the answer goes in. It is
// required for the first attempt, because a prediction made after the fact
// measures nothing (Bisra et al. 2018; H2 compares it to what happened).
//
// H6 — the copy stays on the task. It rates the answer, not the person.

export function ConfidenceSlider({
  value,
  onChange,
  disabled = false,
  locked = false,
}: {
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** After the first submit the rating is history — shown, not editable. */
  locked?: boolean;
}) {
  const shown = value ?? 50;

  return (
    <section className="plane-sm p-4" aria-labelledby="confidence-label">
      <div className="flex items-baseline justify-between gap-3">
        <label
          id="confidence-label"
          htmlFor="confidence"
          className="text-sm font-semibold"
        >
          How confident are you?
        </label>
        <span className="num text-sm" aria-hidden>
          {value === null ? "—" : `${value}%`}
        </span>
      </div>

      <input
        id="confidence"
        type="range"
        min={0}
        max={100}
        step={5}
        value={shown}
        disabled={disabled || locked}
        aria-valuetext={value === null ? "not set" : `${value} percent`}
        aria-describedby="confidence-help"
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 h-11 w-full cursor-pointer accent-flag disabled:cursor-default disabled:opacity-60"
      />

      <div className="flex justify-between text-xs text-slate">
        <span>No idea</span>
        <span>Certain</span>
      </div>

      <p id="confidence-help" className="mt-2 text-xs text-slate">
        {locked
          ? "Locked in for this item. It gets compared to what actually happened."
          : value === null
            ? "Set a number before your first attempt. It gets compared to what actually happened."
            : "It gets compared to what actually happened, not added to a mark."}
      </p>
    </section>
  );
}
