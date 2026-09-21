/**
 * Real 48-hour basis history, from two public sources.
 *
 * The token leg is the xStock's own trading: 15-minute candles from its
 * deepest on-chain pool (GeckoTerminal, no key). The equity leg is the real
 * share's exchange prints for the same window, pre- and post-market included
 * (Yahoo's chart endpoint, no key).
 *
 * Aligning them is where the thesis lives. Each token candle is compared with
 * the last equity print at or before it — so overnight and at weekends, when
 * the share cannot trade, the token is measured against the stale print a
 * trader actually has. That is exactly when the gap opens, and this draws it
 * from trades rather than a model.
 *
 * Both sources are unofficial and rate-limited; every failure returns null and
 * the caller falls back to the labelled modelled shape.
 */

import type { HistoryPoint } from "../history";
import { getMarketSession } from "../market/session";

export interface PriceBar {
  /** Unix seconds. */
  t: number;
  close: number;
}

/**
 * Basis at each token bar, against the most recent equity print at or before
 * it. Bars before the first equity print are dropped: there is nothing to
 * measure them against.
 */
export function alignBasis(token: PriceBar[], equity: PriceBar[]): HistoryPoint[] {
  const eq = [...equity].filter((b) => b.close > 0).sort((a, b) => a.t - b.t);
  const tk = [...token].filter((b) => b.close > 0).sort((a, b) => a.t - b.t);
  const out: HistoryPoint[] = [];
  let j = -1;
  for (const bar of tk) {
    while (j + 1 < eq.length && eq[j + 1].t <= bar.t) j += 1;
    if (j < 0) continue;
    const ref = eq[j].close;
    out.push({
      t: bar.t * 1000,
      basisBps: ((bar.close - ref) / ref) * 10_000,
      phase: getMarketSession(new Date(bar.t * 1000)).phase,
    });
  }
  return out;
}

const UA = { "user-agent": "Mozilla/5.0 (compatible; Kolu/1.0)", accept: "application/json" };
const TIMEOUT_MS = 8_000;

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    // GeckoTerminal's free tier is ~30 requests a minute; one patient retry
    // absorbs a burst without holding the request for long.
    if (res.status === 429 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      continue;
    }
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return res.json();
  }
}

/** Deepest pool per mint; liquidity ranking changes slowly, so cache it long. */
const poolCache = new Map<string, { pool: string; at: number }>();
const POOL_TTL_MS = 60 * 60_000;

async function deepestPool(mint: string): Promise<string | null> {
  const hit = poolCache.get(mint);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.pool;
  const body = (await getJson(
    `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`,
  )) as { data?: { attributes?: { address?: string; reserve_in_usd?: string } }[] };
  const pools = (body.data ?? [])
    .map((p) => ({ address: p.attributes?.address, reserve: Number(p.attributes?.reserve_in_usd ?? 0) }))
    .filter((p): p is { address: string; reserve: number } => typeof p.address === "string")
    .sort((a, b) => b.reserve - a.reserve);
  const pool = pools[0]?.address ?? null;
  if (pool) poolCache.set(mint, { pool, at: Date.now() });
  return pool;
}

export async function tokenBars(mint: string): Promise<PriceBar[]> {
  const pool = await deepestPool(mint);
  if (!pool) return [];
  const body = (await getJson(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=15&limit=200&currency=usd&token=${mint}`,
  )) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (body.data?.attributes?.ohlcv_list ?? [])
    .filter((row) => row.length >= 5)
    .map((row) => ({ t: row[0], close: row[4] }));
}

export async function equityBars(ticker: string): Promise<PriceBar[]> {
  const body = (await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=15m&range=5d&includePrePost=true`,
  )) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const result = body.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const close = result?.indicators?.quote?.[0]?.close ?? [];
  const out: PriceBar[] = [];
  ts.forEach((t, i) => {
    const c = close[i];
    if (typeof c === "number" && Number.isFinite(c)) out.push({ t, close: c });
  });
  return out;
}

/** Per-instance cache: history moves in 15-minute steps, so 5 minutes is plenty fresh. */
const seriesCache = new Map<string, { points: HistoryPoint[]; at: number }>();
const SERIES_TTL_MS = 5 * 60_000;
/** A refresh that fails serves the last good series this long, rather than a model. */
const STALE_OK_MS = 2 * 3600_000;
const WINDOW_MS = 48 * 3600_000;

/** Real basis history for the last 48h, or null if either source is unavailable. */
export async function realHistory(ticker: string, mint: string): Promise<HistoryPoint[] | null> {
  const hit = seriesCache.get(ticker);
  if (hit && Date.now() - hit.at < SERIES_TTL_MS) return hit.points;
  try {
    const [token, equity] = await Promise.all([tokenBars(mint), equityBars(ticker)]);
    const cutoff = Date.now() - WINDOW_MS;
    const points = alignBasis(token, equity).filter((p) => p.t >= cutoff);
    // Too sparse to show a shape is not history; let the caller fall back.
    if (points.length < 24) return staleOrNull(ticker);
    seriesCache.set(ticker, { points, at: Date.now() });
    return points;
  } catch {
    return staleOrNull(ticker);
  }
}

function staleOrNull(ticker: string): HistoryPoint[] | null {
  const hit = seriesCache.get(ticker);
  return hit && Date.now() - hit.at < STALE_OK_MS ? hit.points : null;
}
