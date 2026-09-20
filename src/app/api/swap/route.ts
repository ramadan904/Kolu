import { NextResponse } from "next/server";
import { JupiterSource } from "@/lib/data/jupiter";

export const dynamic = "force-dynamic";

/** Base58, 32–44 chars — the same shape check the mint registry uses. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Turns a quote into an unsigned transaction.
 *
 * Kolu holds no key material and never signs. This endpoint exists only so the
 * Jupiter call is made server-side; the base64 it returns is useless until the
 * user's own wallet authorises it.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON" }, { status: 400 });
  }

  const { quote, userPublicKey } = (body ?? {}) as {
    quote?: unknown;
    userPublicKey?: unknown;
  };

  if (typeof userPublicKey !== "string" || !BASE58_ADDRESS.test(userPublicKey)) {
    return NextResponse.json({ error: "userPublicKey is not a valid address" }, { status: 400 });
  }
  if (typeof quote !== "object" || quote === null) {
    return NextResponse.json({ error: "quote is required" }, { status: 400 });
  }

  try {
    const swapTransaction = await new JupiterSource({
      endpoint: process.env.JUPITER_ENDPOINT,
      timeoutMs: 15_000,
    }).buildSwap(quote, userPublicKey);

    return NextResponse.json({ swapTransaction }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not build the swap" },
      { status: 502 },
    );
  }
}
