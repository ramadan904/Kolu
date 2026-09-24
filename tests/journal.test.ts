import { describe, expect, it } from "vitest";
import { averageCost, basisFor, unrealised, withFill, withManual, type Fill, type Journal } from "@/lib/journal";

const fill = (t: number, side: Fill["side"], tokenAmount: number, usdcAmount: number, ticker = "TSLA"): Fill => ({
  signature: `sig${t}`,
  t,
  ticker,
  side,
  tokenAmount,
  usdcAmount,
});
const empty: Journal = { fills: [], manual: {} };

describe("averageCost", () => {
  it("averages buys", () => {
    expect(averageCost([fill(1, "buy", 1, 100), fill(2, "buy", 1, 200)])).toEqual({ qty: 2, entry: 150 });
  });

  it("keeps the entry of what remains after a sell", () => {
    const r = averageCost([fill(1, "buy", 2, 200), fill(2, "sell", 1, 500)]);
    expect(r?.qty).toBe(1);
    expect(r?.entry).toBeCloseTo(100);
  });

  it("ignores a sell of units it never saw bought", () => {
    expect(averageCost([fill(1, "sell", 1, 100), fill(2, "buy", 1, 120)])).toEqual({ qty: 1, entry: 120 });
  });

  it("is null once everything is sold", () => {
    expect(averageCost([fill(1, "buy", 1, 100), fill(2, "sell", 1, 110)])).toBeNull();
  });
});

describe("basisFor", () => {
  it("covers at most what is held from Kolu fills", () => {
    const j = withFill(empty, fill(1, "buy", 3, 300));
    expect(basisFor(j, "TSLA", 2)).toEqual({ entry: 100, coveredQty: 2, source: "kolu" });
    expect(basisFor(j, "TSLA", 5)?.coveredQty).toBe(3);
  });

  it("prefers a manual entry, covering the whole holding", () => {
    const j = withManual(withFill(empty, fill(1, "buy", 1, 300)), "TSLA", 250);
    expect(basisFor(j, "TSLA", 4)).toEqual({ entry: 250, coveredQty: 4, source: "manual" });
    expect(basisFor(withManual(j, "TSLA", null), "TSLA", 4)?.source).toBe("kolu");
  });

  it("has no basis for another ticker or an empty holding", () => {
    const j = withFill(empty, fill(1, "buy", 1, 100));
    expect(basisFor(j, "NVDA", 1)).toBeNull();
    expect(basisFor(j, "TSLA", 0)).toBeNull();
  });
});

describe("journal", () => {
  it("records a fill once", () => {
    const f = fill(1, "buy", 1, 100);
    expect(withFill(withFill(empty, f), f).fills).toHaveLength(1);
  });

  it("rejects a manual price that is not a price", () => {
    expect(withManual(empty, "TSLA", -5).manual).toEqual({});
    expect(withManual(empty, "TSLA", Number.NaN).manual).toEqual({});
  });

  it("prices unrealised P&L on covered units", () => {
    const r = unrealised({ entry: 100, coveredQty: 2, source: "kolu" }, 110);
    expect(r.usd).toBeCloseTo(20);
    expect(r.pct).toBeCloseTo(10);
  });
});

describe("fills imported from chain", () => {
  it("prices a SOL-paid swap from the route's USDC leg, and says so", async () => {
    const { fillFromActivity } = await import("@/components/app/useJournal");
    const fill = fillFromActivity({
      signature: "sig",
      time: 1_700_000_000,
      kind: "received",
      tokenTicker: "TSLAX",
      tokenAmount: 0.01058247,
      usdcAmount: null,
      routeUsdcAmount: 4.007407,
      failed: false,
    });
    expect(fill).toMatchObject({ ticker: "TSLA", side: "buy", tokenAmount: 0.01058247, usdcAmount: 4.007407, priced: "chain" });
  });

  it("prefers the wallet's own USDC when it moved", async () => {
    const { fillFromActivity } = await import("@/components/app/useJournal");
    const fill = fillFromActivity({
      signature: "sig2",
      time: 1_700_000_000,
      kind: "bought",
      tokenTicker: "NVDAX",
      tokenAmount: 1,
      usdcAmount: 226.45,
      routeUsdcAmount: 226.45,
      failed: false,
    });
    expect(fill).toMatchObject({ usdcAmount: 226.45, priced: "kolu" });
  });

  it("ignores plain transfers and failed transactions", async () => {
    const { fillFromActivity } = await import("@/components/app/useJournal");
    const base = { signature: "s", time: 1, tokenTicker: "TSLAX", tokenAmount: 1, usdcAmount: null, routeUsdcAmount: null, failed: false } as const;
    expect(fillFromActivity({ ...base, kind: "received" })).toBeNull();
    expect(fillFromActivity({ ...base, kind: "bought", usdcAmount: 10, failed: true })).toBeNull();
  });
});
