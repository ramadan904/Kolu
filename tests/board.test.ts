import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBoard } from "@/lib/board";
import { FixtureSource } from "@/lib/data/fixtures";
import { PythSource } from "@/lib/data/pyth";
import { symbolsFor, CORE_UNIVERSE } from "@/lib/universe";

const WEEKEND = new Date("2026-09-20T16:00:00Z");
const OPEN = new Date("2026-09-21T14:00:00Z");

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("FixtureSource", () => {
  it("is deterministic across instances", async () => {
    const symbols = symbolsFor(CORE_UNIVERSE);
    const a = await new FixtureSource({ scenario: "calm", now: () => OPEN }).getLatest(symbols);
    const b = await new FixtureSource({ scenario: "calm", now: () => OPEN }).getLatest(symbols);
    expect([...a.values()].map((r) => r.price)).toEqual([...b.values()].map((r) => r.price));
  });

  it("returns a reading for every requested symbol", async () => {
    const symbols = symbolsFor(CORE_UNIVERSE);
    const prices = await new FixtureSource().getLatest(symbols);
    expect(prices.size).toBe(symbols.length);
  });

  it("ages the equity reference by scenario", async () => {
    const symbols = symbolsFor(CORE_UNIVERSE);
    const weekend = await new FixtureSource({
      scenario: "weekend_drift",
      now: () => WEEKEND,
    }).getLatest(symbols);
    const live = await new FixtureSource({
      scenario: "live_dislocation",
      now: () => OPEN,
    }).getLatest(symbols);

    const nowS = Math.floor(WEEKEND.getTime() / 1000);
    const weekendEquity = weekend.get("Equity.US.AAPL/USD")!;
    expect(nowS - weekendEquity.publishTime).toBeGreaterThan(3600);

    const liveEquity = live.get("Equity.US.AAPL/USD")!;
    expect(Math.floor(OPEN.getTime() / 1000) - liveEquity.publishTime).toBeLessThan(60);
  });
});

describe("buildBoard", () => {
  beforeEach(() => {
    process.env.KOLU_PRICE_SOURCE = "fixture";
  });

  it("ranks the widest dislocation first", async () => {
    process.env.KOLU_SCENARIO = "live_dislocation";
    const board = await buildBoard({ now: OPEN });
    const widest = Math.abs(board.readings[0].basisBps ?? 0);
    for (const r of board.readings.slice(1)) {
      expect(widest).toBeGreaterThanOrEqual(Math.abs(r.basisBps ?? 0));
    }
    expect(board.summary.widestTicker).toBe(board.readings[0].ticker);
  });

  it("labels weekend readings as drift against a stale reference", async () => {
    process.env.KOLU_SCENARIO = "weekend_drift";
    const board = await buildBoard({ now: WEEKEND });
    expect(board.session.phase).toBe("weekend");
    expect(board.readings.every((r) => r.signal === "stale_reference")).toBe(true);
    expect(board.summary.actionable).toBeGreaterThan(0);
  });

  it("finds nothing actionable in a calm market", async () => {
    process.env.KOLU_SCENARIO = "calm";
    const board = await buildBoard({ now: OPEN });
    expect(board.readings.every((r) => r.signal === "noise")).toBe(true);
    expect(board.summary.actionable).toBe(0);
  });

  it("flags a stalled reference during the session", async () => {
    process.env.KOLU_SCENARIO = "degraded";
    const board = await buildBoard({ now: OPEN });
    expect(board.readings.some((r) => r.signal === "degraded_feed")).toBe(true);
  });

  it("falls back to fixtures and says so when the live source is unreachable", async () => {
    process.env.KOLU_PRICE_SOURCE = "pyth";
    process.env.PYTH_HERMES_ENDPOINT = "http://127.0.0.1:1";
    const board = await buildBoard({ now: WEEKEND });

    expect(board.fellBack).toBe(true);
    expect(board.source).toBe("fixture");
    expect(board.fallbackReason).toBeTruthy();
    expect(board.readings.length).toBe(CORE_UNIVERSE.length);
  });
});

describe("PythSource", () => {
  it("applies the exponent to price and confidence", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/v2/price_feeds")) {
        return new Response(
          JSON.stringify([
            { id: "0xABC", attributes: { symbol: "Equity.US.AAPL/USD", asset_type: "equity" } },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          parsed: [
            {
              id: "abc",
              price: { price: "23840123", conf: "12000", expo: -5, publish_time: 1758463200 },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const source = new PythSource({ fetchImpl });
    const prices = await source.getLatest(["Equity.US.AAPL/USD"]);
    const aapl = prices.get("Equity.US.AAPL/USD")!;

    expect(aapl.price).toBeCloseTo(238.40123, 6);
    expect(aapl.confidence).toBeCloseTo(0.12, 6);
    expect(aapl.feedId).toBe("abc"); // 0x stripped, lowercased
  });

  it("ignores feeds whose symbol is not an exact match", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/v2/price_feeds")) {
        return new Response(
          JSON.stringify([
            { id: "0x01", attributes: { symbol: "Equity.US.AAPLW/USD", asset_type: "equity" } },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ parsed: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const feeds = await new PythSource({ fetchImpl }).resolveFeeds(["Equity.US.AAPL/USD"]);
    expect(feeds.size).toBe(0);
  });

  it("surfaces a bad exponent instead of returning a wrong price", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/v2/price_feeds")) {
        return new Response(
          JSON.stringify([
            { id: "0x01", attributes: { symbol: "Equity.US.AAPL/USD", asset_type: "equity" } },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          parsed: [{ id: "01", price: { price: "100", conf: "1", expo: null, publish_time: 1 } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await expect(new PythSource({ fetchImpl }).getLatest(["Equity.US.AAPL/USD"])).rejects.toThrow(
      /exponent/,
    );
  });
});
