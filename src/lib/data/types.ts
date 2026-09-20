/** A single price observation from an oracle. */
export interface PriceReading {
  /** Pyth symbol, e.g. `Equity.US.AAPL/USD`. */
  symbol: string;
  /** 32-byte hex feed id, resolved at runtime — never hardcoded in this repo. */
  feedId: string;
  /** Price in USD, exponent already applied. */
  price: number;
  /**
   * Pyth's confidence interval in USD, exponent applied. Treat the true price as
   * roughly `price ± confidence`; a basis smaller than the combined confidence
   * of both legs is noise, not signal.
   */
  confidence: number;
  /** Unix seconds when the publishers agreed this price. */
  publishTime: number;
  source: "pyth" | "jupiter" | "fixture";
}

export interface FeedDescriptor {
  id: string;
  symbol: string;
  assetType: string;
  displaySymbol: string | null;
}

/** Anything that can supply prices: live Hermes, or recorded fixtures. */
export interface PriceSource {
  readonly kind: "pyth" | "jupiter" | "fixture";
  /** Maps Pyth symbols to feed ids. Implementations should cache. */
  resolveFeeds(symbols: string[]): Promise<Map<string, FeedDescriptor>>;
  /** Latest price for each requested symbol. Missing symbols are omitted. */
  getLatest(symbols: string[]): Promise<Map<string, PriceReading>>;
}

export class PriceSourceError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PriceSourceError";
  }
}
