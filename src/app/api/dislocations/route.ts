import { NextResponse } from "next/server";
import { breakevenBps } from "@/lib/basis/edge";
import { realHistory } from "@/lib/data/market-history";
import type { SessionPhase } from "@/lib/market/session";
import { loadMints } from "@/lib/mints";
import { CORE_UNIVERSE } from "@/lib/universe";

export const dynamic = "force-dynamic";

export interface Dislocation {
  ticker: string;
  tokenTicker: string;
  name: string;
  /** The widest gap this pair showed in the window, signed. */
  basisBps: number;
  /** When it happened, unix ms. */
  t: number;
  phase: SessionPhase;
  /** Whether a $10k round trip at that gap would have cleared modelled costs. */
  clearedCosts: boolean;
}

/**
 * The widest real gap each liquid pair showed in the last 48h, from its pool
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
    const points = mint ? await realHistory(entry.ticker, mint) : null;
    if (!points || points.length === 0) {
      missing += 1;
      continue;
    }
    const widest = points.reduce((a, b) => (Math.abs(b.basisBps) > Math.abs(a.basisBps) ? b : a));
    out.push({
      ticker: entry.ticker,
      tokenTicker: entry.tokenTicker,
      name: entry.name,
      basisBps: widest.basisBps,
      t: widest.t,
      phase: widest.phase,
      clearedCosts: Math.abs(widest.basisBps) >= breakeven,
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
