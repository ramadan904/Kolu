import { describe, expect, it } from "vitest";
import {
  DEFAULT_COOLDOWN_MS,
  evaluate,
  makeRule,
  matchesDirection,
  type AlertRule,
} from "@/lib/alerts";
import type { BasisReading, BasisSignal } from "@/lib/basis/compute";

const NOW = Date.parse("2026-09-21T14:00:00Z");

function reading(
  ticker: string,
  basisBps: number,
  signal: BasisSignal = "actionable",
): BasisReading {
  return {
    ticker,
    name: ticker,
    tokenTicker: `${ticker}X`,
    equity: null,
    token: null,
    basisBps,
    basisUsd: null,
    direction: basisBps > 0 ? "premium" : "discount",
    confidenceBps: 5,
    signal,
    referenceQuality: signal === "stale_reference" ? "stale" : "live",
    referenceAgeSeconds: 3,
    tokenAgeSeconds: 3,
    note: null,
  };
}

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  ...makeRule("AAPL", 100),
  ...over,
});

describe("matchesDirection", () => {
  it("filters by sign, and 'either' takes both", () => {
    expect(matchesDirection("premium", 150)).toBe(true);
    expect(matchesDirection("premium", -150)).toBe(false);
    expect(matchesDirection("discount", -150)).toBe(true);
    expect(matchesDirection("discount", 150)).toBe(false);
    expect(matchesDirection("either", -150)).toBe(true);
    expect(matchesDirection("either", 150)).toBe(true);
  });
});

describe("evaluate", () => {
  it("fires when the gap crosses the threshold", () => {
    const { hits, rules } = evaluate([rule()], [reading("AAPL", 150)], NOW);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("AAPLX");
    expect(hits[0].message).toContain("1.50%");
    expect(rules[0].lastFiredAt).toBe(NOW);
  });

  it("stays silent below the threshold", () => {
    expect(evaluate([rule()], [reading("AAPL", 80)], NOW).hits).toHaveLength(0);
  });

  it("never fires on a gap inside the noise floor", () => {
    // Wide enough in raw bps, but the board already judged it indistinguishable
    // from oracle noise.
    const { hits } = evaluate([rule()], [reading("AAPL", 400, "noise")], NOW);
    expect(hits).toHaveLength(0);
  });

  it("never fires on a stalled feed", () => {
    // A reference that has stopped ticking manufactures an arbitrarily large
    // apparent basis. Waking someone at 3am for a data outage dressed up as an
    // opportunity is the worst thing this feature could do.
    const { hits } = evaluate([rule()], [reading("AAPL", 900, "degraded_feed")], NOW);
    expect(hits).toHaveLength(0);
  });

  it("does fire on weekend drift, which is real", () => {
    const { hits } = evaluate([rule()], [reading("AAPL", 220, "stale_reference")], NOW);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("not hedgeable");
  });

  it("honours the direction filter", () => {
    const premiumOnly = rule({ direction: "premium" });
    expect(evaluate([premiumOnly], [reading("AAPL", -150)], NOW).hits).toHaveLength(0);
    expect(evaluate([premiumOnly], [reading("AAPL", 150)], NOW).hits).toHaveLength(1);
  });

  it("does not re-fire during the cooldown", () => {
    const first = evaluate([rule()], [reading("AAPL", 150)], NOW);
    expect(first.hits).toHaveLength(1);

    const soon = evaluate(first.rules, [reading("AAPL", 160)], NOW + 60_000);
    expect(soon.hits).toHaveLength(0);

    const later = evaluate(first.rules, [reading("AAPL", 160)], NOW + DEFAULT_COOLDOWN_MS + 1);
    expect(later.hits).toHaveLength(1);
  });

  it("ignores rules for tickers not on the board", () => {
    const { hits } = evaluate([rule({ ticker: "ZZZZ" })], [reading("AAPL", 400)], NOW);
    expect(hits).toHaveLength(0);
  });

  it("ignores a reading with no basis", () => {
    const blank = { ...reading("AAPL", 0, "unavailable"), basisBps: null };
    expect(evaluate([rule()], [blank], NOW).hits).toHaveLength(0);
  });

  it("leaves untriggered rules untouched", () => {
    const original = rule();
    const { rules } = evaluate([original], [reading("AAPL", 10)], NOW);
    expect(rules[0]).toBe(original);
  });

  it("evaluates every rule independently", () => {
    const rules = [rule({ ticker: "AAPL" }), rule({ ticker: "NVDA" })];
    const { hits } = evaluate(rules, [reading("AAPL", 150), reading("NVDA", 20)], NOW);
    expect(hits.map((h) => h.ticker)).toEqual(["AAPL"]);
  });
});

describe("makeRule", () => {
  it("normalises input", () => {
    const r = makeRule("aapl", 120.6);
    expect(r.ticker).toBe("AAPL");
    expect(r.thresholdBps).toBe(121);
    expect(r.lastFiredAt).toBeNull();
  });

  it("refuses a zero threshold, which would fire constantly", () => {
    expect(makeRule("AAPL", 0).thresholdBps).toBe(1);
    expect(makeRule("AAPL", -50).thresholdBps).toBe(1);
  });

  it("gives every rule a distinct id", () => {
    const ids = new Set([makeRule("AAPL", 10).id, makeRule("AAPL", 10).id]);
    expect(ids.size).toBe(2);
  });
});
