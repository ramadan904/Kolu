/**
 * What a wallet recently did with its xStocks, read from chain.
 *
 * Works from the balance deltas a transaction applied to accounts the wallet
 * owns, not from instruction parsing: a swap routed through six venues and a
 * plain transfer look the same from here — tokens left, tokens arrived — and
 * that is the level a trader thinks at. Only transactions that moved a
 * tracked xStock are reported; everything else in a busy wallet is skipped.
 */

export type ActivityKind = "bought" | "sold" | "received" | "sent";

export interface Activity {
  signature: string;
  /** Unix seconds, when the cluster knows it. */
  time: number | null;
  kind: ActivityKind;
  tokenTicker: string;
  tokenAmount: number;
  /** USDC on the other side of a swap; null for a plain transfer. */
  usdcAmount: number | null;
  failed: boolean;
}

interface TokenBalanceLike {
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null; amount?: string; decimals?: number };
}

/** The slice of a parsed transaction this reads — keeps it testable without a chain. */
export interface ParsedTxLike {
  blockTime?: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalanceLike[] | null;
    postTokenBalances?: TokenBalanceLike[] | null;
  } | null;
  transaction: { signatures: string[] };
}

function amountOf(b: TokenBalanceLike): number {
  if (b.uiTokenAmount.uiAmount !== null) return b.uiTokenAmount.uiAmount;
  const raw = Number(b.uiTokenAmount.amount ?? 0);
  return raw / 10 ** (b.uiTokenAmount.decimals ?? 0);
}

/** Net change per mint across every token account `owner` holds in this transaction. */
function deltas(tx: ParsedTxLike, owner: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of tx.meta?.preTokenBalances ?? []) {
    if (b.owner === owner) out.set(b.mint, (out.get(b.mint) ?? 0) - amountOf(b));
  }
  for (const b of tx.meta?.postTokenBalances ?? []) {
    if (b.owner === owner) out.set(b.mint, (out.get(b.mint) ?? 0) + amountOf(b));
  }
  return out;
}

/** Below this, a "change" is rounding in the RPC's ui amounts, not a movement. */
const DUST = 1e-9;

export function classify(
  tx: ParsedTxLike,
  owner: string,
  tokens: Record<string, string>,
  usdcMint: string | null,
): Activity | null {
  const d = deltas(tx, owner);
  // The xStock with the largest absolute movement is the subject.
  let subject: { mint: string; change: number } | null = null;
  for (const [mint, change] of d) {
    if (!(mint in tokens) || Math.abs(change) < DUST) continue;
    if (!subject || Math.abs(change) > Math.abs(subject.change)) subject = { mint, change };
  }
  if (!subject) return null;

  const usdc = usdcMint ? (d.get(usdcMint) ?? 0) : 0;
  const swapped =
    (subject.change > 0 && usdc < -DUST) || (subject.change < 0 && usdc > DUST);

  return {
    signature: tx.transaction.signatures[0],
    time: tx.blockTime ?? null,
    kind: swapped
      ? subject.change > 0
        ? "bought"
        : "sold"
      : subject.change > 0
        ? "received"
        : "sent",
    tokenTicker: tokens[subject.mint],
    tokenAmount: Math.abs(subject.change),
    usdcAmount: swapped ? Math.abs(usdc) : null,
    failed: tx.meta?.err != null,
  };
}

/** "3m ago", "2h ago", "4d ago" — relative to `now` (seconds). */
export function ago(time: number | null, now: number): string {
  if (time === null) return "";
  const s = Math.max(0, now - time);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
