/**
 * Pure helpers behind the trade ticket and the portfolio.
 *
 * Kept out of the components so the rules — what a failure means, what a
 * holding is exposed to — are testable without a wallet or a chain.
 */

/**
 * One sentence a trader can act on, for any way a swap can fail.
 *
 * Raw wallet and RPC errors are written for developers ("custom program error:
 * 0x1771"). Every message here says two things: what happened, and whether any
 * money moved — because the second question is the one someone actually has.
 */
export function describeTradeError(
  err: unknown,
  ctx: { slippageBps: number; payUnit: string },
): string {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);

  if (/user rejected|rejected the request|declined|cancel/i.test(msg)) {
    return "You cancelled in your wallet. Nothing was sent.";
  }
  // Jupiter's SlippageToleranceExceeded is custom program error 6001 / 0x1771.
  if (/0x1771|\b6001\b|slippage/i.test(msg)) {
    return `The price moved more than your ${(ctx.slippageBps / 100).toFixed(1)}% limit before the swap landed, so nothing was filled. Retry, or allow more slippage.`;
  }
  if (/insufficient lamports|insufficient funds for (fee|rent)|debit an account but found no record/i.test(msg)) {
    return "Not enough SOL to pay the network fee. Keep about 0.01 SOL in this wallet.";
  }
  // SPL token program InsufficientFunds is custom program error 0x1.
  if (/custom program error: 0x1\b|insufficient funds/i.test(msg)) {
    return `Not enough ${ctx.payUnit} for this size. Nothing was filled.`;
  }
  if (/blockhash not found|block height exceeded|expired/i.test(msg)) {
    return "The swap never landed and has now expired. Nothing was filled — retry for a fresh quote.";
  }
  if (/429|rate limit/i.test(msg)) {
    return "The network is rate limiting requests. Wait a few seconds and retry.";
  }
  if (/swap build failed|could not find any route|no route/i.test(msg)) {
    return "No route could be built at this size. Try a smaller size.";
  }
  return "The swap did not go through. Nothing was filled and your balances are unchanged.";
}

/**
 * What a holding gains or loses if the token converges to the real share.
 *
 * Holding a rich token, convergence costs you; holding a cheap one, it pays.
 * This assumes the token moves to the equity rather than the reverse — the
 * usual resolution at the open, and the one a holder is exposed to.
 */
export function convergenceUsd(amount: number, tokenPrice: number, equityPrice: number): number {
  if (!(amount > 0) || !(tokenPrice > 0) || !(equityPrice > 0)) return 0;
  return amount * (equityPrice - tokenPrice);
}

/** Converts an integer base-unit string to a human amount. */
export function fromBaseUnits(raw: string | undefined, decimals: number | undefined): number | null {
  if (raw === undefined || decimals === undefined) return null;
  const units = Number(raw);
  return Number.isFinite(units) ? units / 10 ** decimals : null;
}

/**
 * Jupiter's swap instruction returns the amount it delivered as a little-endian
 * u64 in the transaction's return data. Reading it from a simulation gives the
 * output the exact transaction would produce on mainnet right now — a stronger
 * number than the quote it was built from.
 */
export function decodeU64Base64(b64: string | undefined | null): bigint | null {
  if (!b64) return null;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  if (bin.length < 8) return null;
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(bin.charCodeAt(i));
  return value;
}

const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

/**
 * The amount Jupiter delivered, from a simulation. Read from Jupiter's own
 * "Program return" log line first: the transaction-level returnData holds
 * whichever program returned last, and a route that ends by closing an account
 * overwrites it. Falls back to returnData only when it is Jupiter's.
 */
export function jupiterOutAmount(
  logs: string[] | null | undefined,
  returnData?: { programId: string; data: [string, string] | string[] } | null,
): bigint | null {
  const prefix = `Program return: ${JUPITER_V6} `;
  for (let i = (logs?.length ?? 0) - 1; i >= 0; i -= 1) {
    const line = logs![i];
    if (line.startsWith(prefix)) return decodeU64Base64(line.slice(prefix.length).trim());
  }
  if (returnData?.programId === JUPITER_V6) return decodeU64Base64(returnData.data?.[0]);
  return null;
}

/**
 * Price impact a quote can honestly claim. Jupiter reports its own
 * `priceImpactPct`, which on multi-hop routes occasionally spikes far above
 * what the same quote's amounts imply — a $2k clip once read 70bps of impact
 * while it delivered within 55bps of mid. Impact cannot exceed the quote's
 * whole realised cost against the mid price (that cost already includes it),
 * so the smaller of the two is used; a fill better than mid claims none.
 */
export function boundedImpactBps(p: {
  reportedBps: number;
  side: "buy" | "sell";
  /** USDC in for a buy, tokens in for a sell. */
  inAmount: number;
  /** Tokens out for a buy, USDC out for a sell. */
  outAmount: number;
  /** Token mid price, USD. */
  price: number;
}): number {
  const reported = Math.max(0, p.reportedBps);
  if (!(p.price > 0) || !(p.inAmount > 0) || !(p.outAmount > 0)) return reported;
  const usdIn = p.side === "buy" ? p.inAmount : p.inAmount * p.price;
  const usdOut = p.side === "buy" ? p.outAmount * p.price : p.outAmount;
  const realised = (1 - usdOut / usdIn) * 10_000;
  if (!Number.isFinite(realised)) return reported;
  return Math.min(reported, Math.max(0, realised));
}
