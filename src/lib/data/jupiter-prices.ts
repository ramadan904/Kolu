/**
 * Live prices for both legs, from Jupiter, with no API key.
 *
 * Jupiter's price endpoint returns the on-chain token price *and* the
 * underlying share price for tokenized equities in the same response:
 *
 *   { "<mint>": { usdPrice: 333.96, stockData: { price: 334.875, updatedAt } } }
 *
 * That is the entire basis, live and free. It matters because the alternative
 * was a board that had to announce none of its numbers were real prices —
 * honest, and the fastest way to lose a reader's trust.
 *
 * The trade-off against Pyth is confidence: Pyth publishes an interval with
 * every price and Jupiter does not, so the noise floor here is an assumption
 * rather than a measurement. It is set deliberately wide and reported as
 * assumed, because a noise floor that is too tight turns rounding into a
 * signal — which is the failure this product is built to avoid.
 */

import { fetchJsonWithRetry } from "./http";
import type { FeedDescriptor, PriceReading, PriceSource } from "./types";
import { PriceSourceError } from "./types";
import { UNIVERSE } from "../universe";
import type { MintRegistry } from "../mints";

const DEFAULT_ENDPOINT = "https://lite-api.jup.ag";

/**
 * Assumed confidence, as a fraction of price, since Jupiter publishes none.
 * Wider than Pyth typically reports for these names: an assumed floor should
 * err towards calling a real gap noise, never the reverse.
 */
export const ASSUMED_CONFIDENCE_FRACTION = 0.0006;

interface PriceRow {
  usdPrice: number;
  stockPrice: number | null;
  stockUpdatedAt: number | null;
}

function readRow(value: unknown): PriceRow | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;

  const usdPrice = typeof rec.usdPrice === "number" ? rec.usdPrice : Number(rec.usdPrice);
  if (!Number.isFinite(usdPrice) || usdPrice <= 0) return null;

  const stock = rec.stockData;
  let stockPrice: number | null = null;
  let stockUpdatedAt: number | null = null;

  if (typeof stock === "object" && stock !== null) {
    const s = stock as Record<string, unknown>;
    const price = typeof s.price === "number" ? s.price : Number(s.price);
    if (Number.isFinite(price) && price > 0) stockPrice = price;

    if (typeof s.updatedAt === "string") {
      const parsed = Date.parse(s.updatedAt);
      if (Number.isFinite(parsed)) stockUpdatedAt = Math.floor(parsed / 1000);
    }
  }

  return { usdPrice, stockPrice, stockUpdatedAt };
}

export class JupiterPriceSource implements PriceSource {
  readonly kind = "jupiter" as const;

  private readonly endpoint: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly mints: MintRegistry;
  private readonly now: () => Date;

  constructor(options: {
    mints: MintRegistry;
    endpoint?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }) {
    this.mints = options.mints;
    this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl;
    this.now = options.now ?? (() => new Date());
  }

  /** Symbols map to mints, not to oracle feed ids — nothing to resolve. */
  async resolveFeeds(symbols: string[]): Promise<Map<string, FeedDescriptor>> {
    const out = new Map<string, FeedDescriptor>();
    for (const entry of UNIVERSE) {
      const mint = this.mints.tokens[entry.ticker]?.mint;
      if (!mint) continue;
      for (const symbol of [entry.equitySymbol, entry.tokenSymbol]) {
        if (!symbols.includes(symbol)) continue;
        out.set(symbol, { id: mint, symbol, assetType: "jupiter", displaySymbol: symbol });
      }
    }
    return out;
  }

  async getLatest(symbols: string[]): Promise<Map<string, PriceReading>> {
    const wanted = UNIVERSE.filter(
      (e) => symbols.includes(e.equitySymbol) || symbols.includes(e.tokenSymbol),
    );
    const mints = wanted
      .map((e) => this.mints.tokens[e.ticker]?.mint)
      .filter((m): m is string => typeof m === "string");

    if (mints.length === 0) {
      throw new PriceSourceError(
        "No token mints are configured, so Jupiter cannot be used as a price source.",
      );
    }

    const body = await fetchJsonWithRetry(
      `${this.endpoint}/price/v3?ids=${mints.join(",")}`,
      "Jupiter prices",
      {
        fetchImpl: this.fetchImpl,
        authHint: "Check JUPITER_ENDPOINT and that outbound requests to it are allowed.",
      },
    );

    if (typeof body !== "object" || body === null) {
      throw new PriceSourceError("Jupiter prices: expected an object keyed by mint");
    }

    const rows = body as Record<string, unknown>;
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const out = new Map<string, PriceReading>();

    for (const entry of wanted) {
      const mint = this.mints.tokens[entry.ticker]?.mint;
      if (!mint) continue;
      const row = readRow(rows[mint]);
      if (!row) continue;

      if (symbols.includes(entry.tokenSymbol)) {
        out.set(entry.tokenSymbol, {
          symbol: entry.tokenSymbol,
          feedId: mint,
          price: row.usdPrice,
          confidence: row.usdPrice * ASSUMED_CONFIDENCE_FRACTION,
          publishTime: nowSeconds,
          source: "jupiter",
        });
      }

      // The equity leg only exists for tokenized equities. A pair without
      // stockData is reported as missing rather than filled in with the token
      // price, which would make every basis exactly zero.
      if (symbols.includes(entry.equitySymbol) && row.stockPrice !== null) {
        out.set(entry.equitySymbol, {
          symbol: entry.equitySymbol,
          feedId: mint,
          price: row.stockPrice,
          confidence: row.stockPrice * ASSUMED_CONFIDENCE_FRACTION,
          // The venue's own timestamp, so a stale print reads as stale.
          publishTime: row.stockUpdatedAt ?? nowSeconds,
          source: "jupiter",
        });
      }
    }

    return out;
  }
}
