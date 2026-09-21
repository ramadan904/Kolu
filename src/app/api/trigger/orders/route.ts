import { NextResponse } from "next/server";
import { BASE58_ADDRESS, jupiterTrigger, triggerError } from "@/lib/trigger";

export const dynamic = "force-dynamic";

/** Active limit orders for an address — public on-chain state, read-only. */
export async function GET(request: Request) {
  const user = new URL(request.url).searchParams.get("user") ?? "";
  if (!BASE58_ADDRESS.test(user)) {
    return NextResponse.json({ error: "user is not a valid address" }, { status: 400 });
  }
  const { status, body } = await jupiterTrigger(
    `/getTriggerOrders?user=${user}&orderStatus=active&page=1`,
  );
  if (status !== 200) {
    return NextResponse.json({ error: triggerError(body, `Could not list orders (${status})`) }, { status });
  }
  return NextResponse.json(
    { orders: Array.isArray(body.orders) ? body.orders : [] },
    { headers: { "cache-control": "no-store" } },
  );
}
