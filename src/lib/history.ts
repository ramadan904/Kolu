/**
 * Basis history.
 *
 * The board answers "is there a gap right now". This answers the question a
 * trader asks immediately afterwards: "is that gap opening or closing, and
 * what happened last time the market opened?" A dislocation that has been
 * widening for six hours and one that is halfway back to zero look identical
 * as a single number.
 *
 * Live history accumulates in-process as the board is polled — no database, and
 * it is honest about how little it has. Fixture mode backfills a synthetic
 * series so the weekend story is demonstrable on a Wednesday afternoon; the
 * series is flagged `synthetic` and the UI says so.
 */

import type { SessionPhase } from "./market/session";
import { getMarketSession } from "./market/session";

export interface HistoryPoint {
  /** Unix milliseconds. */
  t: number;
  basisBps: number;
  phase: SessionPhase;
}

export interface HistorySeries {
  ticker: string;
  points: HistoryPoint[];
  /** True when the series was generated rather than observed. */
  synthetic: boolean;
  /** Minutes actually covered by observed data. */
  observedMinutes: number;
}

/** 48h at one sample per two minutes. */
const MAX_POINTS = 1440;
const MIN_SAMPLE_GAP_MS = 60_000;

const store = new Map<string, HistoryPoint[]>();

export function record(ticker: string, basisBps: number, at: Date): void {
  const points = store.get(ticker) ?? [];
  const t = at.getTime();
  const last = points[points.length - 1];

  // The board may be polled far more often than the chart needs.
  if (last && t - last.t < MIN_SAMPLE_GAP_MS) return;

  points.push({ t, basisBps, phase: getMarketSession(at).phase });
  if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
  store.set(ticker, points);
}

export function observed(ticker: string): HistoryPoint[] {
  return store.get(ticker) ?? [];
}

export function clear(): void {
  store.clear();
}

/** mulberry32, matching the fixture source so demos stay reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface BackfillOptions {
  hours?: number;
  stepMinutes?: number;
}

/**
 * Generates a plausible path ending exactly at `currentBps`.
 *
 * The shape is the product's whole thesis, so it is modelled rather than
 * random. Forward in time: while the underlying market is open the basis is
 * pulled hard toward zero, because arbitrageurs can hedge and so they do;
 * while it is shut the series random-walks with drift and nothing pulls it
 * back.
 *
 * The series is generated forward from near zero and then reconciled to the
 * current value, rather than integrated backwards from it. Running the
 * mean-reversion in reverse is the mathematically exact inverse and gives a
 * wildly wrong picture — undoing a decay compounds, so it reconstructs a past
 * where the gap was enormous and shrinking, which is the opposite of what
 * happens. The reconciliation is applied only across the most recent closure,
 * so session-time history stays pinned near zero where it belongs.
 */
export function backfill(
  ticker: string,
  currentBps: number,
  now: Date,
  options: BackfillOptions = {},
): HistoryPoint[] {
  const hours = options.hours ?? 48;
  const stepMinutes = options.stepMinutes ?? 5;
  const steps = Math.max(2, Math.floor((hours * 60) / stepMinutes));
  const stepMs = stepMinutes * 60_000;
  const rng = makeRng(hashSeed(`history:${ticker}`));
  const drift = Math.sign(currentBps) || 1;

  const points: HistoryPoint[] = [];
  let value = (rng() - 0.5) * 8;

  for (let i = 0; i < steps; i += 1) {
    const t = now.getTime() - (steps - 1 - i) * stepMs;
    const phase = getMarketSession(new Date(t)).phase;

    if (phase === "regular") {
      // Hedgeable: the gap decays toward zero with a little friction.
      value = value * 0.88 + (rng() - 0.5) * 5;
    } else if (phase === "premarket" || phase === "afterhours") {
      // Thin quoting: weak pull, wider noise.
      value = value * 0.97 + (rng() - 0.5) * 9;
    } else {
      // Nothing to arbitrage against: drift accumulates.
      value = value + drift * rng() * 3.2 + (rng() - 0.5) * 7;
    }

    points.push({ t, basisBps: value, phase });
  }

  reconcile(points, currentBps);
  return points;
}

/**
 * Shifts the tail of the series so it ends exactly on `target`, weighting the
 * correction across the final closed run. Points from before that closure are
 * left alone, so the "flat through the session, opens overnight" shape is
 * preserved rather than smeared across the whole window.
 */
function reconcile(points: HistoryPoint[], target: number): void {
  const last = points.length - 1;
  const delta = target - points[last].basisBps;

  // Walk back to the start of the trailing run of shut phases.
  let start = last;
  while (start > 0 && SHUT_PHASES.has(points[start - 1].phase)) start -= 1;

  // Market is open right now, so there is no closure to absorb the correction:
  // spread it over the last fifth of the window instead.
  if (start === last) start = Math.max(0, last - Math.floor(points.length / 5));

  const span = Math.max(last - start, 1);
  for (let i = start; i <= last; i += 1) {
    points[i].basisBps += delta * ((i - start) / span);
  }

  for (const p of points) {
    p.basisBps = Math.max(-600, Math.min(600, p.basisBps));
  }
  // Clamping must not move the anchor point away from the live value.
  points[last].basisBps = target;
}

const SHUT_PHASES = new Set<SessionPhase>(["closed", "weekend", "holiday"]);

export function seriesFor(
  ticker: string,
  currentBps: number | null,
  now: Date,
  synthetic: boolean,
): HistorySeries {
  const points = observed(ticker);
  const observedMinutes =
    points.length > 1 ? Math.round((points[points.length - 1].t - points[0].t) / 60_000) : 0;

  if (!synthetic || currentBps === null) {
    return { ticker, points, synthetic: false, observedMinutes };
  }

  // Splice the generated past onto whatever has actually been observed, so a
  // long-running demo still shows its own real samples at the right edge.
  const generated = backfill(ticker, currentBps, now);
  const cutoff = points.length ? points[0].t : Infinity;
  return {
    ticker,
    points: [...generated.filter((p) => p.t < cutoff), ...points],
    synthetic: true,
    observedMinutes,
  };
}
