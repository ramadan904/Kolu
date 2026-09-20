/**
 * Pyth Hermes adapter.
 *
 * Feed ids are resolved by symbol at startup and cached for the process
 * lifetime, so nothing in this repo hardcodes a 32-byte hex id. Response
 * parsing is strict and fails with a message naming the field that was wrong,
 * because a silently mis-parsed exponent is a price off by a factor of 100 and
 * a basis number that looks tradeable and is not.
 */

import { fetchJsonWithRetry, shortenUrl } from "./http";
import type {
  FeedDescriptor,
  PriceReading,
  PriceSource,
} from "./types";
import { PriceSourceError } from "./types";

const DEFAULT_ENDPOINT = "https://hermes.pyth.network";

/** Prices older than this are not shown as live. */
export const MAX_PRICE_AGE_SECONDS = 120;

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new PriceSourceError(`${context}: expected an object, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

/** Hermes returns price/conf as integer strings with a shared exponent. */
function scaled(raw: unknown, expo: unknown, context: string): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  const e = typeof expo === "string" ? Number(expo) : expo;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new PriceSourceError(`${context}: price was not a finite number`);
  }
  if (typeof e !== "number" || !Number.isFinite(e)) {
    throw new PriceSourceError(`${context}: exponent was not a finite number`);
  }
  return n * 10 ** e;
}

function normaliseId(id: string): string {
  return id.startsWith("0x") ? id.slice(2).toLowerCase() : id.toLowerCase();
}

export interface PythSourceOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** How long to remember that a symbol has no feed. Default 10 minutes. */
  negativeTtlMs?: number;
  /** Attempts per request, including the first. Default 3. */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Hermes has required authentication since August 2026. Without a key the
   * price endpoints return 401 while feed lookup still works, so the app
   * resolves every symbol and then cannot read a single price.
   */
  apiKey?: string;
}

/**
 * The ticker Hermes is searched by. `Equity.US.AAPL/USD` and `Crypto.AAPLX/USD`
 * yield "AAPL" and "AAPLX" — the former is a substring of the latter, which is
 * what lets one request serve both.
 */
export function queryKeyFor(symbol: string): string {
  return symbol.split("/")[0].split(".").pop() ?? symbol;
}

export class PythSource implements PriceSource {
  readonly kind = "pyth" as const;

  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly feedCache = new Map<string, FeedDescriptor>();
  /** symbol -> when we last confirmed Hermes has no feed for it. */
  private readonly negativeCache = new Map<string, number>();
  private readonly negativeTtlMs: number;
  private readonly attempts: number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly apiKey: string | null;

  constructor(options: PythSourceOptions = {}) {
    this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.negativeTtlMs = options.negativeTtlMs ?? 10 * 60_000;
    this.attempts = options.attempts ?? 3;
    this.sleep = options.sleep;
    this.apiKey = options.apiKey?.trim() || null;
  }

  /** True when a key is configured, for diagnostics. Never exposes the key. */
  get authenticated(): boolean {
    return this.apiKey !== null;
  }

  private async getJson(path: string): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    return fetchJsonWithRetry(url, `Hermes ${shortenUrl(url)}`, {
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      attempts: this.attempts,
      sleep: this.sleep,
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
    });
  }

  /**
   * Resolves Pyth symbols to feed ids.
   *
   * `/v2/price_feeds?query=` is a substring match over a large catalog, which
   * cuts both ways. Only an exact symbol match is ever accepted — otherwise
   * `AAPL` would happily bind to any feed whose name merely contains "AAPL".
   * But because it is a substring match, one request for "AAPL" also returns
   * AAPLX, so each response is scanned against every symbol still outstanding
   * and a pair usually costs one request rather than two.
   *
   * Symbols that resolve to nothing are remembered for a while. A tokenized
   * twin with no feed yet is a normal state, and without a negative cache the
   * board would re-ask Hermes about it on every single refresh, forever.
   */
  async resolveFeeds(symbols: string[]): Promise<Map<string, FeedDescriptor>> {
    const out = new Map<string, FeedDescriptor>();
    const unresolved = new Set<string>();
    const now = Date.now();

    for (const symbol of symbols) {
      const cached = this.feedCache.get(symbol);
      if (cached) {
        out.set(symbol, cached);
        continue;
      }
      const missedAt = this.negativeCache.get(symbol);
      if (missedAt !== undefined && now - missedAt < this.negativeTtlMs) continue;
      unresolved.add(symbol);
    }

    if (unresolved.size === 0) return out;

    const keys = [...new Set([...unresolved].map(queryKeyFor))];

    const absorb = (body: unknown) => {
      if (!Array.isArray(body)) {
        throw new PriceSourceError("Hermes /v2/price_feeds: expected an array");
      }
      for (const item of body) {
        const rec = asRecord(item, "price_feeds entry");
        const attrs = asRecord(rec.attributes ?? {}, "price_feeds attributes");
        const symbol = attrs.symbol;
        if (typeof symbol !== "string" || !unresolved.has(symbol)) continue;

        const id = rec.id;
        if (typeof id !== "string") {
          throw new PriceSourceError(`price_feeds entry for ${symbol}: id was not a string`);
        }

        const descriptor: FeedDescriptor = {
          id: normaliseId(id),
          symbol,
          assetType: typeof attrs.asset_type === "string" ? attrs.asset_type : "unknown",
          displaySymbol: typeof attrs.display_symbol === "string" ? attrs.display_symbol : null,
        };
        this.feedCache.set(symbol, descriptor);
        this.negativeCache.delete(symbol);
        out.set(symbol, descriptor);
        unresolved.delete(symbol);
      }
    };

    // A key is broad when no other key is a prefix of it: "AAPL" is broad,
    // "AAPLX" is not, because searching the former already returns the latter.
    const broad = keys.filter(
      (key) => !keys.some((other) => other !== key && key.startsWith(other)),
    );

    await Promise.all(
      broad.map(async (key) => {
        absorb(await this.getJson(`/v2/price_feeds?query=${encodeURIComponent(key)}`));
      }),
    );

    // Second pass: only the narrow keys the broad pass did not pick up for free.
    const remaining = [...new Set([...unresolved].map(queryKeyFor))].filter(
      (key) => !broad.includes(key),
    );
    await Promise.all(
      remaining.map(async (key) => {
        absorb(await this.getJson(`/v2/price_feeds?query=${encodeURIComponent(key)}`));
      }),
    );

    for (const symbol of unresolved) this.negativeCache.set(symbol, now);

    return out;
  }

  async getLatest(symbols: string[]): Promise<Map<string, PriceReading>> {
    const feeds = await this.resolveFeeds(symbols);
    if (feeds.size === 0) return new Map();

    const bySymbol = new Map([...feeds.values()].map((f) => [f.id, f.symbol]));
    const params = [...bySymbol.keys()]
      .map((id) => `ids[]=${encodeURIComponent(id)}`)
      .join("&");
    const body = await this.getJson(`/v2/updates/price/latest?${params}&parsed=true`);

    const parsed = asRecord(body, "updates/price/latest").parsed;
    if (!Array.isArray(parsed)) {
      throw new PriceSourceError("Hermes updates/price/latest: `parsed` was not an array");
    }

    const out = new Map<string, PriceReading>();
    for (const item of parsed) {
      const rec = asRecord(item, "price update");
      const id = typeof rec.id === "string" ? normaliseId(rec.id) : null;
      const symbol = id ? bySymbol.get(id) : undefined;
      if (!id || !symbol) continue;

      const price = asRecord(rec.price, `price update ${symbol}`);
      const publishTime = price.publish_time;
      if (typeof publishTime !== "number") {
        throw new PriceSourceError(`price update ${symbol}: publish_time was not a number`);
      }

      out.set(symbol, {
        symbol,
        feedId: id,
        price: scaled(price.price, price.expo, `price update ${symbol}`),
        confidence: scaled(price.conf, price.expo, `confidence ${symbol}`),
        publishTime,
        source: "pyth",
      });
    }
    return out;
  }
}
