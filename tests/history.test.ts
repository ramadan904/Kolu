import { beforeEach, describe, expect, it } from "vitest";
import { backfill, clear, observed, record, seriesFor } from "@/lib/history";

const WEEKEND = new Date("2026-09-20T16:00:00Z"); // Sunday 12:00 ET
const OPEN = new Date("2026-09-21T14:00:00Z"); // Monday 10:00 ET

beforeEach(() => clear());

describe("record", () => {
  it("stores samples with the session they were taken in", () => {
    record("AAPL", 120, OPEN);
    const points = observed("AAPL");
    expect(points).toHaveLength(1);
    expect(points[0].basisBps).toBe(120);
    expect(points[0].phase).toBe("regular");
  });

  it("throttles samples taken within the same minute", () => {
    record("AAPL", 120, OPEN);
    record("AAPL", 125, new Date(OPEN.getTime() + 20_000));
    record("AAPL", 130, new Date(OPEN.getTime() + 90_000));
    expect(observed("AAPL")).toHaveLength(2);
  });

  it("keeps series separate per ticker", () => {
    record("AAPL", 10, OPEN);
    record("NVDA", 20, OPEN);
    expect(observed("AAPL")).toHaveLength(1);
    expect(observed("NVDA")).toHaveLength(1);
    expect(observed("TSLA")).toHaveLength(0);
  });
});

describe("backfill", () => {
  it("ends at the current value and runs forward in time", () => {
    const points = backfill("AAPL", 173, WEEKEND);
    expect(points.length).toBeGreaterThan(100);
    expect(points[points.length - 1].basisBps).toBeCloseTo(173, 6);
    expect(points[points.length - 1].t).toBe(WEEKEND.getTime());
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i].t).toBeGreaterThan(points[i - 1].t);
    }
  });

  it("is deterministic for a given ticker", () => {
    const a = backfill("AAPL", 173, WEEKEND);
    const b = backfill("AAPL", 173, WEEKEND);
    expect(a.map((p) => p.basisBps)).toEqual(b.map((p) => p.basisBps));
  });

  it("holds the basis tighter while the market is open than while it is shut", () => {
    // The thesis the chart exists to show: arbitrageurs can hedge during the
    // session, so the gap compresses; overnight nothing pulls it back.
    const points = backfill("NVDA", 150, OPEN);
    const spread = (phase: string) => {
      const vals = points.filter((p) => p.phase === phase).map((p) => Math.abs(p.basisBps));
      return vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
    };
    expect(spread("regular")).toBeLessThan(spread("weekend"));
  });

  it("keeps session-time history near zero instead of reconstructing a huge past", () => {
    // Regression: integrating the mean-reversion backwards from the current
    // value compounds, inventing a past where the gap was enormous and
    // shrinking — the exact opposite of the mechanism being illustrated.
    const points = backfill("SPY", 173, WEEKEND);
    const duringSession = points.filter((p) => p.phase === "regular");
    expect(duringSession.length).toBeGreaterThan(0);

    const worstInSession = Math.max(...duringSession.map((p) => Math.abs(p.basisBps)));
    expect(worstInSession).toBeLessThan(40);
    // And the whole series must stay in the neighbourhood of where it lands.
    expect(Math.max(...points.map((p) => Math.abs(p.basisBps)))).toBeLessThan(260);
  });

  it("opens the gap across the closure rather than smearing it everywhere", () => {
    const points = backfill("SPY", 173, WEEKEND);
    const firstQuarter = points.slice(0, Math.floor(points.length / 4));
    const lastQuarter = points.slice(-Math.floor(points.length / 4));
    const mean = (xs: typeof points) =>
      xs.reduce((a, p) => a + Math.abs(p.basisBps), 0) / xs.length;
    expect(mean(lastQuarter)).toBeGreaterThan(mean(firstQuarter) * 3);
  });

  it("stays within sane bounds", () => {
    const points = backfill("TSLA", 400, WEEKEND);
    for (const p of points) {
      expect(Math.abs(p.basisBps)).toBeLessThanOrEqual(600);
    }
  });
});

describe("seriesFor", () => {
  it("returns only observed points when not in demo mode", () => {
    record("AAPL", 40, OPEN);
    const series = seriesFor("AAPL", 40, OPEN, false);
    expect(series.synthetic).toBe(false);
    expect(series.points).toHaveLength(1);
  });

  it("splices generated history before the first observed sample", () => {
    record("AAPL", 40, OPEN);
    const series = seriesFor("AAPL", 40, OPEN, true);
    expect(series.synthetic).toBe(true);
    expect(series.points.length).toBeGreaterThan(100);

    const firstObserved = observed("AAPL")[0].t;
    const generated = series.points.filter((p) => p.t < firstObserved);
    expect(generated.length).toBeGreaterThan(0);
    // No generated point may overlap or postdate real data.
    expect(Math.max(...generated.map((p) => p.t))).toBeLessThan(firstObserved);
    expect(series.points[series.points.length - 1].t).toBe(firstObserved);
  });

  it("reports how much real history it actually has", () => {
    record("AAPL", 40, OPEN);
    record("AAPL", 45, new Date(OPEN.getTime() + 30 * 60_000));
    expect(seriesFor("AAPL", 45, OPEN, false).observedMinutes).toBe(30);
  });

  it("does not invent history without a current value to anchor to", () => {
    const series = seriesFor("AAPL", null, OPEN, true);
    expect(series.synthetic).toBe(false);
    expect(series.points).toHaveLength(0);
  });
});

describe("niceDomain", () => {
  it("rounds to readable axis bounds", async () => {
    const { niceDomain } = await import("@/lib/chart-scale");
    expect(niceDomain(187)).toBe(200);
    expect(niceDomain(201)).toBe(250);
    expect(niceDomain(12)).toBe(25);
    // Beyond the table, fall back to the next round hundred.
    expect(niceDomain(742)).toBe(800);
  });
});
