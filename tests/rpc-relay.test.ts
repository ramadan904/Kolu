import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rpc/route";

const call = (method: string) =>
  new Request("http://localhost/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  });

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("the wallet RPC relay", () => {
  it("moves to the next endpoint when the first keeps throttling", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(new URL(url).host);
        return seen.length <= 3
          ? new Response('{"error":"slow down"}', { status: 429 })
          : jsonOk({ jsonrpc: "2.0", id: 1, result: { value: 7 } });
      }),
    );
    const res = await POST(call("getBalance"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { value: 7 } });
    // Three patient attempts at the first endpoint, then the second answers.
    expect(seen.slice(0, 3).every((h) => h === seen[0])).toBe(true);
    expect(seen[3]).not.toBe(seen[0]);
    expect(res.headers.get("x-kolu-rpc")).toBe(seen[3]);
  }, 20_000);

  it("moves on when an endpoint is unreachable", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(new URL(url).host);
        if (seen.length === 1) throw new Error("ECONNREFUSED");
        return jsonOk({ jsonrpc: "2.0", id: 1, result: "ok" });
      }),
    );
    const res = await POST(call("getBalance"));
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
  });

  it("reports exhaustion rather than inventing a result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"nope"}', { status: 503 })));
    const res = await POST(call("getBalance"));
    expect(res.status).toBe(503);
    expect(res.headers.get("x-kolu-rpc")).toBe("exhausted");
  });

  it("still refuses a method outside the allowlist, before any upstream call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(call("getProgramAccounts"));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
