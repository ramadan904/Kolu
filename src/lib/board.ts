/**
 * Assembles the dashboard snapshot: prices in, ranked basis readings out.
 */

import { computeBasis, rankByDislocation, type BasisReading } from "./basis/compute";
import { makeFixtureSource, resolveSource } from "./data/provider";
import type { Scenario } from "./data/fixtures";
import { PriceSourceError, type PriceReading } from "./data/types";
import { record } from "./history";
import { getMarketSession, type MarketSession } from "./market/session";
import { CORE_UNIVERSE, UNIVERSE, symbolsFor, type UniverseEntry } from "./universe";

export interface BoardSummary {
  actionable: number;
  /** Signed basis of the widest dislocation on the board. */
  widestBps: number | null;
  widestTicker: string | null;
}

export interface BoardSnapshot {
  generatedAt: string;
  session: MarketSession;
  source: "pyth" | "fixture";
  /** True when the live source failed and fixtures were substituted. */
  fellBack: boolean;
  fallbackReason: string | null;
  scenario: Scenario | null;
  readings: BasisReading[];
  summary: BoardSummary;
}

export interface BoardOptions {
  tier?: "core" | "all";
  now?: Date;
}

export async function buildBoard(options: BoardOptions = {}): Promise<BoardSnapshot> {
  const now = options.now ?? new Date();
  const entries: UniverseEntry[] = options.tier === "all" ? UNIVERSE : CORE_UNIVERSE;
  const symbols = symbolsFor(entries);
  const session = getMarketSession(now);

  const clock = () => now;
  let resolved = resolveSource(clock);
  let prices: Map<string, PriceReading>;
  let fellBack = false;
  let fallbackReason: string | null = null;

  try {
    prices = await resolved.source.getLatest(symbols);
    if (prices.size === 0 && resolved.mode === "pyth") {
      throw new PriceSourceError("Hermes returned no prices for the requested feeds");
    }
  } catch (err) {
    if (resolved.mode === "fixture") throw err;
    fellBack = true;
    fallbackReason =
      err instanceof Error ? err.message : "Live price source was unreachable";
    resolved = makeFixtureSource(clock);
    prices = await resolved.source.getLatest(symbols);
  }

  const readings = rankByDislocation(
    entries.map((entry) =>
      computeBasis(
        entry,
        prices.get(entry.equitySymbol) ?? null,
        prices.get(entry.tokenSymbol) ?? null,
        session,
        { now },
      ),
    ),
  );

  for (const reading of readings) {
    if (reading.basisBps !== null) record(reading.ticker, reading.basisBps, now);
  }

  return {
    generatedAt: now.toISOString(),
    session,
    source: resolved.mode,
    fellBack,
    fallbackReason,
    scenario: resolved.scenario,
    readings,
    summary: summarise(readings),
  };
}

function summarise(readings: BasisReading[]): BoardSummary {
  const tradeable = readings.filter(
    (r) => r.signal === "actionable" || r.signal === "stale_reference",
  );
  const widest = tradeable.reduce<BasisReading | null>((best, r) => {
    if (r.basisBps === null) return best;
    if (!best || Math.abs(r.basisBps) > Math.abs(best.basisBps ?? 0)) return r;
    return best;
  }, null);

  return {
    actionable: tradeable.length,
    widestBps: widest?.basisBps ?? null,
    widestTicker: widest?.ticker ?? null,
  };
}
