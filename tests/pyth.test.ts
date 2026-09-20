import { describe, expect, it } from "vitest";
import { PythSource, queryKeyFor } from "@/lib/data/pyth";

interface Feed {
  id: string;
  symbol: string;
}

const CATALOG: Feed[] = [
  { id: "0xaa", symbol: "Equity.US.AAPL/USD" },
  { id: "0xax", symbol: "Crypto.AAPLX/USD" },
  { id: "0xnv", symbol: "Equity.US.NVDA/USD" },
  { id: "0xnx", symbol: "Crypto.NVDAX/USD" },
];

/** Stands in for Hermes: substring match over the catalog, like the real one. */
function makeHermes(catalog: Feed[] = CATALOG) {
  const queries: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("/v2/price_feeds")) {
      const query = new URL(href).searchParams.get("query") ?? "";
      queries.push(query);
      const hits = catalog
        .filter((f) => f.symbol.includes(query))
        .map((f) => ({ id: f.id, attributes: { symbol: f.symbol, asset_type: "equity" } }));
      return new Response(JSON.stringify(hits), { status: 200 });
    }
    return new Response(JSON.stringify({ parsed: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, queries };
}

describe("queryKeyFor", () => {
  it("extracts the ticker Hermes is searched by", () => {
    expect(queryKeyFor("Equity.US.AAPL/USD")).toBe("AAPL");
    expect(queryKeyFor("Crypto.AAPLX/USD")).toBe("AAPLX");
  });
});

describe("PythSource.resolveFeeds", () => {
  it("resolves both legs of a pair from a single request", async () => {
    const { fetchImpl, queries } = makeHermes();
    const source = new PythSource({ fetchImpl });

    const feeds = await source.resolveFeeds(["Equity.US.AAPL/USD", "Crypto.AAPLX/USD"]);

    expect(feeds.size).toBe(2);
    expect(feeds.get("Crypto.AAPLX/USD")?.id).toBe("ax");
    // Searching "AAPL" already returns AAPLX, so asking for it again is waste.
    expect(queries).toEqual(["AAPL"]);
  });

  it("issues one request per pair, not per symbol", async () => {
    const { fetchImpl, queries } = makeHermes();
    await new PythSource({ fetchImpl }).resolveFeeds([
      "Equity.US.AAPL/USD",
      "Crypto.AAPLX/USD",
      "Equity.US.NVDA/USD",
      "Crypto.NVDAX/USD",
    ]);
    expect(queries.sort()).toEqual(["AAPL", "NVDA"]);
  });

  it("falls back to a narrow query when the broad one does not cover it", async () => {
    // A token ticker that is not an extension of the equity ticker, so the
    // broad "AAPL" search cannot return it.
    const catalog = [
      { id: "0xaa", symbol: "Equity.US.AAPL/USD" },
      { id: "0xpx", symbol: "Crypto.APPLEX/USD" },
    ];
    const { fetchImpl, queries } = makeHermes(catalog);
    const feeds = await new PythSource({ fetchImpl }).resolveFeeds([
      "Equity.US.AAPL/USD",
      "Crypto.APPLEX/USD",
    ]);
    expect(feeds.size).toBe(2);
    expect(queries.sort()).toEqual(["AAPL", "APPLEX"]);
  });

  it("serves repeat calls from cache without touching the network", async () => {
    const { fetchImpl, queries } = makeHermes();
    const source = new PythSource({ fetchImpl });
    await source.resolveFeeds(["Equity.US.AAPL/USD"]);
    await source.resolveFeeds(["Equity.US.AAPL/USD"]);
    expect(queries).toHaveLength(1);
  });

  it("does not re-ask about a symbol that has no feed", async () => {
    const { fetchImpl, queries } = makeHermes();
    const source = new PythSource({ fetchImpl });

    const first = await source.resolveFeeds(["Crypto.TSLAX/USD"]);
    expect(first.size).toBe(0);
    const before = queries.length;

    await source.resolveFeeds(["Crypto.TSLAX/USD"]);
    // Without a negative cache the board would re-ask on every refresh forever.
    expect(queries.length).toBe(before);
  });

  it("retries a missing symbol once the negative cache expires", async () => {
    const { fetchImpl, queries } = makeHermes();
    const source = new PythSource({ fetchImpl, negativeTtlMs: 0 });
    await source.resolveFeeds(["Crypto.TSLAX/USD"]);
    const before = queries.length;
    await source.resolveFeeds(["Crypto.TSLAX/USD"]);
    expect(queries.length).toBeGreaterThan(before);
  });

  it("still requires an exact symbol match", async () => {
    const catalog = [{ id: "0x01", symbol: "Equity.US.AAPLW/USD" }];
    const { fetchImpl } = makeHermes(catalog);
    const feeds = await new PythSource({ fetchImpl }).resolveFeeds(["Equity.US.AAPL/USD"]);
    expect(feeds.size).toBe(0);
  });
});
