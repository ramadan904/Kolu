import { NextResponse } from "next/server";
import { KNOWN_POOLS } from "@/lib/data/market-history";
import { findEntry } from "@/lib/universe";

export const dynamic = "force-dynamic";

/**
 * How deep the pool behind a pair actually is.
 *
 * The ticket already measures price impact from a live route quote; this says
 * where that number comes from. A $10k clip costing tens of basis points is
 * not a quirk of the router — it is what a two-million-dollar pool does to a
 * ten-thousand-dollar order, and a trader deciding size deserves to see it.
 *
 * Never fails loudly: a missing or rate-limited answer returns
 * `available: false`, and the ticket simply says nothing.
 */
interface Depth {
  available: boolean;
  pool?: string;
  tvlUsd?: number;
  volume24hUsd?: number;
  url?: string;
}

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { depth: Depth; at: number }>();

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker")?.toUpperCase() ?? "";
  const entry = findEntry(ticker);
  const pool = entry ? KNOWN_POOLS[entry.ticker] : undefined;
  if (!entry || !pool) return NextResponse.json({ available: false } satisfies Depth);

  const hit = cache.get(entry.ticker);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json(hit.depth, { headers: { "cache-control": "public, max-age=300" } });
  }

  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as {
      data?: { attributes?: { name?: string; reserve_in_usd?: string; volume_usd?: { h24?: string } } };
    };
    const a = body.data?.attributes;
    const tvlUsd = Number(a?.reserve_in_usd ?? 0);
    if (!(tvlUsd > 0)) throw new Error("no reserve");
    const depth: Depth = {
      available: true,
      pool: a?.name ?? undefined,
      tvlUsd,
      volume24hUsd: Number(a?.volume_usd?.h24 ?? 0) || undefined,
      url: `https://www.geckoterminal.com/solana/pools/${pool}`,
    };
    cache.set(entry.ticker, { depth, at: Date.now() });
    return NextResponse.json(depth, { headers: { "cache-control": "public, max-age=300" } });
  } catch {
    // Serve a stale answer rather than nothing; otherwise say nothing at all.
    if (hit) return NextResponse.json(hit.depth);
    return NextResponse.json({ available: false } satisfies Depth);
  }
}
