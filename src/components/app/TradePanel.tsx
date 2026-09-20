"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import type { BasisReading } from "@/lib/basis/compute";
import { computeEdge, DEFAULT_COSTS } from "@/lib/basis/edge";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { fmtBps, fmtUsd } from "@/lib/format";

const SIZES = [500, 2_000, 10_000, 50_000];

interface Quote {
  available: boolean;
  reason?: string;
  detail?: string;
  side?: "buy" | "sell";
  priceImpactBps?: number;
  route?: string[];
  outAmount?: string;
  outDecimals?: number;
  quote?: unknown;
}

type TxState =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "signing" }
  | { kind: "sending"; signature?: string }
  | { kind: "done"; signature: string }
  | { kind: "error"; message: string };

export function TradePanel({
  reading,
  hedgeable,
}: {
  reading: BasisReading;
  hedgeable: boolean;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [notional, setNotional] = useState(2_000);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [tx, setTx] = useState<TxState>({ kind: "idle" });

  // Selling when the token is rich, buying when it is cheap.
  const side: "buy" | "sell" = (reading.basisBps ?? 0) > 0 ? "sell" : "buy";

  useEffect(() => {
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({
            ticker: reading.ticker,
            notional: String(notional),
            side,
            price: String(reading.token?.price ?? 0),
          });
          const res = await fetch(`/api/quote?${params}`, { cache: "no-store" });
          const body = (await res.json()) as Quote;
          if (!cancelled) setQuote(body);
        } catch {
          if (!cancelled) setQuote({ available: false, detail: "Quote service unreachable." });
        } finally {
          if (!cancelled) setQuoting(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reading.ticker, reading.token?.price, notional, side]);

  const impactBps = quote?.available
    ? (quote.priceImpactBps ?? 0)
    : DEFAULT_COSTS.priceImpactBps;

  const edge = useMemo(
    () =>
      reading.basisBps === null
        ? null
        : computeEdge({
            basisBps: reading.basisBps,
            notionalUsd: notional,
            hedgeable,
            costs: { priceImpactBps: impactBps },
          }),
    [reading.basisBps, notional, hedgeable, impactBps],
  );

  const swap = useCallback(async () => {
    if (!publicKey || !signTransaction || !quote?.quote) return;
    setTx({ kind: "building" });
    try {
      const res = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote: quote.quote, userPublicKey: publicKey.toBase58() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Swap build failed (${res.status})`);

      setTx({ kind: "signing" });
      const raw = Buffer.from(body.swapTransaction as string, "base64");
      const transaction = VersionedTransaction.deserialize(raw);
      const signed = await signTransaction(transaction);

      setTx({ kind: "sending" });
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        maxRetries: 3,
        skipPreflight: false,
      });

      setTx({ kind: "sending", signature });
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        { signature, ...latest },
        "confirmed",
      );
      setTx({ kind: "done", signature });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Swap failed";
      setTx({
        kind: "error",
        message: /user rejected/i.test(message) ? "You cancelled the transaction." : message,
      });
    }
  }, [publicKey, signTransaction, quote, connection]);

  const busy = tx.kind === "building" || tx.kind === "signing" || tx.kind === "sending";
  const canSwap = connected && quote?.available === true && !busy;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between">
            <label
              htmlFor={`size-${reading.ticker}`}
              className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]"
            >
              Size
            </label>
            <span className="text-[12px] text-[var(--text-3)]">
              {side === "sell" ? `Sell ${reading.tokenTicker}` : `Buy ${reading.tokenTicker}`}
            </span>
          </div>

          <div className="mt-2 flex items-center rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--bg)] focus-within:border-[var(--accent)]">
            <span className="pl-3 text-[15px] text-[var(--text-3)]">$</span>
            <input
              id={`size-${reading.ticker}`}
              type="number"
              min={10}
              step={100}
              value={notional}
              onChange={(e) => setNotional(Math.max(10, Number(e.target.value) || 10))}
              className="num w-full bg-transparent px-2 py-2.5 text-[15px] outline-none"
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setNotional(size)}
                aria-pressed={notional === size}
                className={`num rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] transition-colors ${
                  notional === size
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-white"
                }`}
              >
                ${size >= 1000 ? `${size / 1000}k` : size}
              </button>
            ))}
          </div>
        </div>

        <dl className="space-y-2 text-[13px]">
          <Line label="Gross gap" value={edge ? fmtBps(edge.grossBps, 1) : "—"} />
          <Line
            label="Swap fees"
            value={edge ? `−${edge.breakdown[0].bps.toFixed(1)}bps` : "—"}
            muted
          />
          <Line
            label="Price impact"
            value={
              quoting
                ? "…"
                : edge
                  ? `−${edge.breakdown[1].bps.toFixed(1)}bps`
                  : "—"
            }
            muted
            hint={quote?.available ? "measured" : "assumed"}
          />
          <Line
            label="Network fee"
            value={edge ? `−${edge.breakdown[2].bps.toFixed(1)}bps` : "—"}
            muted
          />
        </dl>

        <div className="hairline flex items-baseline justify-between pt-3">
          <span className="text-[13px] font-medium">Net edge</span>
          <span className="text-right">
            <span
              className="num text-[22px] font-semibold"
              style={{
                color:
                  edge?.tone === "good"
                    ? "var(--down)"
                    : edge?.tone === "caution"
                      ? "var(--warn)"
                      : "var(--up)",
              }}
            >
              {edge ? fmtBps(edge.netBps, 1) : "—"}
            </span>
            <span className="num ml-2 text-[13px] text-[var(--text-2)]">
              {edge ? fmtUsd(edge.netUsd) : ""}
            </span>
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-[var(--radius)] bg-[var(--raised)] p-4">
          <div className="flex items-center gap-2">
            <Badge tone={hedgeable ? "accent" : "warn"}>
              {hedgeable ? "Hedgeable" : "Directional"}
            </Badge>
            {quote?.available && quote.route?.length ? (
              <span className="truncate text-[12px] text-[var(--text-3)]">
                via {quote.route.join(" → ")}
              </span>
            ) : null}
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--text-2)]">
            {edge?.caveat ?? "Set a size to price this trade."}
          </p>
        </div>

        {!quote?.available && !quoting && (
          <p className="text-[12px] leading-relaxed text-[var(--text-3)]">
            {quote?.reason === "mints_not_configured"
              ? "Routing is not enabled for this pair yet, so the price impact above is an assumption rather than a measured quote."
              : (quote?.detail ??
                "No live route right now, so the price impact above is an assumption rather than a measured quote.")}
          </p>
        )}

        <Button
          full
          size="lg"
          disabled={!canSwap}
          loading={busy}
          onClick={() => void swap()}
        >
          {!connected
            ? "Connect wallet to trade"
            : tx.kind === "building"
              ? "Building transaction"
              : tx.kind === "signing"
                ? "Approve in your wallet"
                : tx.kind === "sending"
                  ? "Confirming"
                  : !quote?.available
                    ? "Route unavailable"
                    : `${side === "sell" ? "Sell" : "Buy"} ${reading.tokenTicker}`}
        </Button>

        {tx.kind === "done" && (
          <p className="text-[13px] text-[var(--down)]">
            Filled.{" "}
            <a
              className="underline hover:text-white"
              href={`https://solscan.io/tx/${tx.signature}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              View on Solscan
            </a>
          </p>
        )}
        {tx.kind === "error" && (
          <p className="text-[13px] leading-relaxed text-[var(--up)]">{tx.message}</p>
        )}
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  muted,
  hint,
}: {
  label: string;
  value: string;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="flex items-baseline gap-1.5 text-[var(--text-2)]">
        {label}
        {hint && <span className="text-[11px] text-[var(--text-3)]">{hint}</span>}
      </dt>
      <dd className={`num ${muted ? "text-[var(--text-2)]" : "text-white"}`}>{value}</dd>
    </div>
  );
}
