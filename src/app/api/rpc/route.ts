import { NextResponse } from "next/server";

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
 * browser skip the relay entirely.
 */

const UPSTREAM = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

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

  // Rate-limit bursts on the upstream clear within a second; absorbing them
  // here keeps a single 429 from surfacing as a failed balance read or swap.
  for (let attempt = 0; ; attempt += 1) {
    let upstream: Response;
    try {
      upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return rpcError(calls[0]?.id, -32603, "Solana RPC unreachable", 502);
    }

    if (upstream.status === 429 && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
