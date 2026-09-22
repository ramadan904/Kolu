import { NextResponse } from "next/server";
import { rpcHost, rpcUpstreams } from "@/lib/rpc-upstreams";

export const dynamic = "force-dynamic";

/**
 * Same-origin Solana JSON-RPC relay.
 *
 * The public mainnet endpoint answers 403 "Access forbidden" to any request a
 * browser makes, whatever the page's origin, while serving the identical call
 * from a server. Without this relay a connected wallet could neither read its
 * balances nor send a swap — the trade flow would fail at the last step.
 *
 * It is deliberately not an open proxy: only the methods the wallet flow uses
 * are forwarded, bodies are size-capped, and batches are bounded. Set
 * SOLANA_RPC_URL (server-side, so a keyed endpoint never reaches the browser)
 * to route through a dedicated provider; NEXT_PUBLIC_SOLANA_RPC still lets the
 * browser skip the relay entirely. Whatever is configured, the relay keeps a
 * second keyless endpoint behind it and moves on when one throttles or fails:
 * a rate limit mid-demo should cost a few hundred milliseconds, not the read.
 */



const ALLOWED = new Set([
  // balances
  "getTokenAccountsByOwner",
  "getBalance",
  "getAccountInfo",
  "getMultipleAccounts",
  // sending and confirming a swap
  "getLatestBlockhash",
  "isBlockhashValid",
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",
  "simulateTransaction",
  "sendTransaction",
  "getSignatureStatuses",
  "getTransaction",
  // recent activity
  "getSignaturesForAddress",
  "getFeeForMessage",
  "getHealth",
  "getGenesisHash",
  "getVersion",
]);

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 8;
const RETRY_DELAYS_MS = [400, 1_000];

interface RpcCall {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function rpcError(id: unknown, code: number, message: string, status = 400) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return rpcError(null, -32600, "Request too large", 413);

  let body: RpcCall | RpcCall[];
  try {
    body = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return rpcError(null, -32600, "Invalid batch size");
  }
  for (const call of calls) {
    if (typeof call?.method !== "string" || !ALLOWED.has(call.method)) {
      return rpcError(call?.id, -32601, `Method not available through this relay: ${String(call?.method)}`, 403);
    }
  }

  // Rate-limit bursts clear within a second, so each endpoint is given a
  // couple of patient retries before the next one is tried. Re-sending an
  // already-signed transaction is safe: it carries the same signature, and the
  // cluster treats the duplicate as the same transaction.
  const endpoints = rpcUpstreams();
  let lastStatus = 502;
  let lastBody = '{"error":"Solana RPC unreachable"}';

  for (const endpoint of endpoints) {
    for (let attempt = 0; ; attempt += 1) {
      let upstream: Response;
      try {
        upstream = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw,
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        lastStatus = 502;
        lastBody = '{"error":"Solana RPC unreachable"}';
        break; // this endpoint is down: try the next one
      }

      if (upstream.status === 429 && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }

      const text = await upstream.text();
      if (upstream.status === 429 || upstream.status >= 500 || upstream.status === 403) {
        lastStatus = upstream.status;
        lastBody = text;
        break; // throttled or refusing: fall to the next endpoint
      }

      return new NextResponse(text, {
        status: upstream.status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          // Which endpoint answered, for diagnosing a slow or throttled demo.
          "x-kolu-rpc": rpcHost(endpoint),
        },
      });
    }
  }

  return new NextResponse(lastBody, {
    status: lastStatus,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-kolu-rpc": "exhausted" },
  });
}
