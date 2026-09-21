"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  onShowAll,
}: {
  readings: BasisReading[];
  mints: MintMap | null;
  onTrade: (ticker: string, side: Side) => void;
  /** Widens the board to every tracked pair, so holdings outside the filter get priced. */
  onShowAll?: () => void;
}) {
  const {
    balances,
    loading,
    refreshing,
    error,
    updatedAt,
    refresh,
    owner,
    watching,
    watch,
    stopWatching,
  } = useBalances();

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

  // Held xStocks the board is not currently pricing (the table is filtered to
  // the liquid set). Leaving them out silently would understate the total.
  const unpriced = useMemo(() => {
    if (!mints) return [];
    const priced = new Set(readings.map((r) => r.ticker));
    return Object.entries(mints.tokens)
      .filter(([ticker, { mint }]) => !priced.has(ticker) && (balances.get(mint)?.amount ?? 0) > 0)
      .map(([ticker]) => `${ticker}X`);
  }, [readings, balances, mints]);

  // Rendering nothing until a wallet connects means the section is invisible to
  // everyone evaluating the product. It states what it will show instead.
  if (!owner) {
    return (
      <div className="panel mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5">
        <div>
          <div className={LABEL}>Your position</div>
          <p className="mt-1 text-[13px] text-[var(--text-2)]">
            Connect a wallet to value your xStocks against the live gaps below — or view
            any address, read-only.
          </p>
        </div>
        <WatchForm onWatch={watch} />
      </div>
    );
  }

  if (loading && updatedAt === null) {
    return (
      <div className="panel mb-5 px-4 py-3.5" aria-busy="true">
        <div className="flex items-center gap-2.5 text-[13px] text-[var(--text-3)]">
          <Spinner />
          {watching ? "Reading that address" : "Reading your wallet"}
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
        <span className="flex gap-4">
          <button
            type="button"
            onClick={refresh}
            className="text-[var(--text-2)] transition-colors hover:text-white"
          >
            Retry
          </button>
          {watching && (
            <button
              type="button"
              onClick={stopWatching}
              className="text-[var(--text-3)] transition-colors hover:text-white"
            >
              Stop watching
            </button>
          )}
        </span>
      </div>
    );
  }

  const cash = mints?.quote ? (balances.get(mints.quote.mint)?.amount ?? 0) : 0;
  const invested = holdings.reduce((sum, h) => sum + h.value, 0);
  const exposure = holdings.reduce((sum, h) => sum + (h.convergence ?? 0), 0);
  const address = owner;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className={`${LABEL} flex items-center gap-2`}>
            {watching ? "Watching" : "Your position"}
            {watching && (
              <span className="rounded-full bg-[var(--raised)] px-1.5 text-[10px] normal-case tracking-normal text-[var(--text-2)]">
                read-only
              </span>
            )}
          </div>
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
        {watching && (
          <button
            type="button"
            onClick={stopWatching}
            className="transition-colors hover:text-white"
          >
            Stop
          </button>
        )}
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
            {unpriced.length > 0 ? (
              <>
                Holds <span className="text-white">{unpriced.join(", ")}</span>, outside the liquid
                set the board is showing.{" "}
                {onShowAll && (
                  <button
                    type="button"
                    onClick={onShowAll}
                    className="text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    Show all pairs to value {unpriced.length === 1 ? "it" : "them"}
                  </button>
                )}
              </>
            ) : watching ? (
              "This address holds no tokenized stocks Kolu tracks. Try another, or connect your own wallet."
            ) : cash <= 0 ? (
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
          {!watching && unpriced.length === 0 && cash > 0 && entry && (
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
      {unpriced.length > 0 && (
        <p className="border-t border-[var(--border)] py-2 text-[12px] text-[var(--text-2)]">
          Also holds <span className="text-white">{unpriced.join(", ")}</span>, not in the
          liquid set and not counted above.{" "}
          {onShowAll && (
            <button
              type="button"
              onClick={onShowAll}
              className="text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Show all pairs to value {unpriced.length === 1 ? "it" : "them"}
            </button>
          )}
        </p>
      )}
      <p className="border-t border-[var(--border)] py-2 text-[11px] text-[var(--text-3)]">
        {watching
          ? "Watching a public address · read-only, nothing can be signed for it. Connect your own wallet to trade."
          : "Read-only · nothing is signed until you approve a trade in your wallet."}
      </p>
    </div>
  );
}

/**
 * Paste an address, see its real holdings. Lets anyone — a judge without
 * xStocks, a trader checking a fund's wallet — see the portfolio working on
 * live data without connecting anything.
 */
function WatchForm({ onWatch }: { onWatch: (address: string) => boolean }) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setInvalid(!onWatch(value));
  };

  return (
    <form onSubmit={submit} className="flex w-full max-w-[420px] flex-col gap-1 sm:w-auto">
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          placeholder="Paste a Solana address"
          aria-label="Solana address to view read-only"
          aria-invalid={invalid}
          spellCheck={false}
          autoComplete="off"
          className={`num h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-[var(--bg)] px-2.5 text-[12px] outline-none sm:w-[300px] ${
            invalid
              ? "border-[var(--up)]"
              : "border-[var(--border-strong)] focus:border-[var(--accent)]"
          }`}
        />
        <button
          type="submit"
          className="h-8 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--raised)] hover:text-white"
        >
          View
        </button>
      </div>
      <span className="text-[11px] text-[var(--text-3)]">
        {invalid ? (
          <span className="text-[var(--up)]">That is not a valid Solana address.</span>
        ) : (
          "Read-only · nothing is signed"
        )}
      </span>
    </form>
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
