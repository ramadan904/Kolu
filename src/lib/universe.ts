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

/**
 * How a ticker becomes a Pyth symbol.
 *
 * These are templates rather than literals because the tokenized-twin naming is
 * the one thing about this integration that cannot be verified without calling
 * Hermes. If the convention differs from `Crypto.AAPLX/USD`, that must be a
 * configuration change on a running deployment — not a code edit and a
 * redeploy. `{TICKER}` is replaced with the underlying ticker, `{TOKEN}` with
 * the tokenized ticker.
 *
 * `npm run sync-feeds` reports which template actually resolves.
 */
export const DEFAULT_EQUITY_TEMPLATE = "Equity.US.{TICKER}/USD";
export const DEFAULT_TOKEN_TEMPLATE = "Crypto.{TOKEN}/USD";
export const DEFAULT_TOKEN_TICKER_TEMPLATE = "{TICKER}X";

function template(envVar: string, fallback: string): string {
  const value = process.env[envVar]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export function applyTemplate(
  tpl: string,
  ticker: string,
  tokenTicker: string,
): string {
  return tpl.replaceAll("{TICKER}", ticker).replaceAll("{TOKEN}", tokenTicker);
}

export function tokenTickerFor(ticker: string): string {
  return applyTemplate(
    template("KOLU_TOKEN_TICKER_TEMPLATE", DEFAULT_TOKEN_TICKER_TEMPLATE),
    ticker,
    "",
  );
}

export function symbolsForTicker(ticker: string): {
  tokenTicker: string;
  equitySymbol: string;
  tokenSymbol: string;
} {
  const tokenTicker = tokenTickerFor(ticker);
  return {
    tokenTicker,
    equitySymbol: applyTemplate(
      template("KOLU_EQUITY_SYMBOL_TEMPLATE", DEFAULT_EQUITY_TEMPLATE),
      ticker,
      tokenTicker,
    ),
    tokenSymbol: applyTemplate(
      template("KOLU_TOKEN_SYMBOL_TEMPLATE", DEFAULT_TOKEN_TEMPLATE),
      ticker,
      tokenTicker,
    ),
  };
}

function entry(ticker: string, name: string, tier: Tier): UniverseEntry {
  const { tokenTicker, equitySymbol, tokenSymbol } = symbolsForTicker(ticker);
  return { ticker, name, tokenTicker, equitySymbol, tokenSymbol, tier, mint: null };
}

const TICKERS: [string, string, Tier][] = [
  ["TSLA", "Tesla", "core"],
  ["NVDA", "NVIDIA", "core"],
  ["SPY", "S&P 500 ETF", "core"],
  ["AAPL", "Apple", "core"],
  ["QQQ", "Nasdaq 100 ETF", "core"],
  ["MSFT", "Microsoft", "extended"],
  ["META", "Meta Platforms", "extended"],
  ["AMZN", "Amazon", "extended"],
  ["GOOGL", "Alphabet", "extended"],
  ["COIN", "Coinbase", "extended"],
  ["MSTR", "MicroStrategy", "extended"],
  ["CRCL", "Circle", "extended"],
];

/**
 * Built once per process. Templates come from the environment, which on a
 * serverless host is fixed for the lifetime of an instance, so rebuilding per
 * request would only cost work.
 */
export const UNIVERSE: UniverseEntry[] = TICKERS.map(([ticker, name, tier]) =>
  entry(ticker, name, tier),
);

export const CORE_UNIVERSE = UNIVERSE.filter((u) => u.tier === "core");

/** Rebuilds the universe from the current environment. For tests. */
export function buildUniverse(): UniverseEntry[] {
  return TICKERS.map(([ticker, name, tier]) => entry(ticker, name, tier));
}

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
