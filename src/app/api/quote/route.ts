import { NextResponse } from "next/server";
import { JupiterSource, toBaseUnits } from "@/lib/data/jupiter";
import { executionReady, loadMints } from "@/lib/mints";
import { findEntry } from "@/lib/universe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Why a measured quote is unavailable, so the UI can say something specific. */
export type QuoteUnavailable =
  | "unknown_ticker"
  | "mints_not_configured"
  | "quote_failed";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase() ?? "";
  const notional = Number(url.searchParams.get("notional") ?? "10000");

  const entry = findEntry(ticker);
  if (!entry) {
    return NextResponse.json(
      { available: false, reason: "unknown_ticker" satisfies QuoteUnavailable },
      { status: 404 },
    );
  }

  const mints = await loadMints();
  if (!executionReady(mints, entry.ticker)) {
    return NextResponse.json({
      available: false,
      reason: "mints_not_configured" satisfies QuoteUnavailable,
      detail:
        "No verified mint for this pair. Copy config/mints.example.json to config/mints.json and fill it in.",
    });
  }

  try {
    const quote = await new JupiterSource({ endpoint: process.env.JUPITER_ENDPOINT }).getQuote({
      inputMint: mints.quote!.mint,
      outputMint: mints.tokens[entry.ticker].mint,
      amount: toBaseUnits(notional, mints.quote!.decimals),
    });

    return NextResponse.json(
      {
        available: true,
        priceImpactBps: quote.priceImpactBps,
        route: quote.route,
        // BigInt is not JSON-serialisable; amounts go out as strings.
        inAmount: quote.inAmount.toString(),
        outAmount: quote.outAmount.toString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({
      available: false,
      reason: "quote_failed" satisfies QuoteUnavailable,
      detail: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
