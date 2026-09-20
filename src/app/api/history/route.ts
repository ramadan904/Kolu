import { NextResponse } from "next/server";
import { buildBoard } from "@/lib/board";
import { seriesFor } from "@/lib/history";
import { findEntry } from "@/lib/universe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker")?.toUpperCase() ?? "";
  const entry = findEntry(ticker);

  if (!entry) {
    return NextResponse.json({ error: `Unknown ticker: ${ticker}` }, { status: 404 });
  }

  try {
    // Rebuilding the board also anchors the series to the price on screen, so
    // the right edge of the chart always matches the row that opened it.
    const board = await buildBoard({ tier: "all" });
    const reading = board.readings.find((r) => r.ticker === entry.ticker);
    // Always modelled, whatever the price source. Real history cannot live in
    // a serverless process — each request may land on a fresh instance — so
    // this is context for the shape, and the client supplies what it has
    // genuinely observed. The chart draws the two differently.
    const series = seriesFor(
      entry.ticker,
      reading?.basisBps ?? null,
      new Date(board.generatedAt),
      true,
    );
    return NextResponse.json(series, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Could not build history", detail }, { status: 503 });
  }
}
