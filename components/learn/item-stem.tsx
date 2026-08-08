// The problem, as shown. Nothing else from the item row reaches this file:
// the verified key, the rubric and the worked solution stay server-side (I3).

import type { PublicItem, SessionMode } from "@/lib/research/types";
import { MathText } from "@/components/math-text";

const KIND_LABEL: Record<PublicItem["kind"], string> = {
  retrieval: "Recall",
  reasoning: "Reasoning",
  transfer: "Transfer",
  practice: "Practice",
};

const MODE_NOTE: Record<SessionMode, string | null> = {
  assisted: null,
  brain_only: "Brain-only session. No AI until you finish — you check against the key at the end.",
  review: "Spaced review. You have seen this one before.",
  transfer: "Transfer item. Same method, new setting.",
};

export function ItemStem({
  item,
  mode,
}: {
  item: PublicItem;
  mode: SessionMode;
}) {
  const modeNote = MODE_NOTE[mode];

  return (
    <section className="plane p-5" aria-labelledby="learn-item-heading">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate">
        <span className="font-semibold uppercase tracking-wide text-ink">
          {KIND_LABEL[item.kind]}
        </span>
        <span>
          {item.subject} · {item.topic}
        </span>
        <span className="num">d{item.difficulty}</span>
      </div>

      <h2 id="learn-item-heading" className="sr-only">
        The problem
      </h2>
      <p className="mt-3 text-lg leading-snug whitespace-pre-wrap"><MathText text={item.stem} /></p>

      {modeNote ? <p className="mt-3 text-xs text-slate">{modeNote}</p> : null}
    </section>
  );
}
