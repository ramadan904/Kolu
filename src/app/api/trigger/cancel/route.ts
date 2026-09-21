import { NextResponse } from "next/server";
import { BASE58_ADDRESS, jupiterTrigger, triggerError } from "@/lib/trigger";

export const dynamic = "force-dynamic";

/** Builds an unsigned cancel transaction; only the maker's wallet can sign it. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON" }, { status: 400 });
  }
  const { maker, order } = body as { maker?: unknown; order?: unknown };
  if (typeof maker !== "string" || !BASE58_ADDRESS.test(maker) || typeof order !== "string" || !BASE58_ADDRESS.test(order)) {
    return NextResponse.json({ error: "maker and order must be valid addresses" }, { status: 400 });
  }
  const { status, body: out } = await jupiterTrigger("/cancelOrder", {
    method: "POST",
    body: { maker, order, computeUnitPrice: "auto" },
  });
  if (status !== 200 || typeof out.transaction !== "string") {
    return NextResponse.json(
      { error: triggerError(out, `Cancel could not be built (${status})`) },
      { status: status === 200 ? 502 : status },
    );
  }
  return NextResponse.json(
    { transaction: out.transaction, requestId: out.requestId },
    { headers: { "cache-control": "no-store" } },
  );
}
