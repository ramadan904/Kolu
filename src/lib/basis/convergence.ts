import { NARROWED_PCT, type OpenEvent } from "../data/market-history";

export interface Outlook {
  /** Opens measured for this pair in the window. */
  total: number;
  /** How many took at least a quarter off the gap. */
  narrowed: number;
  /** Median share of the gap that closed, 0-100. Negative medians are kept: they happened. */
  medianClosedPct: number | null;
  /** Gap expected to close if this open behaves like the median, in bps. */
  expectedBps: number | null;
  /** That, less the round-trip cost. Negative means the median open does not pay. */
  netBps: number | null;
  /** The worst single open in the window, as a share of the gap. */
  worstClosedPct: number | null;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * What this pair's own opens say about the gap on screen.
 *
 * A closed-market trade is a bet that the gap narrows when the share trades
 * again. This turns that bet into the only honest form it has: a base rate
 * from the same pair's recent opens, applied to today's gap, after costs —
 * with the worst open kept in view, because a median hides the day it widened.
 */
export function convergenceOutlook(opens: OpenEvent[], gapBps: number, costBps: number): Outlook {
  const closed = opens.map((o) => o.closedPct);
  const medianClosedPct = median(closed);
  const gap = Math.abs(gapBps);
  const expectedBps = medianClosedPct === null ? null : (gap * medianClosedPct) / 100;
  return {
    total: opens.length,
    narrowed: opens.filter((o) => o.closedPct >= NARROWED_PCT).length,
    medianClosedPct,
    expectedBps,
    netBps: expectedBps === null ? null : expectedBps - costBps,
    worstClosedPct: closed.length ? Math.min(...closed) : null,
  };
}

/** "4h 12m", "38m" — how long until the market can close the gap. */
export function untilOpen(minutes: number | null): string | null {
  if (minutes === null || minutes < 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
