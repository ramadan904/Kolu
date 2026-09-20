import { describe, expect, it } from "vitest";
import { fetchJsonWithRetry, isRetryableStatus, shortenUrl } from "@/lib/data/http";

const noSleep = async () => {};

function responder(statuses: number[], body: unknown = { ok: true }) {
  let calls = 0;
  const fetchImpl = (async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls += 1;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

describe("isRetryableStatus", () => {
  it("retries rate limits, timeouts and server errors only", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe("fetchJsonWithRetry", () => {
  it("returns the body on the first success", async () => {
    const { fetchImpl, calls } = responder([200], { hello: "world" });
    const body = await fetchJsonWithRetry("https://x/y", "ctx", { fetchImpl, sleep: noSleep });
    expect(body).toEqual({ hello: "world" });
    expect(calls()).toBe(1);
  });

  it("recovers from a rate limit", async () => {
    // A single 429 should not collapse the board to demo data.
    const { fetchImpl, calls } = responder([429, 200], { recovered: true });
    const body = await fetchJsonWithRetry("https://x/y", "ctx", { fetchImpl, sleep: noSleep });
    expect(body).toEqual({ recovered: true });
    expect(calls()).toBe(2);
  });

  it("gives up after the configured attempts", async () => {
    const { fetchImpl, calls } = responder([503]);
    await expect(
      fetchJsonWithRetry("https://x/y", "ctx", { fetchImpl, sleep: noSleep, attempts: 3 }),
    ).rejects.toThrow(/503/);
    expect(calls()).toBe(3);
  });

  it("does not retry a permanent failure", async () => {
    // Retrying a 404 only makes the user wait longer for the same answer.
    const { fetchImpl, calls } = responder([404]);
    await expect(
      fetchJsonWithRetry("https://x/y", "ctx", { fetchImpl, sleep: noSleep }),
    ).rejects.toThrow(/404/);
    expect(calls()).toBe(1);
  });

  it("retries a network-level failure", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("network down");
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      fetchJsonWithRetry("https://x/y", "ctx", { fetchImpl, sleep: noSleep }),
    ).resolves.toEqual({ ok: 1 });
    expect(calls).toBe(2);
  });

  it("backs off exponentially between attempts", async () => {
    const delays: number[] = [];
    const { fetchImpl } = responder([429, 429, 200]);
    await fetchJsonWithRetry("https://x/y", "ctx", {
      fetchImpl,
      baseDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toEqual([100, 200]);
  });

  it("surfaces a timeout as an error rather than hanging", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    await expect(
      fetchJsonWithRetry("https://x/y", "ctx", {
        fetchImpl,
        timeoutMs: 10,
        attempts: 1,
        sleep: noSleep,
      }),
    ).rejects.toThrow();
  });
});

describe("error messages", () => {
  it("explains a 401 instead of printing a bare number", async () => {
    // Hermes began requiring an API key in August 2026. A deployment that hits
    // this needs the remedy, not the status code.
    const { fetchImpl } = responder([401]);
    await expect(
      fetchJsonWithRetry("https://x/y", "Hermes", { fetchImpl, sleep: noSleep }),
    ).rejects.toThrow(/PYTH_API_KEY/);
  });

  it("does not retry an auth failure", async () => {
    const { fetchImpl, calls } = responder([401]);
    await expect(
      fetchJsonWithRetry("https://x/y", "ctx", { fetchImpl, sleep: noSleep }),
    ).rejects.toThrow();
    expect(calls()).toBe(1);
  });

  it("sends an Authorization header when given one", async () => {
    let seen: HeadersInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen = init?.headers;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await fetchJsonWithRetry("https://x/y", "ctx", {
      fetchImpl,
      headers: { authorization: "Bearer secret" },
    });
    expect((seen as Record<string, string>).authorization).toBe("Bearer secret");
  });
});

describe("shortenUrl", () => {
  it("collapses a wall of feed ids into a count", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `ids[]=${String(i).repeat(64)}`).join("&");
    const short = shortenUrl(`https://hermes.test/v2/updates/price/latest?${ids}`);
    expect(short).toContain("24 feeds");
    expect(short.length).toBeLessThan(80);
  });

  it("leaves a short url alone", () => {
    expect(shortenUrl("https://hermes.test/v2/price_feeds?query=AAPL")).toBe(
      "https://hermes.test/v2/price_feeds?query=AAPL",
    );
  });
});
