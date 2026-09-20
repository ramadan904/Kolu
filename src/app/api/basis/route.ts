import { NextResponse } from "next/server";
import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const tier = new URL(request.url).searchParams.get("tier") === "all" ? "all" : "core";

  try {
    const board = await buildBoard({ tier });
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
