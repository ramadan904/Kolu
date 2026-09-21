"use client";

import type { BasisReading } from "@/lib/basis/compute";
import { computeEdge } from "@/lib/basis/edge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { fmtPct, fmtUsd } from "@/lib/format";
import { timeUntilClose, type MarketSession } from "@/lib/market/session";

/**
 * One number, large, and a sentence saying what it means in plain language.
 *
 * The rest of the screen is a table; this is the part that answers "is anything
 * happening right now" from across the room.
 */
export function Hero({
  reading,
  hedgeable,
  session,
  delayed = 0,
  onTrade,
}: {
  reading: BasisReading | null;
  hedgeable: boolean;
  session: MarketSession;
  /** Pairs flagged `degraded_feed`: excluded from the headline, never "in line". */
  delayed?: number;
  onTrade: (ticker: string) => void;
}) {
  // A quiet board is the normal state while the market is open — arbitrageurs
  // are awake and the gaps are arbitraged away. Saying only "nothing here" is
  // accurate and useless; the screen should say why, and when to look again.
  if (!reading || reading.basisBps === null || reading.equity === null || reading.token === null) {
    const closesIn = timeUntilClose(session);

    // "Priced in line" is a claim that the gaps were measured and found small.
    // With stalled references nothing was measured, and the map below would
    // show the raw gaps disagreeing with the headline.
    if (session.isRegularHours && delayed > 0) {
      return (
        <section className="py-8 sm:py-10">
          <p className="text-[13px] uppercase tracking-[0.08em] text-[var(--text-3)]">
            Market open · reference delayed
          </p>
          <p className="display mt-3 text-[40px] leading-none sm:text-[46px]">No clean read</p>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--text-2)]">
            {delayed === 1 ? "One real-share price has" : `${delayed} real-share prices have`} not
            ticked in over two minutes, so Kolu will not call a gap on{" "}
            {delayed === 1 ? "it" : "them"}. The raw numbers are below, muted, until the feed
            catches up.{" "}
            {closesIn && (
              <span className="text-white">After-hours gaps open when the market closes, in {closesIn}.</span>
            )}
          </p>
        </section>
      );
    }
    return (
      <section className="py-8 sm:py-10">
        <p className="text-[13px] uppercase tracking-[0.08em] text-[var(--text-3)]">
          {session.isRegularHours ? "Market open · tracking tight" : "Nothing dislocated"}
        </p>

        <p className="display mt-3 text-[40px] leading-none sm:text-[46px]">
          {session.isRegularHours ? "Priced in line" : "All within noise"}
        </p>

        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--text-2)]">
          {session.isRegularHours ? (
            <>
              Every tokenized stock is tracking its underlying to within the noise
              floor. That is what an open market looks like — anyone can hedge, so
              nobody leaves a gap.{" "}
              {closesIn && (
                <span className="text-white">
                  The interesting part starts when it closes, in {closesIn}.
                </span>
              )}
            </>
          ) : (
            <>
              Nothing is currently trading far enough from its underlying to be worth
              the fees. Gaps tend to open as the session ages — arm an alert on a name
              below and Kolu will watch it for you.
            </>
          )}
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
        {edge.netBps <= 0
          ? `On a $10k clip, fees and slippage outweigh the gap by about ${Math.round(-edge.netBps)}bps — watch it, don't trade it yet.`
          : hedgeable
            ? `About ${Math.round(edge.netBps)}bps survives fees and slippage on a $10k clip.`
            : `Worth about ${fmtUsd(edge.netUsd)} on a $10k position if it converges at the open.`}
      </p>

      <div className="mt-6 flex flex-wrap gap-2.5">
        <Button size="lg" onClick={() => onTrade(reading.ticker)}>
          Trade {reading.tokenTicker}
        </Button>
      </div>
    </section>
  );
}
