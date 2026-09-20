import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  observed,
  observedMinutes,
  prune,
  record,
} from "@/lib/client-history";

const NOW = Date.parse("2026-09-20T18:00:00Z");

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  clearHistory();
});

describe("record", () => {
  it("keeps what it is given", () => {
    record("SPY", 120, NOW);
    expect(observed("SPY", NOW)).toEqual([{ t: NOW, basisBps: 120 }]);
  });

  it("throttles points taken close together", () => {
    record("SPY", 120, NOW);
    record("SPY", 121, NOW + 10_000);
    record("SPY", 130, NOW + 60_000);
    expect(observed("SPY", NOW + 60_000)).toHaveLength(2);
  });

  it("ignores a non-finite basis", () => {
    record("SPY", Number.NaN, NOW);
    expect(observed("SPY", NOW)).toHaveLength(0);
  });

  it("keeps tickers apart", () => {
    record("SPY", 10, NOW);
    record("AAPL", 20, NOW);
    expect(observed("SPY", NOW)).toHaveLength(1);
    expect(observed("TSLA", NOW)).toHaveLength(0);
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    } as unknown as Storage);
    // A private window must not take the board down with it.
    expect(() => record("SPY", 120, NOW)).not.toThrow();
    expect(observed("SPY", NOW)).toEqual([]);
  });
});

describe("prune", () => {
  it("drops points older than the window", () => {
    const old = NOW - 49 * 60 * 60 * 1000;
    expect(prune([{ t: old, basisBps: 5 }, { t: NOW, basisBps: 9 }], NOW)).toHaveLength(1);
  });

  it("drops malformed entries without losing good ones", () => {
    const out = prune(
      [{ t: NOW, basisBps: 5 }, { nope: true }, { t: "x", basisBps: 1 }, null],
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it("rejects points from the future", () => {
    // A clock change must not create history that has not happened.
    expect(prune([{ t: NOW + 10 * 60_000, basisBps: 5 }], NOW)).toHaveLength(0);
  });

  it("sorts by time", () => {
    const out = prune(
      [{ t: NOW, basisBps: 2 }, { t: NOW - 60_000, basisBps: 1 }],
      NOW,
    );
    expect(out.map((p) => p.basisBps)).toEqual([1, 2]);
  });

  it("returns an empty array for junk", () => {
    expect(prune(null, NOW)).toEqual([]);
    expect(prune("nope", NOW)).toEqual([]);
  });
});

describe("observedMinutes", () => {
  it("reports the span of real history", () => {
    record("SPY", 10, NOW);
    record("SPY", 12, NOW + 30 * 60_000);
    expect(observedMinutes("SPY", NOW + 30 * 60_000)).toBe(30);
  });

  it("is zero with fewer than two points", () => {
    record("SPY", 10, NOW);
    expect(observedMinutes("SPY", NOW)).toBe(0);
  });
});
