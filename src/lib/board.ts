/**
 * Assembles the dashboard snapshot: prices in, ranked basis readings out.
 */

import { computeBasis, rankByDislocation, type BasisReading } from "./basis/compute";
import { makeFixtureSource, resolveSource } from "./data/provider";
import type { Scenario } from "./data/fixtures";
import type { PriceReading } from "./data/types";
import { record } from "./history";
import { getMarketSession, type MarketSession } from "./market/session";
import { CORE_UNIVERSE, UNIVERSE, symbolsFor, type UniverseEntry } from "./universe";

export interface BoardSummary {
  actionable: number;
  /** Signed basis of the widest dislocation on the board. */
  widestBps: number | null;
  widestTicker: string | null;
}

/**
 * Why the board is not showing live prices.
 *
 * `unreachable` is an outage: the oracle could not be contacted, so demo data
 * keeps the page useful and the banner says the numbers are not live.
 *
 * `no_feeds` is a configuration error: the oracle answered perfectly well and
 * none of the symbols we asked for exist. Substituting demo data there would
 * paper over the bug with numbers that look plausible, so it does not. The
 * board stays empty and says what is wrong. Different failures, opposite
 * treatment.
 */
export type DegradedKind = "unreachable" | "no_feeds";

export interface BoardSnapshot {
  generatedAt: string;
  session: MarketSession;
  /** "replay" is the live board's maths run over real trades from a past moment. */
  source: "pyth" | "jupiter" | "fixture" | "replay";
  /** True when the live source failed and fixtures were substituted. */
  fellBack: boolean;
  fallbackReason: string | null;
  degraded: DegradedKind | null;
  /** Symbols requested from the oracle, for diagnosing a naming mismatch. */
  requestedSymbols: string[];
  scenario: Scenario | null;
  readings: BasisReading[];
  summary: BoardSummary;
}

export interface BoardOptions {
  tier?: "core" | "all";
  now?: Date;
  /**
   * Render a labelled demo scenario instead of live prices, on request. Lets
   * someone see what a real dislocation looks like on a quiet day. The
   * snapshot says `source: "fixture"` and carries the scenario, so every
   * surface can label it — and it is never recorded into price history.
   */
  scenario?: Scenario;
}

/**
 * Short-lived snapshot cache.
 *
 * The page, the board poll and the history endpoint each want a board, and a
 * user clicking around produces several requests a second. Without this, each
 * one becomes its own round of oracle calls — wasteful, and the quickest way to
 * get rate-limited in front of a judge. The window is deliberately shorter than
 * the UI's poll interval, so the board never shows something staler than it
 * would have anyway.
 */
const CACHE_TTL_MS = Number(process.env.KOLU_BOARD_CACHE_MS ?? 4000);
const snapshots = new Map<string, { at: number; snapshot: BoardSnapshot }>();

export function clearBoardCache(): void {
  snapshots.clear();
}

export async function buildBoard(options: BoardOptions = {}): Promise<BoardSnapshot> {
  // An explicit clock means a caller wants a specific moment — tests, mostly.
  // Serving those from a cache keyed only by tier would be wrong.
  const cacheable = options.now === undefined && CACHE_TTL_MS > 0;
  const key = `${options.tier ?? "core"}:${options.scenario ?? "live"}`;

  if (cacheable) {
    const hit = snapshots.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.snapshot;
  }

  const snapshot = await buildBoardUncached(options);
  if (cacheable) snapshots.set(key, { at: Date.now(), snapshot });
  return snapshot;
}

async function buildBoardUncached(options: BoardOptions): Promise<BoardSnapshot> {
  const now = options.now ?? new Date();
  const entries: UniverseEntry[] = options.tier === "all" ? UNIVERSE : CORE_UNIVERSE;
  const symbols = symbolsFor(entries);
  const session = getMarketSession(now);

  const clock = () => now;
  let resolved = options.scenario
    ? makeFixtureSource(clock, options.scenario)
    : await resolveSource(clock);
  let prices: Map<string, PriceReading>;
  let fellBack = false;
  let fallbackReason: string | null = null;
  let degraded: DegradedKind | null = null;

  try {
    prices = await resolved.source.getLatest(symbols);
  } catch (err) {
    if (resolved.mode === "fixture") throw err;
    fellBack = true;
    degraded = "unreachable";
    fallbackReason =
      err instanceof Error ? err.message : "Live price source was unreachable";
    resolved = makeFixtureSource(clock);
    prices = await resolved.source.getLatest(symbols);
  }

  if (!fellBack && resolved.mode !== "fixture" && prices.size === 0) {
    // Reachable, and nothing we asked for exists. Do not invent a board.
    degraded = "no_feeds";
    fallbackReason =
      "The oracle responded but none of the requested symbols resolved. The tokenized-symbol naming is probably wrong — see /api/health.";
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

  // A requested demo must never become part of the recorded history.
  if (!options.scenario) {
    for (const reading of readings) {
      if (reading.basisBps !== null) record(reading.ticker, reading.basisBps, now);
    }
  }

  return {
    generatedAt: now.toISOString(),
    session,
    source: resolved.mode,
    fellBack,
    fallbackReason,
    degraded,
    requestedSymbols: symbols,
    scenario: resolved.scenario,
    readings,
    summary: summarise(readings),
  };
}

/** Shared with the replay route, which builds a board from recorded trades. */
export function summarise(readings: BasisReading[]): BoardSummary {
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
