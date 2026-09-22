import { NextResponse } from "next/server";
import { buildBoard } from "@/lib/board";
import { seriesFor } from "@/lib/history";
import { findEntry } from "@/lib/universe";
import { loadMints } from "@/lib/mints";
import { DEFAULT_WINDOW_MS, MAX_WINDOW_MS, realHistory } from "@/lib/data/market-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker")?.toUpperCase() ?? "";
  const entry = findEntry(ticker);

  if (!entry) {
    return NextResponse.json({ error: `Unknown ticker: ${ticker}` }, { status: 404 });
  }

  // Real history first: the token's own trades against the share's real
  // prints. Skipped for a replay (`modelled=1`), whose gap is modelled too.
  const modelledOnly = new URL(request.url).searchParams.get("modelled") === "1";
  // 48h by default; `days=7` for the week (the only other window offered).
  const windowMs = new URL(request.url).searchParams.get("days") === "7" ? MAX_WINDOW_MS : DEFAULT_WINDOW_MS;
  if (!modelledOnly) {
    try {
      const mint = (await loadMints()).tokens[entry.ticker]?.mint;
      const points = mint ? await realHistory(entry.ticker, mint, windowMs) : null;
      if (points) {
        return NextResponse.json(
          {
            ticker: entry.ticker,
            points,
            synthetic: false,
            observedMinutes: Math.round((points[points.length - 1].t - points[0].t) / 60_000),
            source: "market",
          },
          { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
        );
      }
    } catch {
      /* fall through to the modelled shape */
    }
  }

  try {
    // Rebuilding the board also anchors the series to the price on screen, so
    // the right edge of the chart always matches the row that opened it.
    const board = await buildBoard({ tier: "all" });
    const reading = board.readings.find((r) => r.ticker === entry.ticker);
    // Modelled fallback: real history was unavailable (or a replay asked for
    // the model). The client overlays what it has genuinely observed, and the
    // chart draws the two differently.
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
