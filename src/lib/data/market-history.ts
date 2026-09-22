/**
 * Real basis history (48 hours to a week), from two public sources.
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

/**
 * Deepest pool per xStock, as found on GeckoTerminal (liquidity in USD at the
 * time). Liquidity ranking changes slowly, so a cold start uses these directly
 * — one request per pair instead of two, which is what keeps a burst of
 * visitors inside the free tier — and re-checks for a deeper pool hourly.
 */
export const KNOWN_POOLS: Record<string, string> = {
  TSLA: "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF", // ~$2.1M
  NVDA: "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6", // ~$2.2M
  SPY: "7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49", // ~$7.4M
  AAPL: "CKwJZwm7oj3nu4653N1EpDrqXbXAYXoPFiPeEnLouF8y", // ~$0.35M
  QQQ: "GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG", // ~$2.3M
  MSFT: "CLu4kFM4nb67xrdN7vJnMxXXir8Z5hA4HJUzPFccXjsL",
  META: "3L7KbPVaAQA4UTecaGQYsm6UCq5F3sZM9zAYkxqYt63j",
  AMZN: "6m5aXAve4uh6Kt4ytKyCLWNMjd8PYP5vujwNCtycrUiD",
  GOOGL: "B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw",
  COIN: "w7SGmPeXoMCsjvXqgsAmUn56uypyDsjAtsxeVkaiqxa",
  MSTR: "2ngTuP7xA581dqX9uJkGRqxmKuehY3k4SDfPebeoRG2J",
  CRCL: "GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV",
};

const poolCache = new Map<string, { pool: string; at: number }>();
const POOL_TTL_MS = 60 * 60_000;

async function deepestPool(mint: string, ticker?: string): Promise<string | null> {
  const hit = poolCache.get(mint);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.pool;
  const known = ticker ? KNOWN_POOLS[ticker] : undefined;
  if (known && !hit) {
    // Seed the cache so the first hour runs on one request per pair.
    poolCache.set(mint, { pool: known, at: Date.now() });
    return known;
  }
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

export async function tokenBars(mint: string, ticker?: string): Promise<PriceBar[]> {
  const pool = await deepestPool(mint, ticker).catch(() => (ticker ? (KNOWN_POOLS[ticker] ?? null) : null));
  if (!pool) return [];
  const body = (await getJson(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=15&limit=700&currency=usd&token=${mint}`,
  )) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (body.data?.attributes?.ohlcv_list ?? [])
    .filter((row) => row.length >= 5)
    .map((row) => ({ t: row[0], close: row[4] }));
}

export async function equityBars(ticker: string): Promise<PriceBar[]> {
  const body = (await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=15m&range=1mo&includePrePost=true`,
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
/** How far back anything is kept: a week always contains a weekend and five opens. */
export const MAX_WINDOW_MS = 7 * 24 * 3600_000;
export const DEFAULT_WINDOW_MS = 48 * 3600_000;

/**
 * Real basis history for the last `windowMs` (48h by default, up to 7 days),
 * or null if either source is unavailable. One fetch serves every window.
 */
export async function realHistory(
  ticker: string,
  mint: string,
  windowMs = DEFAULT_WINDOW_MS,
): Promise<HistoryPoint[] | null> {
  const full = await fullHistory(ticker, mint);
  if (!full) return null;
  const cutoff = Date.now() - Math.min(windowMs, MAX_WINDOW_MS);
  const points = full.filter((p) => p.t >= cutoff);
  // Too sparse to show a shape is not history; let the caller fall back.
  return points.length < 24 ? null : points;
}

async function fullHistory(ticker: string, mint: string): Promise<HistoryPoint[] | null> {
  const hit = seriesCache.get(ticker);
  if (hit && Date.now() - hit.at < SERIES_TTL_MS) return hit.points;
  try {
    const [token, equity] = await Promise.all([tokenBars(mint, ticker), equityBars(ticker)]);
    const cutoff = Date.now() - MAX_WINDOW_MS;
    const points = alignBasis(token, equity).filter((p) => p.t >= cutoff);
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

export interface GapContext {
  /** Share of the last 48h where |gap| was at or below today's |gap|, 0-100. */
  percentile: number;
  /** Median |gap| while the share could trade, and while it could not. */
  typicalOpenBps: number | null;
  typicalShutBps: number | null;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * How unusual today's gap is against this pair's own real history. Answers
 * the question that follows "what is the gap": is that normal for this name?
 * Only meaningful on real history — never computed from the modelled shape.
 */
export function gapContext(points: HistoryPoint[], currentBps: number): GapContext | null {
  if (points.length < 24) return null;
  const now = Math.abs(currentBps);
  const abs = points.map((p) => Math.abs(p.basisBps));
  const within = abs.filter((a) => a <= now).length;
  const shut = new Set(["closed", "weekend", "holiday"]);
  return {
    percentile: Math.round((within / abs.length) * 100),
    typicalOpenBps: median(points.filter((p) => p.phase === "regular").map((p) => Math.abs(p.basisBps))),
    typicalShutBps: median(points.filter((p) => shut.has(p.phase)).map((p) => Math.abs(p.basisBps))),
  };
}

/**
 * Rolling median over `window` points, centred. Thin pools print single trades
 * well off the book, so 15-minute closes bounce by tens of bps; a median keeps
 * the shape (widening while shut, snapping back at the open) and ignores the
 * lone prints, where a mean would be dragged by them.
 */
export function rollingMedian(points: HistoryPoint[], window = 4): HistoryPoint[] {
  const half = Math.floor(window / 2);
  return points.map((p, i) => {
    const slice = points.slice(Math.max(0, i - half), Math.min(points.length, i + half + 1)).map((q) => q.basisBps);
    slice.sort((a, b) => a - b);
    const m = Math.floor(slice.length / 2);
    const basisBps = slice.length % 2 ? slice[m] : (slice[m - 1] + slice[m]) / 2;
    return { ...p, basisBps };
  });
}

/** One point per `bucketMs`: the median of that bucket, with its session. */
export function downsample(points: HistoryPoint[], bucketMs = 3600_000): HistoryPoint[] {
  const buckets = new Map<number, HistoryPoint[]>();
  for (const p of points) {
    const k = Math.floor(p.t / bucketMs);
    const list = buckets.get(k) ?? [];
    list.push(p);
    buckets.set(k, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, list]) => {
      const vals = list.map((p) => p.basisBps).sort((a, b) => a - b);
      const m = Math.floor(vals.length / 2);
      return {
        t: k * bucketMs + bucketMs / 2,
        basisBps: vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2,
        phase: list[Math.floor(list.length / 2)].phase,
      };
    });
}

export interface OpenEvent {
  /** The regular-session open, unix ms. */
  t: number;
  /** Median gap in the hour before the open, against the last print. */
  beforeBps: number;
  /** Median gap 30-90 minutes after the open, once the share is trading. */
  afterBps: number;
  /** Share of the pre-open gap that was gone, 0-100 (negative if it widened). */
  closedPct: number;
}

/** An open counts as having closed the gap once at least a quarter of it is gone. */
export const NARROWED_PCT = 25;

/** Below this the pre-open gap is noise, and "how much closed" means nothing. */
export const MIN_OPEN_GAP_BPS = 15;

/**
 * Every regular-session open in the series, with the gap just before and just
 * after. This is the test of the thesis rather than the picture of it: if the
 * token only drifts because its reference is shut, the gap should shrink once
 * the share trades again. Opens with a pre-open gap inside the noise, or too
 * few trades either side to measure, are skipped rather than guessed.
 */
export function openEvents(points: HistoryPoint[]): OpenEvent[] {
  const out: OpenEvent[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].phase !== "regular" || points[i - 1].phase === "regular") continue;
    // The open itself: first regular bar, snapped back to the half hour.
    const t = Math.floor(points[i].t / 1_800_000) * 1_800_000;
    const window = (a: number, b: number) =>
      points.filter((p) => p.t >= t + a && p.t < t + b).map((p) => p.basisBps);
    const before = median(window(-3_600_000, 0));
    const afterVals = window(1_800_000, 5_400_000);
    const after = median(afterVals);
    if (before === null || after === null || afterVals.length < 2) continue;
    if (Math.abs(before) < MIN_OPEN_GAP_BPS) continue;
    out.push({
      t,
      beforeBps: before,
      afterBps: after,
      closedPct: Math.round((1 - Math.abs(after) / Math.abs(before)) * 100),
    });
  }
  return out;
}
