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
  it("reuses one instance per endpoint", () => {
    process.env.KOLU_PRICE_SOURCE = "pyth";
    process.env.PYTH_HERMES_ENDPOINT = "https://example.test";
    resetSources();
    expect(resolveSource().source).toBe(resolveSource().source);
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
