/**
 * What is actually left after costs.
 *
 * A basis number on its own is marketing. The number that decides a trade is
 * what survives the swap fee, the price impact of your own size, and the
 * spread you cross. This module exists so the UI can never show a gap without
 * showing what it costs to touch it.
 *
 * It also refuses to call anything "arbitrage" that is not one. Capturing a
 * basis requires shorting the rich leg against the cheap leg. While the equity
 * market is shut, that hedge does not exist: you are taking a directional
 * position and hoping the gap closes at the open. Same number, different trade,
 * and conflating them is how people lose money on this strategy.
 */

export type EdgeVerdict = "edge" | "thin" | "negative";
export type EdgeKind = "hedgeable" | "directional";

export interface CostModel {
  /** Pool/taker fee on the swap, in bps. */
  swapFeeBps: number;
  /** Price impact for the requested size, in bps. Comes from a live quote. */
  priceImpactBps: number;
  /** Priority fee + rent in USD, amortised over the notional. */
  networkFeeUsd: number;
  /**
   * Round-trip cost if the position is unwound rather than held to convergence.
   * Defaults to symmetric with the entry.
   */
  roundTrip: boolean;
}

export const DEFAULT_COSTS: CostModel = {
  swapFeeBps: 30,
  priceImpactBps: 0,
  networkFeeUsd: 0.05,
  roundTrip: true,
};

export interface EdgeInput {
  basisBps: number;
  notionalUsd: number;
  costs?: Partial<CostModel>;
  /** False while the underlying market is closed — no hedge is available. */
  hedgeable: boolean;
}

export interface EdgeResult {
  grossBps: number;
  costBps: number;
  netBps: number;
  netUsd: number;
  verdict: EdgeVerdict;
  kind: EdgeKind;
  breakdown: { label: string; bps: number }[];
  /** Plain-language statement of what this trade actually is. */
  caveat: string;
}

/** Below this, execution variance swamps the edge. */
export const THIN_EDGE_BPS = 10;

export function computeEdge(input: EdgeInput): EdgeResult {
  const costs = { ...DEFAULT_COSTS, ...input.costs };
  const notional = Math.max(input.notionalUsd, 1);
  const legs = costs.roundTrip ? 2 : 1;

  const swapBps = costs.swapFeeBps * legs;
  const impactBps = costs.priceImpactBps * legs;
  const networkBps = (costs.networkFeeUsd * legs / notional) * 10_000;

  const grossBps = Math.abs(input.basisBps);
  const costBps = swapBps + impactBps + networkBps;
  const netBps = grossBps - costBps;

  const verdict: EdgeVerdict =
    netBps <= 0 ? "negative" : netBps < THIN_EDGE_BPS ? "thin" : "edge";

  const kind: EdgeKind = input.hedgeable ? "hedgeable" : "directional";

  return {
    grossBps,
    costBps,
    netBps,
    netUsd: (netBps / 10_000) * notional,
    verdict,
    kind,
    breakdown: [
      { label: `Swap fee (${legs} leg${legs > 1 ? "s" : ""})`, bps: swapBps },
      { label: "Price impact", bps: impactBps },
      { label: "Network fee", bps: networkBps },
    ],
    caveat: caveatFor(verdict, kind),
  };
}

function caveatFor(verdict: EdgeVerdict, kind: EdgeKind): string {
  if (verdict === "negative") {
    return "Costs exceed the gap. There is no trade here.";
  }
  if (kind === "directional") {
    return (
      "The underlying market is closed, so this gap cannot be hedged. You are " +
      "taking a directional position that it narrows by the open — not an arbitrage."
    );
  }
  if (verdict === "thin") {
    return "Edge survives costs but only just; a single tick of slippage erases it.";
  }
  return "Edge survives modelled costs. Execution risk and oracle lag still apply.";
}

/** Largest size whose price impact still leaves a positive net edge. */
export function maxViableNotional(
  basisBps: number,
  impactBpsAt: (notionalUsd: number) => number,
  costs: Partial<CostModel> = {},
  ceiling = 250_000,
): number {
  let low = 0;
  let high = ceiling;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const result = computeEdge({
      basisBps,
      notionalUsd: mid,
      hedgeable: true,
      costs: { ...costs, priceImpactBps: impactBpsAt(mid) },
    });
    if (result.netBps > 0) low = mid;
    else high = mid;
  }
  return Math.floor(low);
}
