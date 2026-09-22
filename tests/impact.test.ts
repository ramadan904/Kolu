import { describe, expect, it } from "vitest";
import { boundedImpactBps } from "@/lib/trade";

describe("boundedImpactBps", () => {
  it("caps a spiking reported impact at the quote's realised cost", () => {
    // Sold $2,000 of token at mid 226.45, received 1,988.89 USDC: ~55bps realised.
    const bps = boundedImpactBps({ reportedBps: 70, side: "sell", inAmount: 2000 / 226.45, outAmount: 1988.89, price: 226.45 });
    expect(bps).toBeCloseTo(55.6, 0);
  });

  it("keeps the reported impact when it is within the realised cost", () => {
    // Paid 1,000 USDC for 4.39 tokens at mid 226.45: ~59bps realised, 12 reported.
    expect(boundedImpactBps({ reportedBps: 12, side: "buy", inAmount: 1000, outAmount: 4.39, price: 226.45 })).toBe(12);
  });

  it("claims no impact on a fill better than mid", () => {
    expect(boundedImpactBps({ reportedBps: 3, side: "sell", inAmount: 1, outAmount: 227, price: 226.45 })).toBe(0);
  });

  it("falls back to the reported figure without a usable price", () => {
    expect(boundedImpactBps({ reportedBps: 8, side: "buy", inAmount: 1000, outAmount: 4, price: 0 })).toBe(8);
    expect(boundedImpactBps({ reportedBps: -2, side: "buy", inAmount: 1000, outAmount: 4, price: 0 })).toBe(0);
  });
});

describe("boundedImpactBps paying in SOL", () => {
  it("prices the SOL leg at its USD price", () => {
    // Paid 0.02 SOL at $150 ($3) for 0.013 tokens at mid 226.45 ($2.944): ~187bps realised.
    const bps = boundedImpactBps({ reportedBps: 400, side: "buy", inAmount: 0.02, outAmount: 0.013, price: 226.45, payPriceUsd: 150 });
    expect(bps).toBeCloseTo(187.2, 0);
  });
});
