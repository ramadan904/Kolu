import { describe, expect, it } from "vitest";
import { alignBasis } from "@/lib/data/market-history";

describe("alignBasis", () => {
  it("measures each token bar against the last equity print at or before it", () => {
    const equity = [
      { t: 100, close: 100 },
      { t: 200, close: 110 },
    ];
    const token = [
      { t: 150, close: 101 }, // vs 100 -> +100bps
      { t: 200, close: 110 }, // vs 110 -> 0
      { t: 900, close: 121 }, // vs stale 110 (market shut) -> +1000bps
    ];
    const out = alignBasis(token, equity);
    expect(out.map((p) => Math.round(p.basisBps))).toEqual([100, 0, 1000]);
    expect(out[0].t).toBe(150_000);
  });

  it("drops token bars from before the first equity print", () => {
    const out = alignBasis([{ t: 50, close: 1 }, { t: 150, close: 100 }], [{ t: 100, close: 100 }]);
    expect(out).toHaveLength(1);
  });

  it("ignores empty or non-positive prices and unsorted input", () => {
    const out = alignBasis(
      [{ t: 300, close: 99 }, { t: 200, close: 0 }],
      [{ t: 250, close: 100 }, { t: 100, close: -1 }],
    );
    expect(out).toHaveLength(1);
    expect(Math.round(out[0].basisBps)).toBe(-100);
  });
});
