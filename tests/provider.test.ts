import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildBoard, clearBoardCache } from "@/lib/board";
import { resetSources, resolveSource } from "@/lib/data/provider";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  resetSources();
  clearBoardCache();
});

describe("shared price source", () => {
  it("reuses one instance per endpoint", async () => {
    process.env.KOLU_PRICE_SOURCE = "pyth";
    process.env.PYTH_HERMES_ENDPOINT = "https://example.test";
    resetSources();
    expect((await resolveSource()).source).toBe((await resolveSource()).source);
  });

  it("does not re-resolve feeds on every board build", async () => {
    // Regression: the feed and negative caches live on the source instance, so
    // constructing a new one per build threw them away and re-resolved every
    // symbol every time — the exact request storm the caches exist to prevent.
    let feedRequests = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      res.writeHead(200, { "content-type": "application/json" });

      if (url.pathname.includes("price_feeds")) {
        feedRequests += 1;
        const query = url.searchParams.get("query") ?? "";
        const symbol = `Equity.US.${query}/USD`;
        res.end(
          JSON.stringify([{ id: `a${query}`.padEnd(64, "0"), attributes: { symbol } }]),
        );
        return;
      }

      const ids = url.searchParams.getAll("ids[]");
      const now = Math.floor(Date.now() / 1000);
      res.end(
        JSON.stringify({
          parsed: ids.map((id) => ({
            id,
            price: { price: "10000000", conf: "2000", expo: -5, publish_time: now - 2 },
          })),
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    process.env.KOLU_PRICE_SOURCE = "pyth";
    process.env.PYTH_HERMES_ENDPOINT = `http://127.0.0.1:${port}`;
    process.env.KOLU_BOARD_CACHE_MS = "0"; // isolate the feed cache from the snapshot cache
    resetSources();

    try {
      await buildBoard({ tier: "core" });
      const afterFirst = feedRequests;
      expect(afterFirst).toBeGreaterThan(0);

      for (let i = 0; i < 5; i += 1) await buildBoard({ tier: "core" });

      // Five more builds, zero further resolution requests.
      expect(feedRequests).toBe(afterFirst);
    } finally {
      server.close();
    }
  });
});

describe("which price source serves", () => {
  it("serves Jupiter with no key, so the board is live without one", async () => {
    delete process.env.PYTH_API_KEY;
    delete process.env.KOLU_PRICE_SOURCE;
    expect((await resolveSource()).mode).toBe("jupiter");
  });

  it("switches to Pyth the moment a key is configured", async () => {
    process.env.PYTH_API_KEY = "pyth-key";
    delete process.env.KOLU_PRICE_SOURCE;
    expect((await resolveSource()).mode).toBe("pyth");
  });

  it("treats a blank key as no key", async () => {
    process.env.PYTH_API_KEY = "   ";
    delete process.env.KOLU_PRICE_SOURCE;
    expect((await resolveSource()).mode).toBe("jupiter");
  });

  it("still lets a forced fixture win, so a demo is never accidentally live", async () => {
    process.env.PYTH_API_KEY = "pyth-key";
    process.env.KOLU_PRICE_SOURCE = "fixture";
    expect((await resolveSource()).mode).toBe("fixture");
  });
});

describe("the Pyth path, end to end", () => {
  /**
   * Hermes shapes with invented numbers: every pair gets the same 40bps gap,
   * but TSLA publishes a wide confidence and NVDA a narrow one. If the noise
   * floor really comes from the feed, those two must land on opposite sides of
   * it — which the ±6bps assumption could never produce.
   */
  const hermes = (confBps: (ticker: string) => number) =>
    createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      res.writeHead(200, { "content-type": "application/json" });
      const id = (symbol: string) => Buffer.from(symbol).toString("hex").padEnd(64, "0").slice(0, 64);

      if (url.pathname.includes("price_feeds")) {
        const q = (url.searchParams.get("query") ?? "").toUpperCase();
        const symbols = ["TSLA", "NVDA"].flatMap((t) => [`Equity.US.${t}/USD`, `Crypto.${t}X/USD`]);
        res.end(
          JSON.stringify(
            symbols.filter((s) => s.toUpperCase().includes(q)).map((s) => ({ id: id(s), attributes: { symbol: s } })),
          ),
        );
        return;
      }

      const ids = url.searchParams.getAll("ids[]").map((x) => x.replace(/^0x/, ""));
      const now = Math.floor(Date.now() / 1000);
      const parsed = ["TSLA", "NVDA"].flatMap((t) =>
        [`Equity.US.${t}/USD`, `Crypto.${t}X/USD`].map((symbol) => {
          const base = t === "TSLA" ? 400 : 200;
          // The token trades 40bps above its share, whatever the band.
          const price = symbol.startsWith("Crypto.") ? base * 1.004 : base;
          return {
            id: id(symbol),
            price: {
              price: String(Math.round(price * 1e8)),
              conf: String(Math.round(((price * confBps(t)) / 10_000) * 1e8)),
              expo: -8,
              publish_time: now,
            },
          };
        }),
      ).filter((row) => ids.includes(row.id));
      res.end(JSON.stringify({ parsed }));
    });

  it("takes the noise floor from each feed's published confidence", async () => {
    const server = hermes((t) => (t === "TSLA" ? 120 : 5));
    await new Promise<void>((done) => server.listen(0, done));
    const { port } = server.address() as AddressInfo;
    try {
      process.env.PYTH_API_KEY = "test-key";
      delete process.env.KOLU_PRICE_SOURCE;
      process.env.PYTH_HERMES_ENDPOINT = `http://127.0.0.1:${port}`;
      resetSources();
      clearBoardCache();

      const board = await buildBoard({ tier: "all" });
      expect(board.source).toBe("pyth");

      const tsla = board.readings.find((r) => r.ticker === "TSLA");
      const nvda = board.readings.find((r) => r.ticker === "NVDA");
      // Both gaps are 40bps; only the published bands differ.
      expect(Math.round(tsla!.basisBps!)).toBe(40);
      expect(Math.round(nvda!.basisBps!)).toBe(40);
      // 120bps a leg → 240bps combined; 5bps a leg → 10bps. Neither is the 6bps assumption.
      expect(Math.round(tsla!.confidenceBps!)).toBe(240);
      expect(Math.round(nvda!.confidenceBps!)).toBe(10);
      // And the classification follows the feed, not the gap. Which flavour of
      // signal the narrow pair gets depends on whether the US market happens to
      // be open while the test runs; what must hold is that it escapes the floor
      // and the wide one does not.
      expect(tsla!.signal).toBe("noise");
      expect(["actionable", "stale_reference"]).toContain(nvda!.signal);
    } finally {
      server.close();
    }
  }, 30_000);
});
