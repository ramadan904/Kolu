import { describe, expect, it } from "vitest";
import { fmtAmount, parseTokenBalances } from "@/lib/tokens";

const account = (mint: string, amount: string, decimals: number) => ({
  account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } },
});

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

describe("parseTokenBalances", () => {
  it("applies decimals to raw units", () => {
    const out = parseTokenBalances([account(USDC, "1500000", 6)]);
    expect(out.get(USDC)?.amount).toBeCloseTo(1.5, 9);
    expect(out.get(USDC)?.decimals).toBe(6);
  });

  it("accepts the RPC's wrapped { value: [...] } shape", () => {
    const out = parseTokenBalances({ value: [account(SPYX, "250000000", 8)] });
    expect(out.get(SPYX)?.amount).toBeCloseTo(2.5, 9);
  });

  it("sums multiple accounts for the same mint", () => {
    // One owner can hold several token accounts for a mint. Overwriting means
    // showing whichever happened to come back last.
    const out = parseTokenBalances([
      account(SPYX, "100000000", 8),
      account(SPYX, "50000000", 8),
    ]);
    expect(out.get(SPYX)?.amount).toBeCloseTo(1.5, 9);
  });

  it("skips malformed accounts without losing the good ones", () => {
    const out = parseTokenBalances([
      { account: { data: { parsed: { info: { mint: 42 } } } } },
      { nonsense: true },
      account(USDC, "2000000", 6),
      account(SPYX, "not-a-number", 8),
      { account: { data: { parsed: { info: { mint: SPYX, tokenAmount: { amount: "1", decimals: 2.5 } } } } } },
    ]);
    expect(out.size).toBe(1);
    expect(out.get(USDC)?.amount).toBeCloseTo(2, 9);
  });

  it("returns an empty map for junk input", () => {
    expect(parseTokenBalances(null).size).toBe(0);
    expect(parseTokenBalances(undefined).size).toBe(0);
    expect(parseTokenBalances("nope").size).toBe(0);
  });

  it("handles a zero balance as zero, not as missing", () => {
    const out = parseTokenBalances([account(SPYX, "0", 8)]);
    expect(out.has(SPYX)).toBe(true);
    expect(out.get(SPYX)?.amount).toBe(0);
  });
});

describe("fmtAmount", () => {
  it("scales precision to magnitude", () => {
    expect(fmtAmount(0)).toBe("0");
    expect(fmtAmount(1234.5678)).toBe("1,234.57");
    expect(fmtAmount(0.123456789)).toBe("0.123457");
    expect(fmtAmount(0.0000001)).toContain("e-");
  });
});
