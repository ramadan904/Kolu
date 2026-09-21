"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import type { BasisReading } from "@/lib/basis/compute";
import { Button } from "@/components/ui/Button";
import { fmtUsd } from "@/lib/format";
import { fmtAmount } from "@/lib/tokens";
import { EXAMPLE_WALLET } from "@/lib/known-wallets";
import { limitAmounts, MIN_ORDER_USD, type LimitSide } from "@/lib/limit";
import { describeTradeError } from "@/lib/trade";
import type { MintMap } from "./TradePanel";
import { requestBalancesRefresh } from "./useBalances";
import { WalletButton } from "./WalletButton";

const GAPS_BPS = [25, 50, 100, 200];
const EXPIRIES = [
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
  { label: "No expiry", seconds: 0 },
] as const;

export const ORDERS_CHANGED_EVENT = "kolu:orders-changed";

/**
 * A limit order that did not go through never moved funds: the order account
 * is only created if the transaction lands. Say that, and Jupiter's reason.
 */
function orderError(err: unknown, payUnit: string): string {
  const generic = describeTradeError(err, { slippageBps: 0, payUnit });
  if (/cancelled in your wallet|Not enough/.test(generic)) return generic;
  const reason = err instanceof Error ? err.message.replace(/\s+/g, " ").slice(0, 140) : "";
  return `The order was not placed — nothing left your wallet.${reason ? ` Jupiter said: ${reason}` : ""}`;
}

type State =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "signing" }
  | { kind: "sending" }
  | { kind: "placed"; order: string; signature: string | null }
  /** Signed and sent, but Jupiter has not confirmed it either way. */
  | { kind: "unconfirmed" }
  | { kind: "dry"; ok: boolean; message: string }
  | { kind: "error"; message: string };

async function createOrder(input: {
  ticker: string;
  side: LimitSide;
  maker: string;
  makingAmount: string;
  takingAmount: string;
  expiredAt?: number;
}) {
  const res = await fetch("/api/trigger/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Order could not be built (${res.status})`);
  return body as { transaction: string; requestId: string; order: string };
}

/**
 * "Buy TSLAX if it trades 0.5% under the real share" — a real Jupiter limit
 * order, held on-chain and filled by Jupiter's keepers while nobody watches.
 *
 * The target is a gap, but an order can only hold a price, so the limit is
 * fixed from the real share's price at placement. The summary says so in as
 * many words: if the share moves, the order does not move with it.
 */
export function LimitOrder({
  reading,
  side,
  sizeUsd,
  sizeValid,
  mints,
  shortfall,
  payUnit,
  children,
}: {
  reading: BasisReading;
  side: LimitSide;
  sizeUsd: number;
  sizeValid: boolean;
  mints: MintMap | null;
  shortfall: boolean;
  payUnit: string;
  children?: ReactNode;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const [gapBps, setGapBps] = useState(50);
  const [expiry, setExpiry] = useState<number>(EXPIRIES[1].seconds);
  const [state, setState] = useState<State>({ kind: "idle" });

  const equity = reading.equity?.price ?? 0;
  const token = reading.token?.price ?? 0;
  const tokenMint = mints?.tokens[reading.ticker];
  const amounts = useMemo(
    () =>
      tokenMint && mints?.quote
        ? limitAmounts({
            side,
            sizeUsd,
            equityPrice: equity,
            tokenPrice: token,
            gapBps,
            tokenDecimals: tokenMint.decimals,
            usdcDecimals: mints.quote.decimals,
          })
        : null,
    [side, sizeUsd, equity, token, gapBps, tokenMint, mints],
  );

  const tooSmall = sizeValid && sizeUsd < MIN_ORDER_USD;
  // Where the token trades now against the limit: an order already on the
  // right side of it would fill at once, which is a market order in disguise.
  const fillsNow =
    amounts !== null && (side === "buy" ? token <= amounts.limitPrice : token >= amounts.limitPrice);
  const busy = state.kind === "building" || state.kind === "signing" || state.kind === "sending";
  const expiredAt = expiry ? Math.floor(Date.now() / 1000) + expiry : undefined;

  const reset = () => setState({ kind: "idle" });

  const dryRun = useCallback(async () => {
    if (!amounts) return;
    setState({ kind: "building" });
    try {
      const built = await createOrder({
        ticker: reading.ticker,
        side,
        maker: EXAMPLE_WALLET.address,
        makingAmount: amounts.makingAmount,
        takingAmount: amounts.takingAmount,
        expiredAt,
      });
      const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      });
      setState({
        kind: "dry",
        ok: !sim.value.err,
        message: sim.value.err
          ? `The order transaction failed simulation: ${JSON.stringify(sim.value.err)}`
          : `The exact order transaction simulates cleanly on mainnet (${Math.round((sim.value.unitsConsumed ?? 0) / 1000)}k compute units). Simulated from the ${EXAMPLE_WALLET.label}, a public wallet — nothing was signed or sent.`,
      });
    } catch (err) {
      setState({ kind: "dry", ok: false, message: err instanceof Error ? err.message : "Dry run failed." });
    }
  }, [amounts, reading.ticker, side, expiredAt, connection]);

  const place = useCallback(async () => {
    if (!amounts || !publicKey || !signTransaction) return;
    try {
      setState({ kind: "building" });
      const built = await createOrder({
        ticker: reading.ticker,
        side,
        maker: publicKey.toBase58(),
        makingAmount: amounts.makingAmount,
        takingAmount: amounts.takingAmount,
        expiredAt,
      });
      const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
      setState({ kind: "signing" });
      const signed = await signTransaction(tx);
      setState({ kind: "sending" });
      const res = await fetch("/api/trigger/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signedTransaction: Buffer.from(signed.serialize()).toString("base64"),
          requestId: built.requestId,
        }),
      });
      const out = await res.json();
      if (res.status === 202 || out.status === "Unconfirmed") {
        setState({ kind: "unconfirmed" });
        window.dispatchEvent(new Event(ORDERS_CHANGED_EVENT));
        return;
      }
      if (!res.ok || out.status === "Failed") {
        throw new Error(out.error ?? `Order failed on-chain${out.signature ? ` (${out.signature})` : ""}`);
      }
      setState({ kind: "placed", order: built.order, signature: out.signature ?? null });
      window.dispatchEvent(new Event(ORDERS_CHANGED_EVENT));
      requestBalancesRefresh();
    } catch (err) {
      setState({ kind: "error", message: orderError(err, payUnit) });
    }
  }, [amounts, publicKey, signTransaction, reading.ticker, side, expiredAt, payUnit]);

  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
  const verb = side === "buy" ? "Buy" : "Sell";

  return (
    <>
      <div className="mt-6 space-y-5">
        <section>
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
              Fill when {reading.tokenTicker} trades
            </span>
            <span className="text-[11px] text-[var(--text-3)]">
              {side === "buy" ? "under" : "over"} the real share
            </span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {GAPS_BPS.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => {
                  setGapBps(bps);
                  reset();
                }}
                aria-pressed={gapBps === bps}
                disabled={busy}
                className={`num rounded-[var(--radius-sm)] border py-2 text-[13px] transition-colors ${
                  gapBps === bps
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-white"
                }`}
              >
                {side === "buy" ? "−" : "+"}
                {pct(bps)}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">Expires</span>
          <div className="flex gap-1.5">
            {EXPIRIES.map((e) => (
              <button
                key={e.label}
                type="button"
                onClick={() => {
                  setExpiry(e.seconds);
                  reset();
                }}
                aria-pressed={expiry === e.seconds}
                disabled={busy}
                className={`rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] transition-colors ${
                  expiry === e.seconds
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-white"
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </section>

        {amounts && (
          <section className="rounded-[var(--radius)] bg-[var(--raised)] p-4 text-[13px] leading-relaxed">
            <p className="text-white">
              {verb}s{" "}
              <span className="num">
                {fmtAmount(amounts.tokens)} {reading.tokenTicker}
              </span>{" "}
              if it trades at or {side === "buy" ? "below" : "above"}{" "}
              <span className="num font-medium">{fmtUsd(amounts.limitPrice)}</span> —{" "}
              <span className="num">{pct(gapBps)}</span> {side === "buy" ? "under" : "over"} the real
              share&rsquo;s <span className="num">{fmtUsd(equity)}</span> now.
            </p>
            <p className="num mt-1 text-[var(--text-2)]">
              {side === "buy" ? "Pays" : "Receives"} {fmtAmount(amounts.usdc)} USDC at the limit ·
              token trades at {fmtUsd(token)} now
            </p>
            <p className="mt-2 text-[12px] text-[var(--text-3)]">
              Held and filled on-chain by Jupiter, even with Kolu closed. The limit is fixed from
              today&rsquo;s share price — if the share moves, the order does not move with it.
            </p>
          </section>
        )}

        {fillsNow && (
          <p className="text-[12px] leading-relaxed text-[var(--warn)]">
            {reading.tokenTicker} already trades {side === "buy" ? "below" : "above"} this limit, so the
            order would fill at once — use <span className="font-medium">Now</span> instead, or widen
            the gap.
          </p>
        )}
        {tooSmall && (
          <p className="text-[12px] text-[var(--warn)]">
            Jupiter holds limit orders of at least {fmtUsd(MIN_ORDER_USD, 0)}.
          </p>
        )}
      </div>

      {children && <div className="mt-8">{children}</div>}

      <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-8 border-t border-[var(--border)] bg-[var(--surface)] px-5 pt-4 pb-5 sm:-mx-6 sm:px-6">
        {state.kind === "unconfirmed" ? (
          <div className="rounded-[var(--radius)] border border-[var(--warn)]/25 bg-[var(--warn-soft)] px-4 py-3.5" role="status">
            <div className="text-[14px] font-medium text-[var(--warn)]">Sent — not confirmed yet</div>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)]">
              Jupiter has the signed order but has not confirmed it. It may still land. Check
              Open limit orders under Your position in a minute before placing it again, or you
              could end up with two.
            </p>
            <button type="button" onClick={reset} className="mt-2 text-[12px] text-[var(--text-2)] hover:text-white">
              I&rsquo;ve checked · new order
            </button>
          </div>
        ) : state.kind === "placed" ? (
          <div className="rounded-[var(--radius)] border border-[var(--down)]/25 bg-[var(--down-soft)] px-4 py-3.5" role="status">
            <div className="text-[14px] font-medium text-[var(--down)]">Limit order placed</div>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)]">
              It fills on-chain when {reading.tokenTicker} reaches {amounts ? fmtUsd(amounts.limitPrice) : "the limit"}
              {expiry ? "" : ", with no expiry"}. It is listed under Your position, where you can cancel it.
            </p>
            <div className="mt-2 flex gap-4 text-[12px]">
              {state.signature && (
                <a
                  className="text-white underline-offset-2 hover:underline"
                  href={`https://solscan.io/tx/${state.signature}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View on Solscan
                </a>
              )}
              <button type="button" onClick={reset} className="text-[var(--text-2)] hover:text-white">
                Place another
              </button>
            </div>
          </div>
        ) : (
          <>
            {state.kind === "error" && (
              <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--up)]/25 bg-[var(--up-soft)] px-3.5 py-2.5 text-[13px]" role="alert">
                {state.message}
              </div>
            )}
            {state.kind === "dry" && (
              <div
                className={`mb-3 rounded-[var(--radius-sm)] border px-3.5 py-2.5 text-[12px] leading-relaxed ${
                  state.ok
                    ? "border-[var(--down)]/25 bg-[var(--down-soft)] text-[var(--text-2)]"
                    : "border-[var(--up)]/25 bg-[var(--up-soft)]"
                }`}
                role="status"
              >
                <span className={`font-medium ${state.ok ? "text-[var(--down)]" : ""}`}>
                  {state.ok ? "Dry run passed. " : "Dry run failed. "}
                </span>
                {state.message}
              </div>
            )}
            {shortfall && connected && (
              <p className="mb-3 text-[12px] text-[var(--warn)]">Not enough {payUnit} for this order.</p>
            )}

            {!connected ? (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <WalletButton size="lg" full dropUp label="Connect wallet to place" />
                <Button
                  size="lg"
                  variant="secondary"
                  loading={busy}
                  disabled={!amounts || tooSmall || busy}
                  onClick={() => void dryRun()}
                >
                  Dry run
                </Button>
              </div>
            ) : (
              <Button
                full
                size="lg"
                loading={busy}
                disabled={!amounts || !sizeValid || tooSmall || shortfall || fillsNow || busy}
                onClick={() => void place()}
              >
                {state.kind === "building"
                  ? "Preparing order"
                  : state.kind === "signing"
                    ? "Approve in your wallet"
                    : state.kind === "sending"
                      ? "Placing on-chain"
                      : amounts
                        ? `Place limit · ${verb} at ${fmtUsd(amounts.limitPrice)}`
                        : "Enter a size"}
              </Button>
            )}
            <p className="mt-2 text-[11px] text-[var(--text-3)]">
              Jupiter limit order · only your wallet can sign, place or cancel it
            </p>
          </>
        )}
      </div>
    </>
  );
}
