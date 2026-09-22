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

describe("gapContext", () => {
  const mk = (bps: number[], phase: "regular" | "closed") =>
    bps.map((b, i) => ({ t: i, basisBps: b, phase }) as const);

  it("ranks today's gap against the pair's own history and splits typical by session", async () => {
    const { gapContext } = await import("@/lib/data/market-history");
    const points = [...mk(Array.from({ length: 20 }, (_, i) => i - 10), "regular"), ...mk(Array.from({ length: 20 }, (_, i) => 30 + i), "closed")];
    const c = gapContext(points, 45)!;
    expect(c.percentile).toBe(90); // 36 of 40 points at or below |45|
    expect(c.typicalOpenBps).toBe(5);
    expect(c.typicalShutBps).toBe(39.5);
  });

  it("refuses to rank against too little history", async () => {
    const { gapContext } = await import("@/lib/data/market-history");
    expect(gapContext(mk([1, 2, 3], "regular"), 2)).toBeNull();
  });
});

describe("rollingMedian / downsample", () => {
  const pts = [0, 0, 200, 0, 0, 10, 10, 10].map((b, i) => ({ t: i * 900_000, basisBps: b, phase: "regular" as const }));

  it("ignores a lone off-book print that a mean would chase", async () => {
    const { rollingMedian } = await import("@/lib/data/market-history");
    const m = rollingMedian(pts, 4);
    expect(m[2].basisBps).toBe(0);
    expect(m).toHaveLength(pts.length);
  });

  it("buckets to one median point per hour", async () => {
    const { downsample } = await import("@/lib/data/market-history");
    const d = downsample(pts, 3600_000);
    expect(d).toHaveLength(2);
    expect(d[0].basisBps).toBe(0); // [0,0,200,0]
    expect(d[1].basisBps).toBe(10); // [0,10,10,10] -> 10
  });
});
