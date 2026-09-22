"use client";

import { bandCopy, type PriceSourceKind } from "@/lib/basis/band";
import { NOISE_MULTIPLE, type BasisReading } from "@/lib/basis/compute";
import { breakevenBps, computeEdge } from "@/lib/basis/edge";
import type { MarketSession } from "@/lib/market/session";

/**
 * The three questions every number on the page answers, each with the live
 * value that answers it right now. Explanation, but product-shaped: nothing
 * here is copy that could be true of any market on any day.
 */
export function HowItReads({
  readings,
  session,
  hedgeable,
  source = "jupiter",
}: {
  readings: BasisReading[];
  session: MarketSession;
  hedgeable: boolean;
  /** Which price source is serving: it decides what the noise floor is. */
  source?: PriceSourceKind;
}) {
  const floors = readings
    .map((r) => r.confidenceBps)
    .filter((c): c is number => c !== null)
    .sort((a, b) => a - b);
  const noise = floors.length ? floors[Math.floor(floors.length / 2)] * NOISE_MULTIPLE : null;
  const signals = readings.filter((r) => r.signal === "actionable" || r.signal === "stale_reference").length;
  const breakeven = breakevenBps();
  const costs = computeEdge({ basisBps: 0, notionalUsd: 10_000, hedgeable: true }).breakdown;

  const phase =
    session.phase === "regular"
      ? "US market open"
      : session.phase === "premarket"
        ? "Pre-market"
        : session.phase === "afterhours"
          ? "After hours"
          : "US market shut";

  const steps = [
    {
      n: 1,
      title: source === "pyth" ? "Is the gap real? · Pyth confidence" : "Is the gap real? · assumed band",
      value: noise !== null ? `±${noise.toFixed(1)}bps` : "—",
      caption: "noise floor now",
      body: `${bandCopy(source).long} ${signals} of ${readings.length} pairs are outside it right now.`,
    },
    {
      n: 2,
      title: "Can it be hedged?",
      value: hedgeable ? "Yes" : "No",
      caption: phase,
      body: hedgeable
        ? "The real share trades, so a gap can be locked in against it. That is why gaps stay tight in session."
        : "The real share cannot trade, so a gap is a bet that it converges by the open — directional, never called arbitrage.",
    },
    {
      n: 3,
      title: "Does it pay?",
      value: `${breakeven}bps`,
      caption: "break-even, $10k round trip",
      body: `Swap fees ${Math.round(costs[0].bps)}bps and price impact ~${Math.round(costs[1].bps)}bps across two legs, plus network fees. The ticket replaces the impact estimate with live Jupiter quotes at your size.`,
    },
  ];

  return (
    <section className="mb-5" aria-labelledby="how-it-reads">
      <h2 id="how-it-reads" className="eyebrow mb-3 ">
        How Kolu reads a gap
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="panel flex flex-col px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
              <span className="num flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-strong)] text-[11px]">
                {s.n}
              </span>
              {s.title}
            </div>
            <div className="display text-electric mt-3 text-[34px] leading-none">{s.value}</div>
            <div className="mt-1 text-[12px] text-[var(--text-3)]">{s.caption}</div>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-2)]">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
