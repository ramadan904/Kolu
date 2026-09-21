import { describe, expect, it } from "vitest";
import { pollConfirmation, type StatusReader } from "../src/lib/confirm";

type Status = { err: unknown; confirmationStatus?: string } | null;

/** A fake chain: `statuses` are returned in order (last one repeats), heights likewise. */
function chain(statuses: Status[], heights: number[], opts: { failFirst?: number } = {}) {
  let s = 0;
  let h = 0;
  let failures = opts.failFirst ?? 0;
  const reader = {
    async getSignatureStatuses() {
      if (failures > 0) {
        failures -= 1;
        throw new Error("fetch failed");
      }
      const value = statuses[Math.min(s, statuses.length - 1)];
      s += 1;
      return { context: { slot: 0 }, value: [value] };
    },
    async getBlockHeight() {
      const value = heights[Math.min(h, heights.length - 1)];
      h += 1;
      return value;
    },
  };
  return reader as unknown as StatusReader;
}

const fast = { intervalMs: 1, timeoutMs: 200 };

describe("pollConfirmation", () => {
  it("confirms once the cluster reports confirmed", async () => {
    const c = chain([null, { err: null, confirmationStatus: "processed" }, { err: null, confirmationStatus: "confirmed" }], [10]);
    expect(await pollConfirmation(c, "sig", 100, fast)).toEqual({ status: "confirmed" });
  });

  it("reports an on-chain failure with its error, not as filled", async () => {
    const err = { InstructionError: [3, { Custom: 6001 }] };
    const c = chain([{ err, confirmationStatus: "confirmed" }], [10]);
    expect(await pollConfirmation(c, "sig", 100, fast)).toEqual({ status: "failed", err });
  });

  it("calls it expired only past the last valid height and absent from history", async () => {
    const c = chain([null], [99, 101]);
    expect(await pollConfirmation(c, "sig", 100, fast)).toEqual({ status: "expired" });
  });

  it("finds a transaction that landed in the last valid block", async () => {
    const c = chain([null, { err: null, confirmationStatus: "finalized" }], [101]);
    expect(await pollConfirmation(c, "sig", 100, fast)).toEqual({ status: "confirmed" });
  });

  it("says unknown, never expired, when it simply runs out of time", async () => {
    const c = chain([null], [10]);
    expect(await pollConfirmation(c, "sig", 100, { intervalMs: 5, timeoutMs: 30 })).toEqual({
      status: "unknown",
    });
  });

  it("rides out failed polls instead of returning a verdict", async () => {
    const c = chain([{ err: null, confirmationStatus: "confirmed" }], [10], { failFirst: 2 });
    expect(await pollConfirmation(c, "sig", 100, fast)).toEqual({ status: "confirmed" });
  });
});
