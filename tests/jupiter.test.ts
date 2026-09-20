import { describe, expect, it } from "vitest";
import { JupiterSource, toBaseUnits } from "@/lib/data/jupiter";

const ok = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

const QUOTE = {
  inAmount: "10000000000",
  outAmount: "41500000000",
  priceImpactPct: "0.0023",
  routePlan: [
    { swapInfo: { label: "Meteora DLMM" } },
    { swapInfo: { label: "Orca Whirlpool" } },
  ],
};

describe("JupiterSource", () => {
  it("reads priceImpactPct as a fraction, not a percentage", async () => {
    const quote = await new JupiterSource({ fetchImpl: ok(QUOTE) }).getQuote({
      inputMint: "A".repeat(43),
      outputMint: "B".repeat(43),
      amount: 10_000_000_000n,
    });
    // 0.0023 is 23bps. Reading it as 0.0023% would give 0.23bps and turn every
    // losing trade on the board into a winner.
    expect(quote.priceImpactBps).toBeCloseTo(23, 6);
  });

  it("preserves amounts beyond Number.MAX_SAFE_INTEGER", async () => {
    const huge = "123456789012345678901";
    const quote = await new JupiterSource({
      fetchImpl: ok({ ...QUOTE, inAmount: huge, outAmount: huge }),
    }).getQuote({ inputMint: "A".repeat(43), outputMint: "B".repeat(43), amount: 1n });
    expect(quote.inAmount).toBe(BigInt(huge));
    expect(quote.inAmount.toString()).toBe(huge);
  });

  it("collects the route labels for display", async () => {
    const quote = await new JupiterSource({ fetchImpl: ok(QUOTE) }).getQuote({
      inputMint: "A".repeat(43),
      outputMint: "B".repeat(43),
      amount: 1n,
    });
    expect(quote.route).toEqual(["Meteora DLMM", "Orca Whirlpool"]);
  });

  it("treats a negative impact as magnitude", async () => {
    const quote = await new JupiterSource({
      fetchImpl: ok({ ...QUOTE, priceImpactPct: "-0.0041" }),
    }).getQuote({ inputMint: "A".repeat(43), outputMint: "B".repeat(43), amount: 1n });
    expect(quote.priceImpactBps).toBeCloseTo(41, 6);
  });

  it("fails loudly on an unparseable impact rather than assuming zero", async () => {
    const source = new JupiterSource({ fetchImpl: ok({ ...QUOTE, priceImpactPct: null }) });
    await expect(
      source.getQuote({ inputMint: "A".repeat(43), outputMint: "B".repeat(43), amount: 1n }),
    ).rejects.toThrow(/priceImpactPct/);
  });

  it("surfaces a permanent failure immediately", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("nope", { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      new JupiterSource({ fetchImpl }).getQuote({
        inputMint: "A".repeat(43),
        outputMint: "B".repeat(43),
        amount: 1n,
      }),
    ).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it("retries a rate limit before giving up", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify(QUOTE), { status: 200 });
    }) as unknown as typeof fetch;

    const quote = await new JupiterSource({ fetchImpl, sleep: async () => {} }).getQuote({
      inputMint: "A".repeat(43),
      outputMint: "B".repeat(43),
      amount: 1n,
    });
    expect(quote.priceImpactBps).toBeCloseTo(23, 6);
    expect(calls).toBe(3);
  });

  it("rejects a non-positive amount before making a request", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      new JupiterSource({ fetchImpl }).getQuote({
        inputMint: "A".repeat(43),
        outputMint: "B".repeat(43),
        amount: 0n,
      }),
    ).rejects.toThrow(/positive/);
    expect(called).toBe(false);
  });
});

describe("toBaseUnits", () => {
  it("scales a USD notional by the mint's decimals", () => {
    expect(toBaseUnits(10_000, 6)).toBe(10_000_000_000n);
    expect(toBaseUnits(0.5, 6)).toBe(500_000n);
  });

  it("does not let float error into the integer amount", () => {
    // 1.1 * 1e6 is 1100000.0000000002 in binary floating point.
    expect(toBaseUnits(1.1, 6)).toBe(1_100_000n);
  });

  it("rejects nonsense notionals", () => {
    expect(() => toBaseUnits(0, 6)).toThrow();
    expect(() => toBaseUnits(-5, 6)).toThrow();
    expect(() => toBaseUnits(Number.NaN, 6)).toThrow();
  });
});
