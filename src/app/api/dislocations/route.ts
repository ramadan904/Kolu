import { NextResponse } from "next/server";
import { breakevenBps } from "@/lib/basis/edge";
import {
  DEFAULT_WINDOW_MS,
  downsample,
  MAX_WINDOW_MS,
  openEvents,
  realHistory,
  type OpenEvent,
} from "@/lib/data/market-history";
import type { SessionPhase } from "@/lib/market/session";
import { loadMints } from "@/lib/mints";
import { CORE_UNIVERSE } from "@/lib/universe";

export const dynamic = "force-dynamic";

export interface Dislocation {
  ticker: string;
  tokenTicker: string;
  name: string;
  /** The widest hourly-median gap this pair showed in the window, signed. */
  basisBps: number;
  /** When it happened, unix ms. */
  t: number;
  phase: SessionPhase;
  /** Whether a $10k round trip at that gap would have cleared modelled costs. */
  clearedCosts: boolean;
  /** Hourly medians over the window, for a sparkline: [unix ms, bps, shut?]. */
  spark: [number, number, boolean][];
  /** Every open in the last week: the gap before, after, and how much closed. */
  opens: OpenEvent[];
  /**
   * The week at 30-minute medians, for the backtest:
   * [unix s, gap bps, session (0 open · 1 extended hours · 2 shut), token USD, share USD].
   */
  week: WeekRow[];
}

export type { WeekRow } from "@/lib/backtest";
import type { WeekRow } from "@/lib/backtest";

const sessionCode = (phase: SessionPhase): 0 | 1 | 2 =>
  phase === "regular" ? 0 : SHUT.has(phase) ? 2 : 1;
const sig = (n: number) => Number(n.toPrecision(6));

const SHUT = new Set<SessionPhase>(["closed", "weekend", "holiday"]);

/**
 * The widest real gap each liquid pair showed in the last 48h, and what
 * happened to its gap at each open in the last week, from its pool
 * trades against the share's last print — the same series the chart draws.
 * Pairs are read one after another so a cold cache stays inside the history
 * sources' rate limits; the response is cached at the edge for five minutes.
 */
export async function GET() {
  const mints = await loadMints();
  const breakeven = breakevenBps();
  const out: Dislocation[] = [];
  let missing = 0;

  for (const entry of CORE_UNIVERSE) {
    const mint = mints.tokens[entry.ticker]?.mint;
    const week = mint ? await realHistory(entry.ticker, mint, MAX_WINDOW_MS) : null;
    const cutoff = Date.now() - DEFAULT_WINDOW_MS;
    const points = week?.filter((p) => p.t >= cutoff) ?? [];
    if (!week || points.length === 0) {
      missing += 1;
      continue;
    }
    // Widest hourly median, not widest single print: a thin pool's lone
    // off-book trade is not a gap anyone could have traded.
    const hourly = downsample(points);
    const widest = hourly.reduce((a, b) => (Math.abs(b.basisBps) > Math.abs(a.basisBps) ? b : a));
    out.push({
      ticker: entry.ticker,
      tokenTicker: entry.tokenTicker,
      name: entry.name,
      basisBps: widest.basisBps,
      t: widest.t,
      phase: widest.phase,
      clearedCosts: Math.abs(widest.basisBps) >= breakeven,
      spark: hourly.map((p) => [p.t, Math.round(p.basisBps * 10) / 10, SHUT.has(p.phase)]),
      opens: openEvents(week),
      week: downsample(week, 1_800_000)
        .filter((p) => p.token !== undefined && p.equity !== undefined)
        .map((p) => [Math.round(p.t / 1000), Math.round(p.basisBps * 10) / 10, sessionCode(p.phase), sig(p.token!), sig(p.equity!)]),
    });
  }

  out.sort((a, b) => Math.abs(b.basisBps) - Math.abs(a.basisBps));
  return NextResponse.json(
    { dislocations: out, breakevenBps: breakeven, missing, generatedAt: new Date().toISOString() },
    {
      headers: {
        // Only cache a complete answer; a partial one should be retried soon.
        "cache-control": missing === 0 ? "public, max-age=60, s-maxage=300" : "no-store",
      },
    },
  );
}
