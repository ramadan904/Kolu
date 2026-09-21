import { describe, expect, it } from "vitest";
import { computeEdge, sideForGap } from "../src/lib/basis/edge";
import { convergenceUsd, describeTradeError, fromBaseUnits } from "../src/lib/trade";

const ctx = { slippageBps: 30, payUnit: "USDC" };

describe("describeTradeError", () => {
  it("treats a wallet rejection as a cancel, not a failure", () => {
    expect(describeTradeError(new Error("User rejected the request."), ctx)).toMatch(/cancelled/);
  });

  it("names the slippage limit when Jupiter's tolerance check trips", () => {
    const msg = describeTradeError(new Error("custom program error: 0x1771"), ctx);
    expect(msg).toMatch(/0\.3% limit/);
    expect(msg).toMatch(/nothing was filled/);
  });

  it("separates missing SOL for fees from a short token balance", () => {
    expect(describeTradeError(new Error("insufficient lamports 100, need 5000"), ctx)).toMatch(/SOL/);
    expect(describeTradeError(new Error("custom program error: 0x1"), ctx)).toMatch(/Not enough USDC/);
  });

  it("does not mistake 0x1771 for the token program's 0x1", () => {
    expect(describeTradeError(new Error("custom program error: 0x1771"), ctx)).not.toMatch(/Not enough/);
  });

  it("says balances are unchanged when it cannot classify the error", () => {
    expect(describeTradeError("weird", ctx)).toMatch(/unchanged/);
  });
});

describe("convergenceUsd", () => {
  it("is a loss for a holder of a rich token", () => {
    expect(convergenceUsd(10, 101, 100)).toBeCloseTo(-10);
  });
  it("is a gain for a holder of a cheap token", () => {
    expect(convergenceUsd(10, 99, 100)).toBeCloseTo(10);
  });
  it("is zero without a usable price", () => {
    expect(convergenceUsd(10, 0, 100)).toBe(0);
  });
});

describe("fromBaseUnits", () => {
  it("applies decimals", () => {
    expect(fromBaseUnits("265873322", 8)).toBeCloseTo(2.65873322);
  });
  it("returns null when fields are missing", () => {
    expect(fromBaseUnits(undefined, 8)).toBeNull();
  });
});

describe("computeEdge against the gap", () => {
  it("charges the gap as a cost instead of crediting it", () => {
    const withGap = computeEdge({ basisBps: 100, notionalUsd: 10_000, hedgeable: true });
    const against = computeEdge({ basisBps: 100, notionalUsd: 10_000, hedgeable: true, against: true });
    expect(withGap.grossBps).toBe(100);
    expect(against.grossBps).toBe(-100);
    expect(against.netBps).toBeCloseTo(withGap.netBps - 200);
    expect(against.verdict).toBe("negative");
    expect(against.caveat).toMatch(/pays the gap/);
  });

  it("picks the capturing side from the gap's sign", () => {
    expect(sideForGap(50)).toBe("sell");
    expect(sideForGap(-50)).toBe("buy");
    expect(sideForGap(null)).toBe("buy");
  });
});

describe("breakevenBps", () => {
  it("is the round-trip cost of a $10k clip, rounded up to 5bps", async () => {
    const { breakevenBps, computeEdge } = await import("../src/lib/basis/edge");
    const cost = computeEdge({ basisBps: 0, notionalUsd: 10_000, hedgeable: true }).costBps;
    const be = breakevenBps();
    expect(be % 5).toBe(0);
    expect(be).toBeGreaterThanOrEqual(cost);
    expect(be - cost).toBeLessThan(5);
  });
});

describe("decodeU64Base64", () => {
  it("reads Jupiter's little-endian return amount", async () => {
    const { decodeU64Base64 } = await import("../src/lib/trade");
    // Captured from a mainnet simulation of a $2,000 USDC -> TSLAX swap.
    expect(decodeU64Base64("l0nJHwAAAAA=")).toBe(533_285_271n);
    expect(decodeU64Base64("8ngadwAAAAA=")).toBe(1_998_223_602n);
  });
  it("rejects missing or short data", async () => {
    const { decodeU64Base64 } = await import("../src/lib/trade");
    expect(decodeU64Base64(undefined)).toBeNull();
    expect(decodeU64Base64("AAA=")).toBeNull();
  });
});

describe("jupiterOutAmount", () => {
  it("prefers Jupiter's own return log over a later program's returnData", async () => {
    const { jupiterOutAmount } = await import("../src/lib/trade");
    const logs = [
      "Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke [1]",
      "Program return: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 l0nJHwAAAAA=",
      "Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 success",
      "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [1]",
    ];
    const other = { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: ["AQAAAAAAAAA=", "base64"] };
    expect(jupiterOutAmount(logs, other)).toBe(533_285_271n);
  });
  it("ignores returnData from another program when there is no log line", async () => {
    const { jupiterOutAmount } = await import("../src/lib/trade");
    expect(jupiterOutAmount([], { programId: "Other", data: ["AQAAAAAAAAA=", "base64"] })).toBeNull();
  });
});
