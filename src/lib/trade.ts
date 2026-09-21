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
    return "The quote expired before the swap landed. Nothing was filled — retry for a fresh quote.";
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
