import { NextResponse } from "next/server";
import { jupiterTrigger, triggerError } from "@/lib/trigger";

export const dynamic = "force-dynamic";
// Jupiter's execute waits for the order to land; give it room on Vercel.
export const maxDuration = 45;

/** Relays a wallet-signed order (or cancel) transaction to Jupiter to land. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON" }, { status: 400 });
  }
  const { signedTransaction, requestId } = body as { signedTransaction?: unknown; requestId?: unknown };
  if (typeof signedTransaction !== "string" || signedTransaction.length > 4000 || typeof requestId !== "string") {
    return NextResponse.json({ error: "signedTransaction and requestId are required" }, { status: 400 });
  }

  const { status, body: out, timedOut } = await jupiterTrigger("/execute", {
    method: "POST",
    body: { signedTransaction, requestId },
    timeoutMs: 30_000,
  });
  if (timedOut) {
    // Not a failure: the signed order may still land. Placing it again could
    // create a duplicate, so the client must say "check before retrying".
    return NextResponse.json({ status: "Unconfirmed" }, { status: 202 });
  }
  if (status !== 200) {
    return NextResponse.json({ error: triggerError(out, `Execute failed (${status})`) }, { status });
  }
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
