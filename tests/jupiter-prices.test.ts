import { describe, expect, it } from "vitest";
import { JupiterPriceSource } from "@/lib/data/jupiter-prices";
import type { MintRegistry } from "@/lib/mints";

const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

const mints: MintRegistry = {
  quote: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  tokens: {
    AAPL: { mint: AAPLX, decimals: 8 },
    SPY: { mint: SPYX, decimals: 8 },
  },
};

const NOW = new Date("2026-09-20T18:00:00Z");

function source(body: unknown) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  return new JupiterPriceSource({ mints, fetchImpl, now: () => NOW });
}

// The shape observed live on 2026-09-20.
const LIVE = {
  [AAPLX]: {
    usdPrice: 333.9619794989475,
    decimals: 8,
    stockData: { id: "xstocks", price: 334.875, updatedAt: "2026-09-20T17:45:41.846Z" },
  },
};

describe("JupiterPriceSource", () => {
  it("reads both legs out of one response", async () => {
    const prices = await source(LIVE).getLatest([
      "Equity.US.AAPL/USD",
      "Crypto.AAPLX/USD",
    ]);

    expect(prices.get("Crypto.AAPLX/USD")?.price).toBeCloseTo(333.962, 3);
    // stockData.price is the real share price — the leg that used to need Pyth.
    expect(prices.get("Equity.US.AAPL/USD")?.price).toBeCloseTo(334.875, 3);
  });

  it("gives the equity leg the venue's own timestamp so staleness is real", async () => {
    const prices = await source(LIVE).getLatest(["Equity.US.AAPL/USD"]);
    expect(prices.get("Equity.US.AAPL/USD")?.publishTime).toBe(
      Math.floor(Date.parse("2026-09-20T17:45:41.846Z") / 1000),
    );
  });

  it("omits the equity leg rather than reusing the token price", async () => {
    // Filling a missing stock price with the token price makes every basis
    // exactly zero — a wrong answer that looks like a calm market.
    const prices = await source({
      [AAPLX]: { usdPrice: 333.96 },
    }).getLatest(["Equity.US.AAPL/USD", "Crypto.AAPLX/USD"]);

    expect(prices.has("Crypto.AAPLX/USD")).toBe(true);
    expect(prices.has("Equity.US.AAPL/USD")).toBe(false);
  });

  it("carries a confidence so the noise floor still works", async () => {
    const prices = await source(LIVE).getLatest(["Crypto.AAPLX/USD"]);
    const reading = prices.get("Crypto.AAPLX/USD")!;
    expect(reading.confidence).toBeGreaterThan(0);
    expect(reading.confidence / reading.price).toBeCloseTo(0.0006, 6);
    expect(reading.source).toBe("jupiter");
  });

  it("skips malformed and non-positive prices", async () => {
    const prices = await source({
      [AAPLX]: { usdPrice: 0 },
      [SPYX]: { usdPrice: "not a number" },
    }).getLatest(["Crypto.AAPLX/USD", "Crypto.SPYX/USD"]);
    expect(prices.size).toBe(0);
  });

  it("refuses to run without configured mints", async () => {
    const empty = new JupiterPriceSource({
      mints: { quote: null, tokens: {} },
      fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });
    await expect(empty.getLatest(["Crypto.AAPLX/USD"])).rejects.toThrow(/mints/);
  });
});
