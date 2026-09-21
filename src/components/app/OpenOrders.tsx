"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { parseOrder, type OpenOrder } from "@/lib/limit";
import { fmtUsd } from "@/lib/format";
import { fmtAmount } from "@/lib/tokens";
import { describeTradeError } from "@/lib/trade";
import { ORDERS_CHANGED_EVENT } from "./LimitOrder";
import type { MintMap } from "./TradePanel";
import { requestBalancesRefresh } from "./useBalances";

const POLL_MS = 60_000;

/** Active Jupiter limit orders for an address, re-read after a change and each minute. */
export function useOpenOrders(owner: string | null, mints: MintMap | null) {
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener(ORDERS_CHANGED_EVENT, refresh);
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    return () => {
      window.removeEventListener(ORDERS_CHANGED_EVENT, refresh);
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    if (!owner || !mints?.quote) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/trigger/orders?user=${owner}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Could not list orders");
        const tokens: Record<string, string> = {};
        for (const [ticker, { mint }] of Object.entries(mints.tokens)) tokens[mint] = `${ticker}X`;
        const parsed = (body.orders as unknown[])
          .map((o) => parseOrder(o as Parameters<typeof parseOrder>[0], tokens, mints.quote!.mint))
          .filter((o): o is OpenOrder => o !== null);
        if (!cancelled) {
          setOrders(parsed);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Could not read limit orders.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, mints, nonce]);

  return { orders, error, refresh };
}

/**
 * The address's open limit orders. Cancel is offered only when the connected
 * wallet is the maker — a watched address is read-only.
 */
export function OpenOrders({
  owner,
  orders,
  error,
  prices,
}: {
  owner: string;
  orders: OpenOrder[];
  error: string | null;
  /** Current token price by token ticker, to show how far each order is from filling. */
  prices: Record<string, number>;
}) {
  const { publicKey, signTransaction } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canCancel = publicKey?.toBase58() === owner && !!signTransaction;

  const cancel = async (order: OpenOrder) => {
    if (!publicKey || !signTransaction) return;
    setBusy(order.key);
    setMessage(null);
    try {
      const res = await fetch("/api/trigger/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maker: publicKey.toBase58(), order: order.key }),
      });
      const built = await res.json();
      if (!res.ok) throw new Error(built.error ?? "Cancel could not be built");
      const signed = await signTransaction(
        VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64")),
      );
      const exec = await fetch("/api/trigger/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signedTransaction: Buffer.from(signed.serialize()).toString("base64"),
          requestId: built.requestId,
        }),
      });
      const out = await exec.json();
      if (!exec.ok || out.status === "Failed") throw new Error(out.error ?? "Cancel failed on-chain");
      setMessage(`Cancelled — the order's funds are back in your wallet.`);
      window.dispatchEvent(new Event(ORDERS_CHANGED_EVENT));
      requestBalancesRefresh();
    } catch (err) {
      setMessage(describeTradeError(err, { slippageBps: 0, payUnit: "SOL" }));
    } finally {
      setBusy(null);
    }
  };

  if (orders.length === 0 && !error) return null;

  return (
    <div className="border-t border-[var(--border)] py-3">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
        Open limit orders
      </div>
      {error && <p className="text-[12px] text-[var(--text-3)]">{error}</p>}
      <ul className="space-y-1.5">
        {orders.map((o) => {
          const now = prices[o.ticker];
          const away = now ? ((o.limitPrice - now) / now) * 10_000 : null;
          return (
            <li key={o.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
              <span className="num">
                <span style={{ color: o.side === "buy" ? "var(--down)" : "var(--up)" }}>
                  {o.side === "buy" ? "Buy" : "Sell"}
                </span>{" "}
                {fmtAmount(o.tokensRemaining)} {o.ticker} at {fmtUsd(o.limitPrice)}
                {away !== null && (
                  <span className="text-[12px] text-[var(--text-3)]">
                    {" "}
                    · {Math.abs(away / 100).toFixed(2)}% {away < 0 ? "below" : "above"} now
                  </span>
                )}
                {o.expiresAt && (
                  <span className="text-[12px] text-[var(--text-3)]">
                    {" "}
                    · expires {new Date(o.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3 text-[12px]">
                <a
                  href={`https://solscan.io/account/${o.key}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[var(--text-3)] hover:text-white"
                >
                  ↗
                </a>
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => void cancel(o)}
                    disabled={busy !== null}
                    className="text-[var(--text-2)] underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
                  >
                    {busy === o.key ? "Approve in wallet…" : "Cancel"}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {message && <p className="mt-1.5 text-[12px] text-[var(--text-2)]">{message}</p>}
    </div>
  );
}
