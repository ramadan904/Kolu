/**
 * What trading the gap would actually have done, over real history.
 *
 * The strategy is the one Kolu's own verdicts describe: while the share's
 * market is shut, when a pair's gap is at least `thresholdBps` wide, take the
 * side that captures it (buy a cheap token; sell a rich one you hold) and
 * unwind an hour after the next open, once the share is trading and the gap
 * has had its chance to close. One trade per closure per pair.
 *
 * Two results per trade, because they are different claims:
 *  - gap captured: how far the gap moved in your favour. What a trader who
 *    could hedge the share would have kept.
 *  - token return: what the position really did, the share's own move while
 *    you were unhedged included. That is the risk a closed-market trade takes.
 * Both are net of the round-trip cost model at the chosen size.
 */

import { computeEdge, sideForGap } from "./basis/edge";

/** [unix s, gap bps, session (0 open · 1 extended · 2 shut), token USD, share USD] */
export type WeekRow = [number, number, 0 | 1 | 2, number, number];

export interface BacktestInput {
  pairs: { ticker: string; tokenTicker: string; week: WeekRow[] }[];
  thresholdBps: number;
  notionalUsd: number;
  /** Minutes after the open to unwind. */
  exitAfterMin?: number;
}

export interface BacktestTrade {
  ticker: string;
  tokenTicker: string;
  side: "buy" | "sell";
  entryT: number;
  exitT: number;
  entryBps: number;
  exitBps: number;
  capturedBps: number;
  tokenReturnBps: number;
  costBps: number;
  netGapUsd: number;
  netTokenUsd: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** Entered but the open has not come yet: not counted. */
  pending: { ticker: string; tokenTicker: string; side: "buy" | "sell"; entryT: number; entryBps: number }[];
  costBps: number;
  wins: number;
  netGapUsd: number;
  netTokenUsd: number;
  /** Cumulative net gap and token P&L at each exit, in time order. */
  curve: { t: number; gap: number; token: number }[];
}

export function roundTripCostBps(notionalUsd: number): number {
  return computeEdge({ basisBps: 0, notionalUsd, hedgeable: true }).costBps;
}

export function backtest({ pairs, thresholdBps, notionalUsd, exitAfterMin = 60 }: BacktestInput): BacktestResult {
  const costBps = roundTripCostBps(notionalUsd);
  const trades: BacktestTrade[] = [];
  const pending: BacktestResult["pending"] = [];

  for (const pair of pairs) {
    const rows = [...pair.week].sort((a, b) => a[0] - b[0]);
    let i = 0;
    while (i < rows.length) {
      const [t, bps, session, token] = rows[i];
      if (session !== 2 || Math.abs(bps) < thresholdBps || !(token > 0)) {
        i += 1;
        continue;
      }
      const side = sideForGap(bps);
      // The next open, then the first row at least `exitAfterMin` into it.
      let open = i;
      while (open < rows.length && rows[open][2] !== 0) open += 1;
      if (open >= rows.length) {
        pending.push({ ticker: pair.ticker, tokenTicker: pair.tokenTicker, side, entryT: t * 1000, entryBps: bps });
        break;
      }
      const exitAt = rows[open][0] + exitAfterMin * 60;
      let exit = open;
      while (exit < rows.length && rows[exit][0] < exitAt) exit += 1;
      if (exit >= rows.length || rows[exit][2] !== 0) {
        pending.push({ ticker: pair.ticker, tokenTicker: pair.tokenTicker, side, entryT: t * 1000, entryBps: bps });
        break;
      }
      const [exitT, exitBps, , exitToken] = rows[exit];
      const capturedBps = side === "buy" ? exitBps - bps : bps - exitBps;
      const tokenReturnBps = (side === "buy" ? exitToken / token - 1 : token / exitToken - 1) * 10_000;
      trades.push({
        ticker: pair.ticker,
        tokenTicker: pair.tokenTicker,
        side,
        entryT: t * 1000,
        exitT: exitT * 1000,
        entryBps: bps,
        exitBps,
        capturedBps,
        tokenReturnBps,
        costBps,
        netGapUsd: ((capturedBps - costBps) / 10_000) * notionalUsd,
        netTokenUsd: ((tokenReturnBps - costBps) / 10_000) * notionalUsd,
      });
      // One trade per closure: look again only once this open has passed.
      i = exit + 1;
    }
  }

  trades.sort((a, b) => a.exitT - b.exitT);
  let gap = 0;
  let token = 0;
  const curve = trades.map((tr) => {
    gap += tr.netGapUsd;
    token += tr.netTokenUsd;
    return { t: tr.exitT, gap, token };
  });

  return {
    trades,
    pending,
    costBps,
    wins: trades.filter((tr) => tr.netGapUsd > 0).length,
    netGapUsd: gap,
    netTokenUsd: token,
    curve,
  };
}
