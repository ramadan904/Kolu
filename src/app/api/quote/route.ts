import { NextResponse } from "next/server";
import { JupiterSource, toBaseUnits } from "@/lib/data/jupiter";
import { executionReady, loadMints } from "@/lib/mints";
import { findEntry } from "@/lib/universe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Why a measured quote is unavailable, so the UI can say something specific. */
export type QuoteUnavailable =
  | "unknown_ticker"
  | "bad_request"
  | "mints_not_configured"
  | "quote_failed";

function fail(reason: QuoteUnavailable, detail?: string, status = 200) {
  return NextResponse.json({ available: false, reason, detail }, { status });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = params.get("ticker")?.toUpperCase() ?? "";
  const notional = Number(params.get("notional") ?? "10000");
  const tokenPrice = Number(params.get("price") ?? "0");
  // A premium means the token is rich, so the trade is a sell, not a buy.
  // Impact is not symmetric — the thin side of the book is the one that costs
  // you — so quoting the wrong direction measures a trade nobody would make.
  const side = params.get("side") === "sell" ? "sell" : "buy";
  // Clamped rather than trusted: a quote requested with absurd tolerance is a
  // quote that can fill anywhere.
  const slippageRaw = Number(params.get("slippageBps") ?? "30");
  const slippageBps = Number.isFinite(slippageRaw)
    ? Math.min(500, Math.max(1, Math.round(slippageRaw)))
    : 30;

  const entry = findEntry(ticker);
  if (!entry) return fail("unknown_ticker", `Unknown ticker: ${ticker}`, 404);

  if (!Number.isFinite(notional) || notional <= 0) {
    return fail("bad_request", "Notional must be a positive number.", 400);
  }
  if (side === "sell" && (!Number.isFinite(tokenPrice) || tokenPrice <= 0)) {
    return fail("bad_request", "A sell quote needs the token price to size it.", 400);
  }

  const mints = await loadMints();
  if (!executionReady(mints, entry.ticker)) {
    return fail(
      "mints_not_configured",
      "No verified mint for this pair. Copy config/mints.example.json to config/mints.json and fill it in.",
    );
  }

  const quoteMint = mints.quote!;
  const tokenMint = mints.tokens[entry.ticker];

  try {
    const request =
      side === "buy"
        ? {
            inputMint: quoteMint.mint,
            outputMint: tokenMint.mint,
            amount: toBaseUnits(notional, quoteMint.decimals),
            slippageBps,
          }
        : {
            inputMint: tokenMint.mint,
            outputMint: quoteMint.mint,
            // Same USD notional, expressed in tokens.
            amount: toBaseUnits(notional / tokenPrice, tokenMint.decimals),
            slippageBps,
          };

    const quote = await new JupiterSource({ endpoint: process.env.JUPITER_ENDPOINT }).getQuote(
      request,
    );

    return NextResponse.json(
      {
        available: true,
        side,
        slippageBps,
        priceImpactBps: quote.priceImpactBps,
        route: quote.route,
        // BigInt is not JSON-serialisable; amounts go out as strings.
        inAmount: quote.inAmount.toString(),
        outAmount: quote.outAmount.toString(),
        inDecimals: side === "buy" ? quoteMint.decimals : tokenMint.decimals,
        outDecimals: side === "buy" ? tokenMint.decimals : quoteMint.decimals,
        // Handed straight back when building the swap, unmodified.
        quote: quote.raw,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return fail("quote_failed", err instanceof Error ? err.message : "Unknown error");
  }
}
