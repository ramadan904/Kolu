import { describe, expect, it } from "vitest";
import { backtest, roundTripCostBps, type WeekRow } from "@/lib/backtest";

// Half-hour rows: shut from t=0, open at row 10, trading through row 14.
const H = 1800;
const week = (gaps: number[], sessions: (0 | 1 | 2)[], tokens?: number[]): WeekRow[] =>
  gaps.map((g, i) => [i * H, g, sessions[i], tokens?.[i] ?? 100, 100]);
const shutThenOpen = (n = 15): (0 | 1 | 2)[] => Array.from({ length: n }, (_, i) => (i < 10 ? 2 : 0));

describe("backtest", () => {
  it("buys a cheap token while shut and unwinds an hour after the open", () => {
    const gaps = [0, -120, -130, -125, -120, -110, -100, -100, -90, -80, -40, -30, -10, -5, 0];
    const tokens = gaps.map((g) => 100 * (1 + g / 10_000));
    const r = backtest({
      pairs: [{ ticker: "TSLA", tokenTicker: "TSLAX", week: week(gaps, shutThenOpen(), tokens) }],
      thresholdBps: 100,
      notionalUsd: 10_000,
    });
    expect(r.trades).toHaveLength(1);
    const [t] = r.trades;
    expect(t.side).toBe("buy");
    expect(t.entryBps).toBe(-120);
    // Open at row 10; one hour later is row 12.
    expect(t.exitBps).toBe(-10);
    expect(t.capturedBps).toBe(110);
    expect(t.tokenReturnBps).toBeCloseTo(((100 * (1 - 0.001)) / (100 * (1 - 0.012)) - 1) * 10_000, 6);
    expect(t.netGapUsd).toBeCloseTo(((110 - r.costBps) / 10_000) * 10_000, 6);
  });

  it("sells a rich token and measures the return of stepping out", () => {
    const gaps = [150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 60, 40, 20, 20, 20];
    const r = backtest({
      pairs: [{ ticker: "NVDA", tokenTicker: "NVDAX", week: week(gaps, shutThenOpen(), gaps.map(() => 100)) }],
      thresholdBps: 100,
      notionalUsd: 2_000,
    });
    expect(r.trades[0].side).toBe("sell");
    expect(r.trades[0].capturedBps).toBe(130);
    expect(r.trades[0].tokenReturnBps).toBeCloseTo(0);
  });

  it("ignores gaps below the threshold and gaps while the share trades", () => {
    const gaps = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 300, 300, 300, 300, 300];
    const r = backtest({
      pairs: [{ ticker: "SPY", tokenTicker: "SPYX", week: week(gaps, shutThenOpen()) }],
      thresholdBps: 100,
      notionalUsd: 10_000,
    });
    expect(r.trades).toEqual([]);
    expect(r.pending).toEqual([]);
  });

  it("holds an entry with no open yet as pending, not as a result", () => {
    const r = backtest({
      pairs: [{ ticker: "AAPL", tokenTicker: "AAPLX", week: week([200, 200, 200], [2, 2, 2]) }],
      thresholdBps: 100,
      notionalUsd: 10_000,
    });
    expect(r.trades).toEqual([]);
    expect(r.pending).toHaveLength(1);
  });

  it("prices a round trip at every size, with the fixed network fee weighing most on small ones", () => {
    for (const size of [500, 2_000, 10_000, 50_000]) expect(roundTripCostBps(size)).toBeGreaterThan(0);
    expect(roundTripCostBps(500)).toBeGreaterThan(roundTripCostBps(10_000));
  });
});
