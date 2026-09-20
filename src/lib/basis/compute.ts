/**
 * Basis: how far a tokenized stock has drifted from its underlying.
 *
 * Two judgement calls are baked in here, and both matter more than the
 * subtraction itself.
 *
 * 1. A gap smaller than the oracles' own confidence intervals is not a signal.
 *    Pyth publishes a confidence band with every price; we add both legs' bands
 *    and refuse to call anything inside that band actionable.
 *
 * 2. A stale reference price is normal when the market is shut and alarming
 *    when it is open. The same 14-hour-old AAPL print is the expected state of
 *    the world at 3am and a broken feed at 11am. These are reported as
 *    different things (`stale_reference` vs `degraded_feed`) because a trader
 *    acts differently on each.
 */

import type { PriceReading } from "../data/types";
import { MAX_PRICE_AGE_SECONDS } from "../data/pyth";
import type { MarketSession } from "../market/session";
import { referenceQualityFor } from "../market/session";
import type { UniverseEntry } from "../universe";

export type BasisDirection = "premium" | "discount" | "flat";

export type BasisSignal =
  /** Gap is larger than combined oracle confidence — worth looking at. */
  | "actionable"
  /** Gap exists but sits inside the noise floor. */
  | "noise"
  /** Reference is old because the market is closed. Expected; still tradeable. */
  | "stale_reference"
  /** Reference is old while the market is open. Something is wrong upstream. */
  | "degraded_feed"
  /** One or both legs missing. */
  | "unavailable";

export interface BasisReading {
  ticker: string;
  name: string;
  tokenTicker: string;
  equity: PriceReading | null;
  token: PriceReading | null;
  /** (token − equity) / equity, in basis points. Positive = token is richer. */
  basisBps: number | null;
  basisUsd: number | null;
  direction: BasisDirection | null;
  /** Combined oracle confidence of both legs, in bps of the reference price. */
  confidenceBps: number | null;
  signal: BasisSignal;
  referenceQuality: "live" | "thin" | "stale";
  /** Seconds since the equity reference was published. */
  referenceAgeSeconds: number | null;
  tokenAgeSeconds: number | null;
  /** Human-readable reason when `signal` is not actionable. */
  note: string | null;
}

/**
 * A gap must exceed this multiple of combined confidence to count as signal.
 * 1.0 would flag every price that merely touches the edge of the band.
 */
export const NOISE_MULTIPLE = 1.5;

/** Below this, the gap is rounding and spread, not a dislocation. */
export const FLAT_THRESHOLD_BPS = 5;

export interface ComputeOptions {
  now?: Date;
  noiseMultiple?: number;
}

function ageSeconds(reading: PriceReading | null, nowSeconds: number): number | null {
  return reading ? Math.max(0, nowSeconds - reading.publishTime) : null;
}

export function computeBasis(
  entry: UniverseEntry,
  equity: PriceReading | null,
  token: PriceReading | null,
  session: MarketSession,
  options: ComputeOptions = {},
): BasisReading {
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const noiseMultiple = options.noiseMultiple ?? NOISE_MULTIPLE;
  const referenceQuality = referenceQualityFor(session.phase);

  const base = {
    ticker: entry.ticker,
    name: entry.name,
    tokenTicker: entry.tokenTicker,
    equity,
    token,
    referenceQuality,
    referenceAgeSeconds: ageSeconds(equity, nowSeconds),
    tokenAgeSeconds: ageSeconds(token, nowSeconds),
  };

  if (!equity || !token) {
    const which = !equity && !token ? "both feeds" : !equity ? "the equity feed" : "the token feed";
    return {
      ...base,
      basisBps: null,
      basisUsd: null,
      direction: null,
      confidenceBps: null,
      signal: "unavailable",
      note: `No price for ${which}.`,
    };
  }

  if (equity.price <= 0) {
    return {
      ...base,
      basisBps: null,
      basisUsd: null,
      direction: null,
      confidenceBps: null,
      signal: "unavailable",
      note: "Reference price was not positive.",
    };
  }

  const basisUsd = token.price - equity.price;
  const basisBps = (basisUsd / equity.price) * 10_000;
  const confidenceBps = ((equity.confidence + token.confidence) / equity.price) * 10_000;

  const direction: BasisDirection =
    Math.abs(basisBps) < FLAT_THRESHOLD_BPS
      ? "flat"
      : basisBps > 0
        ? "premium"
        : "discount";

  const withNumbers = { ...base, basisBps, basisUsd, direction, confidenceBps };
  const referenceAge = base.referenceAgeSeconds ?? 0;

  // Market open but the reference has not ticked: upstream problem, not a trade.
  if (session.isRegularHours && referenceAge > MAX_PRICE_AGE_SECONDS) {
    return {
      ...withNumbers,
      signal: "degraded_feed",
      note: `Market is open but the ${entry.ticker} reference is ${formatAge(referenceAge)} old. Treat this basis as unreliable.`,
    };
  }

  if (Math.abs(basisBps) <= confidenceBps * noiseMultiple) {
    return {
      ...withNumbers,
      signal: "noise",
      note: `Gap of ${basisBps.toFixed(1)}bps sits inside the combined oracle confidence of ${confidenceBps.toFixed(1)}bps.`,
    };
  }

  if (referenceQuality === "stale") {
    return {
      ...withNumbers,
      signal: "stale_reference",
      note: `${session.label ?? "Market closed"} — measured against a reference last printed ${formatAge(referenceAge)} ago. This is drift, not an arbitrage against a live quote.`,
    };
  }

  return { ...withNumbers, signal: "actionable", note: null };
}

export function formatAge(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Widest gaps first; unavailable pairs always sink to the bottom. */
export function rankByDislocation(readings: BasisReading[]): BasisReading[] {
  const weight = (r: BasisReading) => {
    if (r.signal === "unavailable") return -2;
    if (r.signal === "degraded_feed") return -1;
    return Math.abs(r.basisBps ?? 0);
  };
  return [...readings].sort((a, b) => weight(b) - weight(a));
}
