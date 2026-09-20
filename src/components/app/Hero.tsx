"use client";

import type { BasisReading } from "@/lib/basis/compute";
import { computeEdge } from "@/lib/basis/edge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { fmtPct, fmtUsd } from "@/lib/format";

/**
 * One number, large, and a sentence saying what it means in plain language.
 *
 * The rest of the screen is a table; this is the part that answers "is anything
 * happening right now" from across the room.
 */
export function Hero({
  reading,
  hedgeable,
  onTrade,
}: {
  reading: BasisReading | null;
  hedgeable: boolean;
  onTrade: (ticker: string) => void;
}) {
  if (!reading || reading.basisBps === null || reading.equity === null || reading.token === null) {
    return (
      <section className="py-10">
        <p className="text-[13px] uppercase tracking-[0.08em] text-[var(--text-3)]">
          Widest dislocation
        </p>
        <p className="display mt-2 text-[44px] leading-none text-[var(--text-2)]">—</p>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--text-2)]">
          Every tracked pair is sitting inside the oracles&rsquo; own confidence band. There
          is nothing here worth trading, and saying so is the honest answer.
        </p>
      </section>
    );
  }

  const discount = reading.basisBps < 0;
  const gapUsd = Math.abs(reading.basisUsd ?? 0);
  const edge = computeEdge({
    basisBps: reading.basisBps,
    notionalUsd: 10_000,
    hedgeable,
  });

  return (
    <section className="py-8 sm:py-10">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] uppercase tracking-[0.08em] text-[var(--text-3)]">
          Widest dislocation
        </p>
        <Badge tone={discount ? "down" : "up"}>
          {discount ? "Trading cheap" : "Trading rich"}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="display text-[52px] leading-none sm:text-[64px]">
          {reading.tokenTicker}
        </span>
        <span
          className="display text-[40px] leading-none sm:text-[48px]"
          style={{ color: discount ? "var(--down)" : "var(--up)" }}
        >
          {fmtPct(reading.basisBps)}
        </span>
      </div>

      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--text-2)]">
        {reading.tokenTicker} is trading{" "}
        <span className="num text-white">{fmtUsd(gapUsd)}</span>{" "}
        {discount ? "below" : "above"} the real {reading.name} share price of{" "}
        <span className="num text-white">{fmtUsd(reading.equity.price)}</span>.{" "}
        {hedgeable
          ? `About ${Math.round(edge.netBps)}bps survives fees and slippage on a $10k clip.`
          : "The underlying market is shut, so this is a bet on convergence at the open — not an arbitrage."}
      </p>

      <div className="mt-6 flex flex-wrap gap-2.5">
        <Button size="lg" onClick={() => onTrade(reading.ticker)}>
          Trade {reading.tokenTicker}
        </Button>
      </div>
    </section>
  );
}
