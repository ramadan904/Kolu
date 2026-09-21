"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { BasisReading } from "@/lib/basis/compute";
import { sideForGap } from "@/lib/basis/edge";
import type { MintMap, Side } from "./TradePanel";
import { useBalances } from "./useBalances";
import { fmtPct, fmtUsd } from "@/lib/format";
import { fmtAmount } from "@/lib/tokens";
import { convergenceUsd } from "@/lib/trade";
import { Spinner } from "@/components/ui/Button";

interface Holding {
  reading: BasisReading;
  amount: number;
  value: number;
  /** What this holding gains or loses if the token converges to the real share. */
  convergence: number | null;
}

const LABEL = "text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]";

/**
 * What the connected wallet is actually holding, valued at the board's prices.
 *
 * Without this, connecting a wallet is a cosmetic act: the address appears and
 * nothing about the product changes. Holdings are also what turns a gap from a
 * statistic into a position — a 170bps premium reads differently when you are
 * the one holding the rich side, so every row says what the gap is worth to
 * this wallet, and offers the trade that acts on it.
 */
export function Portfolio({
  readings,
  mints,
  onTrade,
}: {
  readings: BasisReading[];
  mints: MintMap | null;
  onTrade: (ticker: string, side: Side) => void;
}) {
  const { connected, publicKey } = useWallet();
  const { balances, loading, refreshing, error, updatedAt, refresh } = useBalances();

  const holdings = useMemo<Holding[]>(() => {
    if (!mints) return [];
    return readings
      .map((r) => {
        const mint = mints.tokens[r.ticker]?.mint;
        const amount = mint ? (balances.get(mint)?.amount ?? 0) : 0;
        const price = r.token?.price ?? 0;
        return {
          reading: r,
          amount,
          value: amount * price,
          convergence:
            r.token && r.equity ? convergenceUsd(amount, r.token.price, r.equity.price) : null,
        };
      })
      .filter((h) => h.amount > 0)
      .sort((a, b) => b.value - a.value);
  }, [readings, balances, mints]);

  // Rendering nothing until a wallet connects means the section is invisible to
  // everyone evaluating the product. It states what it will show instead.
  if (!connected || !publicKey) {
    return (
      <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div>
          <div className={LABEL}>Your position</div>
          <p className="mt-1 text-[13px] text-[var(--text-2)]">
            Connect a wallet to value your xStocks against the live gaps below.
          </p>
        </div>
        <span className="text-[12px] text-[var(--text-3)]">Read-only · nothing is signed</span>
      </div>
    );
  }

  if (loading && updatedAt === null) {
    return (
      <div className="panel mb-5 px-4 py-3.5" aria-busy="true">
        <div className="flex items-center gap-2.5 text-[13px] text-[var(--text-3)]">
          <Spinner />
          Reading your wallet
        </div>
        <div className="mt-3 space-y-2">
          <div className="skeleton h-8" />
          <div className="skeleton h-8 w-3/4" />
        </div>
      </div>
    );
  }

  if (error && updatedAt === null) {
    return (
      <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]">
        <span className="text-[var(--text-2)]">{error}</span>
        <button
          type="button"
          onClick={refresh}
          className="text-[var(--text-2)] transition-colors hover:text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  const cash = mints?.quote ? (balances.get(mints.quote.mint)?.amount ?? 0) : 0;
  const invested = holdings.reduce((sum, h) => sum + h.value, 0);
  const exposure = holdings.reduce((sum, h) => sum + (h.convergence ?? 0), 0);
  const address = publicKey.toBase58();

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className={LABEL}>Your position</div>
          <div className="display mt-1 text-[26px] leading-none">{fmtUsd(invested + cash)}</div>
        </div>
        <Stat label="xStocks" value={fmtUsd(invested)} />
        <Stat label="USDC" value={fmtUsd(cash)} />
        {holdings.length > 0 && (
          <Stat
            label="If gaps close"
            value={signedUsd(exposure)}
            color={pnlColor(exposure)}
            title="Change in the value of your xStocks if every token converged to its real share price now."
          />
        )}
      </div>

      <div className="flex items-center gap-3 text-[12px] text-[var(--text-3)]">
        <Freshness updatedAt={updatedAt} refreshing={refreshing} failed={error !== null} />
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="transition-colors hover:text-white disabled:opacity-50"
        >
          Refresh
        </button>
        <a
          href={`https://solscan.io/account/${address}`}
          target="_blank"
          rel="noreferrer noopener"
          className="num transition-colors hover:text-white"
        >
          {address.slice(0, 4)}…{address.slice(-4)} ↗
        </a>
      </div>
    </div>
  );

  if (holdings.length === 0) {
    const entry = deepestDiscount(readings);
    return (
      <div className="panel mb-5 px-4 py-3.5">
        {header}
        <div className="hairline mt-3.5 flex flex-wrap items-center justify-between gap-3 pt-3.5">
          <p className="max-w-[560px] text-[13px] leading-relaxed text-[var(--text-2)]">
            {cash <= 0 ? (
              "No xStocks or USDC in this wallet yet. Fund it with USDC on Solana to trade a gap."
            ) : entry && entry.basisBps !== null ? (
              <>
                No xStocks in this wallet yet.{" "}
                <span className="text-white">{entry.tokenTicker}</span> is the cheapest against
                its real share right now, at{" "}
                <span className="num text-[var(--down)]">{fmtPct(entry.basisBps)}</span>.
              </>
            ) : (
              "No xStocks in this wallet yet. Nothing is trading below its real share right now — the table below updates live."
            )}
          </p>
          {cash > 0 && entry && (
            <button
              type="button"
              onClick={() => onTrade(entry.ticker, "buy")}
              className="h-8 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Buy {entry.tokenTicker}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="panel mb-5 px-4 pt-3.5 pb-2 sm:px-5">
      {header}

      <table className="mt-3.5 w-full text-[13px]">
        <thead>
          <tr className="border-t border-[var(--border)] text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
            <th className="py-2 text-left font-normal">Holding</th>
            <th className="py-2 text-right font-normal">Quantity</th>
            <th className="py-2 text-right font-normal">Value</th>
            <th className="py-2 text-right font-normal">Gap</th>
            <th className="py-2 text-right font-normal">If gap closes</th>
            <th className="w-[124px] py-2" aria-label="Trade" />
          </tr>
        </thead>
        <tbody>
          {holdings.map(({ reading: r, amount, value, convergence }) => {
            // Holding the rich side, selling captures the premium; holding the
            // cheap side, adding captures the discount. That action leads.
            const lead = r.basisBps === null || r.basisBps === 0 ? null : sideForGap(r.basisBps);
            const muted = r.signal === "noise" || r.signal === "degraded_feed";
            return (
              <tr key={r.ticker} className="border-t border-[var(--border)]">
                <td className="py-2.5">
                  <span className="font-medium">{r.tokenTicker}</span>
                  <span className="ml-2 text-[12px] text-[var(--text-3)]">{r.name}</span>
                </td>
                <td className="num py-2.5 text-right">{fmtAmount(amount)}</td>
                <td className="num py-2.5 text-right">{fmtUsd(value)}</td>
                <td
                  className="num py-2.5 text-right"
                  style={{
                    color:
                      r.basisBps === null || muted
                        ? "var(--text-2)"
                        : r.basisBps < 0
                          ? "var(--down)"
                          : "var(--up)",
                  }}
                >
                  {r.basisBps === null ? "—" : fmtPct(r.basisBps)}
                </td>
                <td className="num py-2.5 text-right" style={{ color: pnlColor(convergence ?? 0) }}>
                  {convergence === null ? "—" : signedUsd(convergence)}
                </td>
                <td className="py-2.5 text-right">
                  <span className="inline-flex gap-1.5">
                    <RowAction lead={lead === "buy"} onClick={() => onTrade(r.ticker, "buy")}>
                      Buy
                    </RowAction>
                    <RowAction lead={lead === "sell"} onClick={() => onTrade(r.ticker, "sell")}>
                      Sell
                    </RowAction>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-[var(--border)] py-2 text-[11px] text-[var(--text-3)]">
        Read-only · nothing is signed until you approve a trade in your wallet.
      </p>
    </div>
  );
}

/** The deepest live discount — the gap a USDC holder can act on. */
function deepestDiscount(readings: BasisReading[]): BasisReading | null {
  return (
    readings
      .filter(
        (r) =>
          r.basisBps !== null &&
          r.basisBps < 0 &&
          (r.signal === "actionable" || r.signal === "stale_reference"),
      )
      .sort((a, b) => (a.basisBps ?? 0) - (b.basisBps ?? 0))[0] ?? null
  );
}

function signedUsd(value: number): string {
  if (Math.abs(value) < 0.005) return fmtUsd(0);
  return `${value > 0 ? "+" : "−"}${fmtUsd(Math.abs(value))}`;
}

/** Gains read as the cheap colour and losses as the rich one, matching the board. */
function pnlColor(value: number): string {
  if (Math.abs(value) < 0.005) return "var(--text-3)";
  return value > 0 ? "var(--down)" : "var(--up)";
}

function Stat({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color?: string;
  title?: string;
}) {
  return (
    <div title={title}>
      <div className={LABEL}>{label}</div>
      <div className="num mt-1 text-[15px] leading-none" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function RowAction({
  lead,
  onClick,
  children,
}: {
  lead: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-[var(--radius-sm)] px-2.5 text-[12px] font-medium transition-colors ${
        lead
          ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
          : "border border-[var(--border-strong)] text-[var(--text-2)] hover:bg-[var(--raised)] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Freshness({
  updatedAt,
  refreshing,
  failed,
}: {
  updatedAt: number | null;
  refreshing: boolean;
  failed: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  if (refreshing) return <span>Updating…</span>;
  if (updatedAt === null) return null;
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  const age = seconds < 10 ? "just now" : seconds < 90 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
  return failed ? (
    <span className="text-[var(--warn)]" title="The last refresh failed; showing the previous read.">
      Stale · read {age}
    </span>
  ) : (
    <span>Read from chain {age}</span>
  );
}
