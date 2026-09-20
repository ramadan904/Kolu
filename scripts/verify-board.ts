/**
 * Builds the real board against live sources and prints it.
 *
 *   npm run verify-board
 *
 * The board is the product. Unit tests cover its arithmetic and route
 * verification covers the trade path, but neither answers the only question
 * that matters here: does a real person loading this page see real numbers.
 */

import { appendFile } from "node:fs/promises";
import { buildBoard } from "../src/lib/board";
import { fmtBps, fmtPct, fmtUsd } from "../src/lib/format";

async function main() {
  const board = await buildBoard({ tier: "all" });

  const lines: string[] = [];
  const say = (line: string) => {
    console.log(line);
    lines.push(line);
  };

  say(`**Source:** ${board.source}${board.fellBack ? " (fell back)" : ""}`);
  say(`**Market:** ${board.session.phase} · ${board.session.etTime} ET`);
  if (board.fallbackReason) say(`**Reason:** ${board.fallbackReason}`);
  say("");
  say("| Pair | Token | Real share | Basis | Signal |");
  say("| --- | --- | --- | --- | --- |");

  for (const r of board.readings) {
    say(
      `| ${r.tokenTicker} | ${r.token ? fmtUsd(r.token.price) : "—"} | ${
        r.equity ? fmtUsd(r.equity.price) : "—"
      } | ${r.basisBps === null ? "—" : `${fmtPct(r.basisBps)} (${fmtBps(r.basisBps, 0)})`} | ${r.signal} |`,
    );
  }

  const live = board.readings.filter((r) => r.basisBps !== null).length;
  say("");
  say(`${live}/${board.readings.length} pairs priced.`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, `## Live board\n\n${lines.join("\n")}\n`);

  // A board serving demo data in CI means the live path is broken, and the
  // whole point of this check is to find that out before a visitor does.
  if (board.source === "fixture") {
    console.error("\nBoard fell back to demo data — the live source is not working.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("verify-board failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
