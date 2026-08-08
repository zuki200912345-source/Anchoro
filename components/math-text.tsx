import type { ReactNode } from "react";

// Plain-text maths, rendered properly without any LaTeX pipeline:
//   - caret exponents become real superscripts (x^2, 10^-4, cm^3, e^x)
//   - " x " between numbers or brackets becomes a multiplication sign
// Item stems and keys stay ASCII in the database; this is display-only, so
// what students type as an answer is never transformed.

const EXPONENT = /([A-Za-z0-9)\]]+)\^(-?\d+(?:\.\d+)?|[A-Za-z](?![A-Za-z]))/g;

function prettify(text: string): string {
  return text.replace(/(?<=[\d)]) x (?=[\d(])/g, " × ");
}

export function formatMath(text: string): ReactNode {
  const source = prettify(text);
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of source.matchAll(EXPONENT)) {
    const index = match.index ?? 0;
    if (index > last) out.push(source.slice(last, index));
    out.push(match[1]);
    out.push(<sup key={key++}>{match[2]}</sup>);
    last = index + match[0].length;
  }
  if (out.length === 0) return source;
  if (last < source.length) out.push(source.slice(last));
  return out;
}

export function MathText({ text }: { text: string }) {
  return <>{formatMath(text)}</>;
}
