import { NextResponse } from "next/server";
import { loadMints } from "@/lib/mints";

export const dynamic = "force-dynamic";

/**
 * The public mint map, so the client can look up what the wallet holds.
 *
 * Mints are public identifiers — the same ones any explorer shows — so there
 * is nothing here to withhold. The client needs them because a balance is
 * keyed by mint, and telling someone to sell an asset without checking they
 * hold it is how a trade fails at the wallet prompt.
 */
export async function GET() {
  const mints = await loadMints();
  return NextResponse.json(
    { quote: mints.quote, tokens: mints.tokens },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
