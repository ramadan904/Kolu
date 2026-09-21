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
