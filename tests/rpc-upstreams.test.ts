import { describe, expect, it } from "vitest";
import { PUBLIC_FALLBACKS, rpcHost, rpcUpstreams } from "@/lib/rpc-upstreams";

describe("rpcUpstreams", () => {
  it("puts a configured provider first, with the keyless ones behind it", () => {
    const list = rpcUpstreams("https://mainnet.helius-rpc.com/?api-key=abc");
    expect(list[0]).toBe("https://mainnet.helius-rpc.com/?api-key=abc");
    expect(list.slice(1)).toEqual([...PUBLIC_FALLBACKS]);
  });

  it("falls back to the keyless endpoints when nothing is configured", () => {
    expect(rpcUpstreams(undefined)).toEqual([...PUBLIC_FALLBACKS]);
    expect(rpcUpstreams("   ")).toEqual([...PUBLIC_FALLBACKS]);
  });

  it("never tries the same endpoint twice", () => {
    const list = rpcUpstreams("https://api.mainnet-beta.solana.com/");
    expect(list).toEqual(["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"]);
    expect(new Set(list).size).toBe(list.length);
  });

  it("names hosts for diagnostics without leaking a key", () => {
    expect(rpcHost("https://mainnet.helius-rpc.com/?api-key=secret")).toBe("mainnet.helius-rpc.com");
    expect(rpcHost("not a url")).toBe("invalid-url");
  });
});

describe("a mis-pasted SOLANA_RPC_URL", () => {
  it("is skipped, so the relay never wastes an attempt on it", () => {
    for (const bad of ["my-api-key-1234", '"https://x.example"', "wss://mainnet.example/ws", "dashboard.helius.dev", ""]) {
      expect(rpcUpstreams(bad)).toEqual([...PUBLIC_FALLBACKS]);
    }
  });

  it("still leads with a valid endpoint", () => {
    expect(rpcUpstreams("https://mainnet.helius-rpc.com/?api-key=abc")[0]).toBe("https://mainnet.helius-rpc.com/?api-key=abc");
  });
});
