// The window the independence profile is read over. Kept out of page.tsx so the
// client tab bar and the server page agree on one list, and out of the client
// bundle boundary so neither has to import the other.

export const WINDOWS = [7, 30, 90] as const;

export type WindowDays = (typeof WINDOWS)[number];

export const DEFAULT_WINDOW: WindowDays = 7;

export function parseWindow(raw: string | undefined | null): WindowDays {
  const parsed = Number.parseInt(raw ?? "", 10);
  return (WINDOWS as readonly number[]).includes(parsed)
    ? (parsed as WindowDays)
    : DEFAULT_WINDOW;
}

/** "the last 7 days" — used in definitions, so it must read as a fact. */
export function windowPhrase(days: WindowDays): string {
  return `the last ${days} days`;
}

/** "the previous 7 days" — what a trend is measured against. */
export function previousPhrase(days: WindowDays): string {
  return `the previous ${days} days`;
}
