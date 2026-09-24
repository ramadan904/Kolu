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
  /**
   * The largest USDC movement anywhere in the transaction, including hops the
   * wallet never touched. A swap paid in SOL usually routes through USDC, and
   * that leg is what the trade was worth at the moment it executed — the only
   * exact dollar figure such a transaction carries.
   */
  routeUsdcAmount: number | null;
  failed: boolean;
}

interface TokenBalanceLike {
  mint: string;
  owner?: string;
  accountIndex?: number;
  uiTokenAmount: { uiAmount: number | null; amount?: string; decimals?: number };
}

/** The slice of a parsed transaction this reads — keeps it testable without a chain. */
export interface ParsedTxLike {
  blockTime?: number | null;
  meta: {
    err: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: TokenBalanceLike[] | null;
    postTokenBalances?: TokenBalanceLike[] | null;
  } | null;
  transaction: {
    signatures: string[];
    message?: { accountKeys?: ({ pubkey: { toString(): string } | string } | string)[] };
  };
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
  // Every USDC account in the transaction, not only the wallet's own.
  let routeUsdc = 0;
  if (usdcMint) {
    const byAccount = new Map<number, number>();
    for (const b of tx.meta?.preTokenBalances ?? []) {
      if (b.mint === usdcMint && b.accountIndex !== undefined) {
        byAccount.set(b.accountIndex, (byAccount.get(b.accountIndex) ?? 0) - amountOf(b));
      }
    }
    for (const b of tx.meta?.postTokenBalances ?? []) {
      if (b.mint === usdcMint && b.accountIndex !== undefined) {
        byAccount.set(b.accountIndex, (byAccount.get(b.accountIndex) ?? 0) + amountOf(b));
      }
    }
    for (const change of byAccount.values()) routeUsdc = Math.max(routeUsdc, Math.abs(change));
  }
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
    routeUsdcAmount: routeUsdc > 0 ? routeUsdc : null,
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

const WSOL = "So11111111111111111111111111111111111111112";

/**
 * How much SOL `owner` really traded in this transaction, signed (negative =
 * spent), in SOL. Native SOL is not a token balance, so it is read from the
 * account's lamports, then corrected for what was not part of the trade: the
 * network fee, and the rent parked in any token account the transaction
 * created for the owner — on a $2 first buy that deposit alone is ~20% of the
 * trade, and would make the entry price a lie. Null when it cannot be read.
 */
export function nativeSolDelta(tx: ParsedTxLike, owner: string): number | null {
  const keys = tx.transaction.message?.accountKeys;
  const pre = tx.meta?.preBalances;
  const post = tx.meta?.postBalances;
  if (!keys || !pre || !post) return null;
  const name = (k: (typeof keys)[number]) =>
    typeof k === "string" ? k : typeof k.pubkey === "string" ? k.pubkey : k.pubkey.toString();
  const i = keys.findIndex((k) => name(k) === owner);
  if (i < 0 || pre[i] === undefined || post[i] === undefined) return null;
  let lamports = post[i] - pre[i];
  if (i === 0) lamports += tx.meta?.fee ?? 0; // the fee payer is always the first key
  const existed = new Set((tx.meta?.preTokenBalances ?? []).map((b) => b.accountIndex));
  for (const b of tx.meta?.postTokenBalances ?? []) {
    if (b.owner !== owner || b.mint === WSOL || b.accountIndex === undefined || existed.has(b.accountIndex)) continue;
    lamports += post[b.accountIndex] ?? 0; // rent deposit for a newly created account
  }
  return lamports / 1e9;
}
