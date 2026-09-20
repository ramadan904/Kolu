/**
 * Basis history recorded in the viewer's own browser.
 *
 * Server-side history does not survive on a serverless host: each request may
 * land on a fresh instance, so an in-process buffer never accumulates past a
 * single point and the chart has nothing to draw. Persisting it server-side
 * would mean provisioning a store; persisting it here means the readings a
 * viewer has actually seen are the readings they keep.
 *
 * These points are genuinely observed — this browser watched the board return
 * them. That is a weaker claim than a market data feed and a much stronger one
 * than a model, so the chart distinguishes them from modelled context rather
 * than blending the two.
 */

export interface ClientPoint {
  t: number;
  basisBps: number;
}

const KEY = "kolu.history.v1";
/** 48h at one point per minute, capped so storage cannot grow without bound. */
const MAX_POINTS = 2880;
const MIN_GAP_MS = 45_000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

type Store = Record<string, ClientPoint[]>;

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Quota or a blocked storage API. History is a convenience; losing it must
    // never take the board down with it.
  }
}

export function isPoint(value: unknown): value is ClientPoint {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.t === "number" &&
    Number.isFinite(p.t) &&
    typeof p.basisBps === "number" &&
    Number.isFinite(p.basisBps)
  );
}

/** Drops malformed entries, anything older than the window, and enforces the cap. */
export function prune(points: unknown, now: number): ClientPoint[] {
  const rows = Array.isArray(points) ? points.filter(isPoint) : [];
  const fresh = rows
    .filter((p) => now - p.t <= MAX_AGE_MS && p.t <= now + 60_000)
    .sort((a, b) => a.t - b.t);
  return fresh.length > MAX_POINTS ? fresh.slice(fresh.length - MAX_POINTS) : fresh;
}

export function record(ticker: string, basisBps: number, now = Date.now()): void {
  if (!Number.isFinite(basisBps)) return;
  const store = read();
  const points = prune(store[ticker], now);
  const last = points[points.length - 1];

  // The board polls far more often than the chart needs.
  if (last && now - last.t < MIN_GAP_MS) return;

  points.push({ t: now, basisBps });
  store[ticker] = points;
  write(store);
}

export function observed(ticker: string, now = Date.now()): ClientPoint[] {
  return prune(read()[ticker], now);
}

/** Minutes of real history held for a ticker. */
export function observedMinutes(ticker: string, now = Date.now()): number {
  const points = observed(ticker, now);
  if (points.length < 2) return 0;
  return Math.round((points[points.length - 1].t - points[0].t) / 60_000);
}

export function clearHistory(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
