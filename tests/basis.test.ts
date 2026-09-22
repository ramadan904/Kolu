import { describe, expect, it } from "vitest";
import { computeBasis, rankByDislocation, formatAge } from "@/lib/basis/compute";
import { computeEdge, maxViableNotional } from "@/lib/basis/edge";
import { getMarketSession } from "@/lib/market/session";
import type { PriceReading } from "@/lib/data/types";
import { findEntry } from "@/lib/universe";

const AAPL = findEntry("AAPL")!;
const NOW = new Date("2026-09-21T14:00:00Z"); // Mon 10:00 ET — market open
const WEEKEND = new Date("2026-09-20T16:00:00Z"); // Sunday

const reading = (
  symbol: string,
  price: number,
  confidence: number,
  agoSeconds = 2,
  now: Date = NOW,
): PriceReading => ({
  symbol,
  feedId: "f".repeat(64),
  price,
  confidence,
  publishTime: Math.floor(now.getTime() / 1000) - agoSeconds,
  source: "fixture",
});

const openSession = () => getMarketSession(NOW);
const weekendSession = () => getMarketSession(WEEKEND);

describe("computeBasis", () => {
  it("measures a premium in bps and dollars", () => {
    const r = computeBasis(
      AAPL,
      reading("Equity.US.AAPL/USD", 200, 0.02),
      reading("Crypto.AAPLX/USD", 202, 0.02),
      openSession(),
      { now: NOW },
    );
    expect(r.basisUsd).toBeCloseTo(2, 6);
    expect(r.basisBps).toBeCloseTo(100, 6);
    expect(r.direction).toBe("premium");
    expect(r.signal).toBe("actionable");
    expect(r.note).toBeNull();
  });

  it("measures a discount as a negative basis", () => {
    const r = computeBasis(
      AAPL,
      reading("Equity.US.AAPL/USD", 200, 0.02),
      reading("Crypto.AAPLX/USD", 197, 0.02),
      openSession(),
      { now: NOW },
    );
    expect(r.basisBps).toBeCloseTo(-150, 6);
    expect(r.direction).toBe("discount");
    expect(r.signal).toBe("actionable");
  });

  it("calls a sub-threshold gap flat", () => {
    const r = computeBasis(
      AAPL,
      reading("Equity.US.AAPL/USD", 200, 0.001),
      reading("Crypto.AAPLX/USD", 200.02, 0.001),
      openSession(),
      { now: NOW },
    );
    expect(r.direction).toBe("flat");
  });

  it("refuses to call a gap inside oracle confidence actionable", () => {
    // 50bps gap, but each leg carries a 0.5 USD (25bps) confidence band.
    const r = computeBasis(
      AAPL,
      reading("Equity.US.AAPL/USD", 200, 0.5),
      reading("Crypto.AAPLX/USD", 201, 0.5),
      openSession(),
      { now: NOW },
    );
    expect(r.basisBps).toBeCloseTo(50, 6);
    expect(r.confidenceBps).toBeCloseTo(50, 6);
    expect(r.signal).toBe("noise");
    expect(r.note).toContain("confidence");
  });

  it("distinguishes a closed market from a broken feed", () => {
    const fourteenHours = 14 * 3600;

    const closed = computeBasis(
      AAPL,
      reading("Equity.US.AAPL/USD", 200, 0.02, fourteenHours, WEEKEND),
      reading("Crypto.AAPLX/USD", 204, 0.02, 3, WEEKEND),
      weekendSession(),
      { now: WEEKEND },
    );
    expect(closed.signal).toBe("stale_reference");
    expect(closed.referenceQuality).toBe("stale");
    expect(closed.note).toContain("drift");

    const broken = computeBasis(
      AAPL,
      reading("Equity.US.AAPL/USD", 200, 0.02, fourteenHours),
      reading("Crypto.AAPLX/USD", 204, 0.02, 3),
      openSession(),
      { now: NOW },
    );
    expect(broken.signal).toBe("degraded_feed");
    expect(broken.note).toContain("unreliable");
  });

  it("reports missing legs instead of inventing a number", () => {
    const r = computeBasis(AAPL, null, reading("Crypto.AAPLX/USD", 204, 0.02), openSession(), {
      now: NOW,
    });
    expect(r.signal).toBe("unavailable");
    expect(r.basisBps).toBeNull();
    expect(r.note).toContain("equity feed");
  });

  it("rejects a non-positive reference rather than dividing by zero", () => {
    const r = computeBasis(
      AAPL,
      reading("Equity.US.AAPL/USD", 0, 0.02),
      reading("Crypto.AAPLX/USD", 204, 0.02),
      openSession(),
      { now: NOW },
    );
    expect(r.signal).toBe("unavailable");
    expect(r.basisBps).toBeNull();
  });
});

describe("rankByDislocation", () => {
  it("puts the widest gap first and sinks unavailable pairs", () => {
    const mk = (bps: number | null, signal: "actionable" | "unavailable") =>
      ({ basisBps: bps, signal }) as never;
    const ranked = rankByDislocation([
      mk(20, "actionable"),
      mk(null, "unavailable"),
      mk(-140, "actionable"),
      mk(60, "actionable"),
    ]);
    expect(ranked.map((r) => r.basisBps)).toEqual([-140, 60, 20, null]);
  });
});

describe("computeEdge", () => {
  it("subtracts both legs of cost from the gross gap", () => {
    const e = computeEdge({
      basisBps: 150,
      notionalUsd: 10_000,
      hedgeable: true,
      costs: { swapFeeBps: 20, priceImpactBps: 10, networkFeeUsd: 0 },
    });
    expect(e.grossBps).toBe(150);
    expect(e.costBps).toBeCloseTo(60, 6); // (20 + 10) * 2 legs
    expect(e.netBps).toBeCloseTo(90, 6);
    expect(e.netUsd).toBeCloseTo(90, 6);
    expect(e.verdict).toBe("edge");
  });

  it("calls it negative when costs swallow the gap", () => {
    const e = computeEdge({
      basisBps: 25,
      notionalUsd: 5_000,
      hedgeable: true,
      costs: { swapFeeBps: 30, priceImpactBps: 5 },
    });
    expect(e.netBps).toBeLessThan(0);
    expect(e.verdict).toBe("negative");
    expect(e.caveat).toContain("no trade here");
  });

  it("never calls an unhedgeable gap arbitrage", () => {
    const e = computeEdge({
      basisBps: 300,
      notionalUsd: 20_000,
      hedgeable: false,
      costs: { swapFeeBps: 20, priceImpactBps: 5 },
    });
    expect(e.verdict).toBe("edge");
    expect(e.kind).toBe("directional");
    expect(e.caveat).toContain("not an arbitrage");
    // The headline number must never be presented as a locked-in edge.
    expect(e.tone).toBe("caution");
  });

  it("reserves the confident tone for hedgeable edges that clear costs", () => {
    const hedged = computeEdge({
      basisBps: 300,
      notionalUsd: 20_000,
      hedgeable: true,
      costs: { swapFeeBps: 20, priceImpactBps: 5 },
    });
    expect(hedged.tone).toBe("good");

    const thin = computeEdge({
      basisBps: 55,
      notionalUsd: 20_000,
      hedgeable: true,
      costs: { swapFeeBps: 20, priceImpactBps: 5 },
    });
    expect(thin.verdict).toBe("thin");
    expect(thin.tone).toBe("caution");
  });

  it("amortises a fixed network fee over notional", () => {
    const small = computeEdge({
      basisBps: 100,
      notionalUsd: 100,
      hedgeable: true,
      costs: { swapFeeBps: 0, priceImpactBps: 0, networkFeeUsd: 0.5 },
    });
    const large = computeEdge({
      basisBps: 100,
      notionalUsd: 100_000,
      hedgeable: true,
      costs: { swapFeeBps: 0, priceImpactBps: 0, networkFeeUsd: 0.5 },
    });
    expect(small.costBps).toBeGreaterThan(large.costBps);
    expect(large.costBps).toBeLessThan(1);
  });
});

describe("maxViableNotional", () => {
  it("finds the size at which impact eats the edge", () => {
    // Impact grows 1bp per $1,000 of size.
    const size = maxViableNotional(200, (n) => n / 1000, {
      swapFeeBps: 20,
      networkFeeUsd: 0,
    });
    // Net zero at gross 200 = (20 + impact) * 2  ->  impact = 80bps -> $80k.
    expect(size).toBeGreaterThan(79_000);
    expect(size).toBeLessThan(81_000);
  });
});

describe("formatAge", () => {
  it("scales units with magnitude", () => {
    expect(formatAge(30)).toBe("30s");
    expect(formatAge(600)).toBe("10m");
    expect(formatAge(3600 * 5)).toBe("5.0h");
    expect(formatAge(3600 * 72)).toBe("3d");
  });
});

describe("worstCase", () => {
  it("shows what a fill at the tolerance limit leaves", async () => {
    const { worstCase } = await import("@/lib/basis/edge");
    // The bug this exists for: an 83bps edge quoted with 50bps of allowed
    // slippage can settle at 33, while the screen promised 83.
    const w = worstCase(83, 50);
    expect(w.worstNetBps).toBe(33);
    expect(w.toleranceExceedsEdge).toBe(false);
    expect(w.edgeAtRisk).toBeCloseTo(50 / 83, 6);
  });

  it("flags a tolerance that can turn the trade into a loss", async () => {
    const { worstCase } = await import("@/lib/basis/edge");
    const w = worstCase(40, 50);
    expect(w.worstNetBps).toBe(-10);
    expect(w.toleranceExceedsEdge).toBe(true);
    expect(w.edgeAtRisk).toBe(1);
  });

  it("does not flag a trade that had no edge to begin with", async () => {
    const { worstCase } = await import("@/lib/basis/edge");
    expect(worstCase(-20, 50).toleranceExceedsEdge).toBe(false);
  });

  it("treats a negative tolerance as zero", async () => {
    const { worstCase } = await import("@/lib/basis/edge");
    expect(worstCase(60, -10).worstNetBps).toBe(60);
  });
});

describe("bandCopy", () => {
  it("calls the band an assumption when the serving source publishes none", async () => {
    const { bandCopy, ASSUMED_BAND_BPS } = await import("@/lib/basis/band");
    expect(ASSUMED_BAND_BPS).toBe(6);
    const jup = bandCopy("jupiter");
    expect(jup.short).toContain("assumed");
    expect(jup.long).toContain("PYTH_API_KEY");
    expect(jup.short).not.toMatch(/own confidence/);
  });

  it("calls it the feeds' own confidence only when Pyth is serving", async () => {
    const { bandCopy } = await import("@/lib/basis/band");
    expect(bandCopy("pyth").short).toMatch(/own confidence/);
    expect(bandCopy("pyth").long).toMatch(/publish a confidence interval/);
  });
});
