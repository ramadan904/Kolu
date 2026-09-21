import { NextResponse } from "next/server";
import { buildBoard } from "@/lib/board";
import { isScenario } from "@/lib/data/fixtures";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tier = params.get("tier") === "all" ? "all" : "core";
  // Opt-in demo scenario; anything unrecognised is ignored and the board is live.
  const requested = params.get("scenario") ?? undefined;
  const scenario = isScenario(requested) ? requested : undefined;

  try {
    const board = await buildBoard({ tier, scenario });
    return NextResponse.json(board, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Could not build the basis board", detail: message },
      { status: 503 },
    );
  }
}
