import { describe, expect, it } from "vitest";
import { limitAmounts, parseOrder } from "@/lib/limit";

const base = { equityPrice: 400, tokenPrice: 401, tokenDecimals: 8, usdcDecimals: 6 };

describe("limitAmounts", () => {
  it("prices a buy below the real share by the gap, spending exactly the size", () => {
    const a = limitAmounts({ ...base, side: "buy", sizeUsd: 100, gapBps: 50 })!;
    expect(a.limitPrice).toBeCloseTo(398); // 400 * (1 - 0.005)
    expect(a.makingAmount).toBe("100000000"); // 100 USDC
    expect(Number(a.takingAmount) / 1e8).toBeCloseTo(100 / 398, 6);
  });

  it("prices a sell above the real share, sizing tokens at today's token price", () => {
    const a = limitAmounts({ ...base, side: "sell", sizeUsd: 401, gapBps: 100 })!;
    expect(a.limitPrice).toBeCloseTo(404); // 400 * 1.01
    expect(a.makingAmount).toBe("100000000"); // 1 token
    expect(Number(a.takingAmount) / 1e6).toBeCloseTo(404, 4);
  });

  it("floors base units so the order is never looser than the price shown", () => {
    const a = limitAmounts({ ...base, side: "buy", sizeUsd: 10, gapBps: 0 })!;
    expect(Number(a.takingAmount)).toBeLessThanOrEqual((10 / 400) * 1e8);
  });

  it("refuses nonsense", () => {
    expect(limitAmounts({ ...base, side: "buy", sizeUsd: 0, gapBps: 50 })).toBeNull();
    expect(limitAmounts({ ...base, side: "buy", sizeUsd: 10, gapBps: -5 })).toBeNull();
    expect(limitAmounts({ ...base, equityPrice: 0, side: "buy", sizeUsd: 10, gapBps: 5 })).toBeNull();
  });
});

describe("parseOrder", () => {
  const USDC = "USDC";
  const tokens = { TSLAMINT: "TSLAX" };

  it("reads a buy (USDC in, xStock out)", () => {
    const o = parseOrder(
      { orderKey: "k", inputMint: USDC, outputMint: "TSLAMINT", makingAmount: "100", takingAmount: "0.25", remainingMakingAmount: "50" },
      tokens,
      USDC,
    )!;
    expect(o).toMatchObject({ side: "buy", ticker: "TSLAX", limitPrice: 400, usdcAmount: 100 });
    expect(o.tokensRemaining).toBeCloseTo(0.125);
  });

  it("reads a sell (xStock in, USDC out)", () => {
    const o = parseOrder(
      { orderKey: "k", inputMint: "TSLAMINT", outputMint: USDC, makingAmount: "2", takingAmount: "810", expiredAt: "2026-09-30T00:00:00Z" },
      tokens,
      USDC,
    )!;
    expect(o).toMatchObject({ side: "sell", limitPrice: 405, tokensRemaining: 2, usdcAmount: 810 });
    expect(o.expiresAt).toBe(Date.parse("2026-09-30T00:00:00Z"));
  });

  it("skips orders between mints Kolu does not track", () => {
    expect(parseOrder({ orderKey: "k", inputMint: "SOL", outputMint: USDC, makingAmount: "1", takingAmount: "1" }, tokens, USDC)).toBeNull();
  });
});
