/**
 * Pyth Hermes adapter.
 *
 * Feed ids are resolved by symbol at startup and cached for the process
 * lifetime, so nothing in this repo hardcodes a 32-byte hex id. Response
 * parsing is strict and fails with a message naming the field that was wrong,
 * because a silently mis-parsed exponent is a price off by a factor of 100 and
 * a basis number that looks tradeable and is not.
 */

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
}

export class PythSource implements PriceSource {
  readonly kind = "pyth" as const;

  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly feedCache = new Map<string, FeedDescriptor>();

  constructor(options: PythSourceOptions = {}) {
    this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  private async getJson(path: string): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        throw new PriceSourceError(`Hermes ${res.status} for ${path}`);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof PriceSourceError) throw err;
      throw new PriceSourceError(`Hermes request failed for ${path}`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Hermes' `/v2/price_feeds` search is a substring match over a large catalog,
   * so we query per symbol and keep only an exact symbol match. Anything else
   * risks pairing AAPL against a feed that merely contains "AAPL".
   */
  async resolveFeeds(symbols: string[]): Promise<Map<string, FeedDescriptor>> {
    const out = new Map<string, FeedDescriptor>();
    const missing: string[] = [];

    for (const symbol of symbols) {
      const cached = this.feedCache.get(symbol);
      if (cached) out.set(symbol, cached);
      else missing.push(symbol);
    }

    await Promise.all(
      missing.map(async (symbol) => {
        const query = encodeURIComponent(symbol.split("/")[0].split(".").pop() ?? symbol);
        const body = await this.getJson(`/v2/price_feeds?query=${query}`);
        if (!Array.isArray(body)) {
          throw new PriceSourceError("Hermes /v2/price_feeds: expected an array");
        }

        for (const item of body) {
          const rec = asRecord(item, "price_feeds entry");
          const attrs = asRecord(rec.attributes ?? {}, "price_feeds attributes");
          if (attrs.symbol !== symbol) continue;
          const id = rec.id;
          if (typeof id !== "string") {
            throw new PriceSourceError(`price_feeds entry for ${symbol}: id was not a string`);
          }
          const descriptor: FeedDescriptor = {
            id: normaliseId(id),
            symbol,
            assetType: typeof attrs.asset_type === "string" ? attrs.asset_type : "unknown",
            displaySymbol:
              typeof attrs.display_symbol === "string" ? attrs.display_symbol : null,
          };
          this.feedCache.set(symbol, descriptor);
          out.set(symbol, descriptor);
          return;
        }
        // Not an error: a tokenized twin may simply not have a feed yet. The
        // basis engine reports the pair as unavailable rather than guessing.
      }),
    );

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
