import { NextResponse } from "next/server";
import { executionReady, loadMints } from "@/lib/mints";
import { BASE58_ADDRESS, BASE_UNITS, jupiterTrigger, triggerError } from "@/lib/trigger";
import { findEntry } from "@/lib/universe";

export const dynamic = "force-dynamic";

/**
 * Builds an unsigned limit order between USDC and a tracked xStock. The body
 * names a ticker and a side; the mints come from Kolu's registry.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON" }, { status: 400 });
  }

  const entry = typeof body.ticker === "string" ? findEntry(body.ticker) : undefined;
  const side = body.side === "sell" ? "sell" : body.side === "buy" ? "buy" : null;
  const { maker, makingAmount, takingAmount, expiredAt } = body as {
    maker?: unknown;
    makingAmount?: unknown;
    takingAmount?: unknown;
    expiredAt?: unknown;
  };

  if (!entry || !side) return NextResponse.json({ error: "Unknown ticker or side" }, { status: 400 });
  if (typeof maker !== "string" || !BASE58_ADDRESS.test(maker)) {
    return NextResponse.json({ error: "maker is not a valid address" }, { status: 400 });
  }
  if (
    typeof makingAmount !== "string" || !BASE_UNITS.test(makingAmount) ||
    typeof takingAmount !== "string" || !BASE_UNITS.test(takingAmount) ||
    makingAmount === "0" || takingAmount === "0"
  ) {
    return NextResponse.json({ error: "Amounts must be positive integers in base units" }, { status: 400 });
  }
  const expiry =
    typeof expiredAt === "number" && Number.isInteger(expiredAt) && expiredAt > Date.now() / 1000
      ? String(expiredAt)
      : undefined;

  const mints = await loadMints();
  if (!executionReady(mints, entry.ticker)) {
    return NextResponse.json({ error: "No verified mint for this pair" }, { status: 400 });
  }
  const usdc = mints.quote!.mint;
  const token = mints.tokens[entry.ticker].mint;

  const { status, body: out } = await jupiterTrigger("/createOrder", {
    method: "POST",
    body: {
      inputMint: side === "buy" ? usdc : token,
      outputMint: side === "buy" ? token : usdc,
      maker,
      payer: maker,
      params: { makingAmount, takingAmount, ...(expiry ? { expiredAt: expiry } : {}) },
      computeUnitPrice: "auto",
    },
  });

  if (status !== 200 || typeof out.transaction !== "string") {
    return NextResponse.json(
      { error: triggerError(out, `Order could not be built (${status})`) },
      { status: status === 200 ? 502 : status },
    );
  }
  return NextResponse.json(
    { transaction: out.transaction, requestId: out.requestId, order: out.order },
    { headers: { "cache-control": "no-store" } },
  );
}
