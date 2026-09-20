"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { BasisReading } from "@/lib/basis/compute";
import type { MintMap } from "./TradePanel";
import { useBalances } from "./useBalances";
import { fmtUsd } from "@/lib/format";
import { fmtAmount } from "@/lib/tokens";
import { Spinner } from "@/components/ui/Button";

/**
 * What the connected wallet is actually holding, valued at the board's prices.
 *
 * Without this, connecting a wallet is a cosmetic act: the address appears and
 * nothing about the product changes. Holdings are also what turns a gap from a
 * statistic into a position — a 170bps premium reads differently when you are
 * the one holding the rich side.
 */
export function Portfolio({
  readings,
  mints,
}: {
  readings: BasisReading[];
  mints: MintMap | null;
}) {
  const { connected } = useWallet();
  const { balances, loading, error } = useBalances();

  const rows = useMemo(() => {
    if (!mints) return [];
    return readings
      .map((r) => {
        const mint = mints.tokens[r.ticker]?.mint;
        const amount = mint ? (balances.get(mint)?.amount ?? 0) : 0;
        const price = r.token?.price ?? 0;
        return { ticker: r.tokenTicker, amount, value: amount * price, basisBps: r.basisBps };
      })
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.value - a.value);
  }, [readings, balances, mints]);

  if (!connected) return null;

  const cash = mints?.quote ? (balances.get(mints.quote.mint)?.amount ?? 0) : 0;
  const positions = rows.reduce((sum, r) => sum + r.value, 0);
  const total = positions + cash;

  if (loading && rows.length === 0 && cash === 0) {
    return (
      <div className="panel mb-5 flex items-center gap-2.5 px-4 py-3 text-[13px] text-[var(--text-3)]">
        <Spinner />
        Reading your wallet
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel mb-5 px-4 py-3 text-[13px] text-[var(--text-3)]">{error}</div>
    );
  }

  if (total === 0) {
    return (
      <div className="panel mb-5 px-4 py-3 text-[13px] text-[var(--text-3)]">
        This wallet holds no USDC or tokenized stocks yet.
      </div>
    );
  }

  return (
    <div className="panel mb-5 px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
            Your position
          </div>
          <div className="display mt-0.5 text-[26px] leading-none">{fmtUsd(total)}</div>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
          {rows.slice(0, 4).map((row) => (
            <span key={row.ticker} className="flex items-baseline gap-1.5">
              <span className="text-[var(--text-2)]">{row.ticker}</span>
              <span className="num">{fmtAmount(row.amount)}</span>
              <span
                className="num text-[12px]"
                style={{
                  color:
                    row.basisBps === null
                      ? "var(--text-3)"
                      : row.basisBps < 0
                        ? "var(--down)"
                        : "var(--up)",
                }}
              >
                {fmtUsd(row.value)}
              </span>
            </span>
          ))}
          {cash > 0 && (
            <span className="flex items-baseline gap-1.5">
              <span className="text-[var(--text-2)]">USDC</span>
              <span className="num">{fmtAmount(cash)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
