import { describe, expect, it } from "vitest";
import { convergenceOutlook, untilOpen } from "@/lib/basis/convergence";
import { minutesToNextOpen } from "@/lib/market/session";
import type { OpenEvent } from "@/lib/data/market-history";

const open = (closedPct: number): OpenEvent => ({
  t: 0,
  beforeBps: 100,
  afterBps: 100 - closedPct,
  closedPct,
});

describe("convergenceOutlook", () => {
  it("applies the pair's median open to today's gap, after costs", () => {
    const r = convergenceOutlook([open(80), open(60), open(40)], -120, 90);
    expect(r.total).toBe(3);
    expect(r.narrowed).toBe(3);
    expect(r.medianClosedPct).toBe(60);
    // 60% of a 120bps gap is 72bps; costs eat 90.
    expect(r.expectedBps).toBeCloseTo(72);
    expect(r.netBps).toBeCloseTo(-18);
  });

  it("keeps the opens that widened in the median, and reports the worst", () => {
    const r = convergenceOutlook([open(90), open(-50), open(10)], 200, 90);
    expect(r.narrowed).toBe(1);
    expect(r.medianClosedPct).toBe(10);
    expect(r.worstClosedPct).toBe(-50);
    expect(r.expectedBps).toBeCloseTo(20);
    expect(r.netBps).toBeCloseTo(-70);
  });

  it("says nothing when the pair has no measured opens", () => {
    const r = convergenceOutlook([], 150, 90);
    expect(r.medianClosedPct).toBeNull();
    expect(r.expectedBps).toBeNull();
    expect(r.netBps).toBeNull();
  });

  it("is direction-blind: a cheap token's gap closes the same way", () => {
    const rich = convergenceOutlook([open(50)], 100, 0);
    const cheap = convergenceOutlook([open(50)], -100, 0);
    expect(rich.expectedBps).toBe(cheap.expectedBps);
  });
});

describe("untilOpen", () => {
  it("reads as a countdown", () => {
    expect(untilOpen(38)).toBe("38m");
    expect(untilOpen(252)).toBe("4h 12m");
    expect(untilOpen(120)).toBe("2h");
  });

  it("has nothing to say when the next open is unknowable", () => {
    expect(untilOpen(null)).toBeNull();
  });
});

describe("minutesToNextOpen", () => {
  const et = (iso: string) => new Date(iso);

  it("counts down to today's open before 09:30 ET", () => {
    // 2026-09-23 is a Wednesday. 05:18 ET = 09:18 UTC.
    expect(minutesToNextOpen(et("2026-09-23T09:18:00Z"))).toBe(252);
  });

  it("rolls to tomorrow once today's session is past", () => {
    // Wednesday 18:00 ET → Thursday 09:30 ET is 15h 30m.
    expect(minutesToNextOpen(et("2026-09-23T22:00:00Z"))).toBe(15 * 60 + 30);
  });

  it("skips the weekend", () => {
    // Saturday 06:30 ET → Monday 09:30 ET is 51h.
    expect(minutesToNextOpen(et("2026-09-19T10:30:00Z"))).toBe(51 * 60);
  });

  it("refuses to guess past the end of the calendar", () => {
    expect(minutesToNextOpen(et("2031-03-05T14:00:00Z"))).toBeNull();
  });
});
