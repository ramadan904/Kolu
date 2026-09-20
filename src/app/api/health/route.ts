import { NextResponse } from "next/server";
import { buildBoard } from "@/lib/board";
import { configuredMode, configuredScenario } from "@/lib/data/provider";
import { executionReady, loadMints } from "@/lib/mints";
import {
  CORE_UNIVERSE,
  UNIVERSE,
  DEFAULT_EQUITY_TEMPLATE,
  DEFAULT_TOKEN_TEMPLATE,
} from "@/lib/universe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * One URL that answers the questions QA and a judge actually have:
 * is this live or demo, which symbols is it asking for, how many resolved, and
 * is the execution path configured.
 *
 * Deliberately returns 200 even when degraded, with `status` saying so — a
 * non-200 here would make uptime checks scream about a condition the product
 * handles on purpose.
 */
export async function GET() {
  const startedAt = Date.now();

  let board;
  let error: string | null = null;
  try {
    board = await buildBoard({ tier: "all" });
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  }

  const mints = await loadMints();
  const quotableTickers = UNIVERSE.filter((u) => executionReady(mints, u.ticker)).map(
    (u) => u.ticker,
  );

  const resolved = board
    ? board.readings.filter((r) => r.equity !== null && r.token !== null).length
    : 0;
  const missing = board
    ? board.readings.filter((r) => r.signal === "unavailable").map((r) => r.ticker)
    : [];

  const status = error
    ? "error"
    : board?.fellBack
      ? "demo_fallback"
      : board?.source === "fixture"
        ? "demo_configured"
        : resolved === 0
          ? "no_feeds"
          : missing.length > 0
            ? "degraded"
            : "ok";

  return NextResponse.json(
    {
      status,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      error,
      source: {
        configured: configuredMode(),
        serving: board?.source ?? null,
        fellBack: board?.fellBack ?? null,
        fallbackReason: board?.fallbackReason ?? null,
        scenario: board?.source === "fixture" ? (board.scenario ?? configuredScenario()) : null,
        hermesEndpoint: process.env.PYTH_HERMES_ENDPOINT ?? "https://hermes.pyth.network",
      },
      // The naming that cannot be verified without calling Hermes, echoed back
      // so a mismatch is diagnosable from the deployment itself.
      symbolTemplates: {
        equity: process.env.KOLU_EQUITY_SYMBOL_TEMPLATE ?? DEFAULT_EQUITY_TEMPLATE,
        token: process.env.KOLU_TOKEN_SYMBOL_TEMPLATE ?? DEFAULT_TOKEN_TEMPLATE,
        exampleEquity: UNIVERSE[0]?.equitySymbol ?? null,
        exampleToken: UNIVERSE[0]?.tokenSymbol ?? null,
      },
      universe: {
        total: UNIVERSE.length,
        core: CORE_UNIVERSE.length,
        pairsResolved: resolved,
        pairsMissing: missing,
      },
      market: board
        ? { phase: board.session.phase, etTime: board.session.etTime, etDate: board.session.etDate }
        : null,
      execution: {
        mintsConfigured: mints.quote !== null,
        quotableTickers,
      },
      build: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
        env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
