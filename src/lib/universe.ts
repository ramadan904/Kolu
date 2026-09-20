/**
 * The tradeable universe: an equity and its tokenized twin, paired.
 *
 * Deliberately short. Thin books make the basis untradeable, and a board of 60
 * tickers where 50 are untradeable is worse than a board of 12 that are. `core`
 * is what the dashboard shows by default; `extended` is opt-in.
 *
 * Feed ids are NOT listed here. They are resolved from Hermes by symbol at
 * runtime (see `lib/data/pyth.ts`) and cached, so this file stays readable and
 * cannot drift out of sync with the oracle.
 */

export type Tier = "core" | "extended";

export interface UniverseEntry {
  /** Underlying ticker, e.g. `AAPL`. */
  ticker: string;
  name: string;
  /** Ticker of the tokenized twin, e.g. `AAPLX`. */
  tokenTicker: string;
  /** Pyth symbol for the underlying equity. */
  equitySymbol: string;
  /** Pyth symbol for the tokenized twin. */
  tokenSymbol: string;
  tier: Tier;
  /**
   * SPL mint of the xStock, needed only for the execution leg. Left null until
   * verified against chain — a wrong mint routes a trade into the wrong asset,
   * so this is opt-in via `config/mints.json` rather than guessed here.
   */
  mint: string | null;
}

function entry(
  ticker: string,
  name: string,
  tier: Tier,
): UniverseEntry {
  const tokenTicker = `${ticker}X`;
  return {
    ticker,
    name,
    tokenTicker,
    equitySymbol: `Equity.US.${ticker}/USD`,
    tokenSymbol: `Crypto.${tokenTicker}/USD`,
    tier,
    mint: null,
  };
}

export const UNIVERSE: UniverseEntry[] = [
  entry("TSLA", "Tesla", "core"),
  entry("NVDA", "NVIDIA", "core"),
  entry("SPY", "S&P 500 ETF", "core"),
  entry("AAPL", "Apple", "core"),
  entry("QQQ", "Nasdaq 100 ETF", "core"),
  entry("MSFT", "Microsoft", "extended"),
  entry("META", "Meta Platforms", "extended"),
  entry("AMZN", "Amazon", "extended"),
  entry("GOOGL", "Alphabet", "extended"),
  entry("COIN", "Coinbase", "extended"),
  entry("MSTR", "MicroStrategy", "extended"),
  entry("CRCL", "Circle", "extended"),
];

export const CORE_UNIVERSE = UNIVERSE.filter((u) => u.tier === "core");

export function findEntry(ticker: string): UniverseEntry | undefined {
  const needle = ticker.toUpperCase();
  return UNIVERSE.find(
    (u) => u.ticker === needle || u.tokenTicker === needle,
  );
}

/** Every Pyth symbol the app needs, deduped. */
export function symbolsFor(entries: UniverseEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => [e.equitySymbol, e.tokenSymbol]))];
}
