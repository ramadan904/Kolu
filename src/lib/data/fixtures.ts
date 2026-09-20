/**
 * Deterministic offline price source.
 *
 * Two reasons this exists rather than being test-only scaffolding:
 *
 * 1. Anyone can clone this repo and see the product work without a Pyth
 *    endpoint, an RPC, or a funded wallet.
 * 2. The interesting states of this product — a weekend that has drifted 180bps,
 *    a feed that has gone stale mid-session — are exactly the states you cannot
 *    summon on demand from live data. Judging happens on a Wednesday afternoon;
 *    the weekend story has to be reproducible.
 *
 * Prices are generated from a seeded PRNG, so the same scenario renders
 * identically on every machine and every run.
 */

import type { FeedDescriptor, PriceReading, PriceSource } from "./types";
import { UNIVERSE } from "../universe";

export type Scenario =
  /** Market shut, tokens have drifted materially off Friday's close. */
  | "weekend_drift"
  /** Market open, one name genuinely dislocated, the rest tight. */
  | "live_dislocation"
  /** Everything inside the noise floor. The honest common case. */
  | "calm"
  /** Equity reference has stopped ticking while the market is open. */
  | "degraded";

export const SCENARIOS: Scenario[] = [
  "weekend_drift",
  "live_dislocation",
  "calm",
  "degraded",
];

/** Rough reference levels. Absolute values do not matter; the basis does. */
const REFERENCE_PRICES: Record<string, number> = {
  TSLA: 412.5,
  NVDA: 183.2,
  SPY: 664.8,
  AAPL: 238.4,
  QQQ: 592.1,
  MSFT: 511.7,
  META: 748.3,
  AMZN: 231.9,
  GOOGL: 253.6,
  COIN: 322.4,
  MSTR: 341.8,
  CRCL: 148.2,
};

/** mulberry32 — small, fast, and reproducible across platforms. */
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

interface ScenarioShape {
  /** Basis in bps applied to the token leg, per ticker index. */
  basisBps: (rng: () => number, index: number) => number;
  /** Age of the equity reference, in seconds. */
  referenceAge: number;
  /** Confidence as a fraction of price. */
  confidenceFrac: number;
}

const SHAPES: Record<Scenario, ScenarioShape> = {
  weekend_drift: {
    // Risk-on drift with no equity market to anchor it: the whole board leans the
    // same way, but beta differs, so magnitudes spread rather than cluster.
    // One name gapped the other way on its own news, so both poles of the
    // diverging scale appear and the board is not a wall of one colour.
    basisBps: (rng, i) =>
      (30 + rng() * 45) * (1 + (i % 4) * 0.75) * (i === 3 ? -1 : 1),
    referenceAge: 14 * 3600,
    confidenceFrac: 0.00035,
  },
  live_dislocation: {
    // One outlier, everything else tight.
    basisBps: (rng, i) => (i === 1 ? 165 + rng() * 40 : (rng() - 0.5) * 22),
    referenceAge: 3,
    confidenceFrac: 0.0002,
  },
  calm: {
    basisBps: (rng) => (rng() - 0.5) * 14,
    referenceAge: 4,
    confidenceFrac: 0.0004,
  },
  degraded: {
    basisBps: (rng) => (rng() - 0.4) * 120,
    referenceAge: 9 * 60,
    confidenceFrac: 0.0003,
  },
};

export interface FixtureOptions {
  scenario?: Scenario;
  /** Fixed clock, so snapshots are stable in tests. */
  now?: () => Date;
  /** Change to regenerate a different but equally deterministic draw. */
  seed?: string;
}

export class FixtureSource implements PriceSource {
  readonly kind = "fixture" as const;

  private readonly scenario: Scenario;
  private readonly now: () => Date;
  private readonly seed: string;

  constructor(options: FixtureOptions = {}) {
    this.scenario = options.scenario ?? "weekend_drift";
    this.now = options.now ?? (() => new Date());
    this.seed = options.seed ?? "kolu";
  }

  async resolveFeeds(symbols: string[]): Promise<Map<string, FeedDescriptor>> {
    const out = new Map<string, FeedDescriptor>();
    for (const symbol of symbols) {
      out.set(symbol, {
        // Clearly synthetic: no one can mistake this for a real feed id.
        id: `fixture${hashSeed(symbol).toString(16).padStart(8, "0")}`,
        symbol,
        assetType: symbol.startsWith("Equity") ? "equity" : "crypto",
        displaySymbol: symbol,
      });
    }
    return out;
  }

  async getLatest(symbols: string[]): Promise<Map<string, PriceReading>> {
    const shape = SHAPES[this.scenario];
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const feeds = await this.resolveFeeds(symbols);
    const out = new Map<string, PriceReading>();

    UNIVERSE.forEach((entry, index) => {
      const rng = makeRng(hashSeed(`${this.seed}:${this.scenario}:${entry.ticker}`));
      const reference = REFERENCE_PRICES[entry.ticker] ?? 100;

      // Small drift on the reference itself so successive polls are not frozen.
      const equityPrice = reference * (1 + (rng() - 0.5) * 0.002);
      const basisBps = shape.basisBps(rng, index);
      const tokenPrice = equityPrice * (1 + basisBps / 10_000);

      if (symbols.includes(entry.equitySymbol)) {
        out.set(entry.equitySymbol, {
          symbol: entry.equitySymbol,
          feedId: feeds.get(entry.equitySymbol)?.id ?? "fixture",
          price: round2(equityPrice),
          confidence: round2(equityPrice * shape.confidenceFrac),
          publishTime: nowSeconds - shape.referenceAge,
          source: "fixture",
        });
      }

      if (symbols.includes(entry.tokenSymbol)) {
        out.set(entry.tokenSymbol, {
          symbol: entry.tokenSymbol,
          feedId: feeds.get(entry.tokenSymbol)?.id ?? "fixture",
          price: round2(tokenPrice),
          confidence: round2(tokenPrice * shape.confidenceFrac * 1.4),
          publishTime: nowSeconds - 3,
          source: "fixture",
        });
      }
    });

    return out;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isScenario(value: string | undefined): value is Scenario {
  return !!value && (SCENARIOS as string[]).includes(value);
}
