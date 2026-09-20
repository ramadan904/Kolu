/**
 * Token account helpers.
 *
 * xStocks are Token-2022 and USDC is the original SPL Token program, so any
 * balance lookup that queries only one program silently reports zero for half
 * the portfolio — and a zero balance is indistinguishable from "you hold
 * none", which is exactly the wrong thing to tell someone before a trade.
 */

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface TokenBalance {
  mint: string;
  /** Human-readable amount, exponent already applied. */
  amount: number;
  decimals: number;
}

/**
 * Extracts balances from a `getParsedTokenAccountsByOwner` response.
 *
 * Written against the shape rather than the SDK's types so it can be tested
 * without a chain, and defensively because a malformed account must be skipped
 * rather than take the whole portfolio down with it.
 *
 * One owner can hold several accounts for the same mint, so amounts are summed
 * rather than overwritten — otherwise the balance shown is whichever account
 * happened to come back last.
 */
export function parseTokenBalances(accounts: unknown): Map<string, TokenBalance> {
  const out = new Map<string, TokenBalance>();
  const rows = Array.isArray(accounts)
    ? accounts
    : Array.isArray((accounts as { value?: unknown[] })?.value)
      ? (accounts as { value: unknown[] }).value
      : [];

  for (const row of rows) {
    const info = (row as { account?: { data?: { parsed?: { info?: unknown } } } })?.account?.data
      ?.parsed?.info as
      | { mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } }
      | undefined;

    const mint = info?.mint;
    const raw = info?.tokenAmount?.amount;
    const decimals = info?.tokenAmount?.decimals;

    if (typeof mint !== "string") continue;
    if (typeof decimals !== "number" || !Number.isInteger(decimals)) continue;

    const units = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
    if (!Number.isFinite(units)) continue;

    const amount = units / 10 ** decimals;
    const existing = out.get(mint);
    out.set(mint, {
      mint,
      decimals,
      amount: (existing?.amount ?? 0) + amount,
    });
  }

  return out;
}

/** Formats a token amount at a sensible precision for its size. */
export function fmtAmount(amount: number): string {
  if (amount === 0) return "0";
  if (amount < 0.001) return amount.toExponential(2);
  const dp = amount < 1 ? 6 : amount < 1000 ? 4 : 2;
  return amount.toLocaleString("en-US", { maximumFractionDigits: dp });
}
