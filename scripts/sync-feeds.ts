/**
 * Snapshots Pyth feed ids for the whole universe into `config/feeds.json`.
 *
 * Run this from a machine with network access:  npm run sync-feeds
 *
 * The app does not need the snapshot — it resolves feeds at runtime — but the
 * output answers a question worth knowing before you trade: which tokenized
 * twins actually have an oracle feed, and which do not. Anything reported
 * missing here will show as "No data" on the board, and no amount of UI work
 * changes that.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { PythSource } from "../src/lib/data/pyth";
import { UNIVERSE, symbolsFor } from "../src/lib/universe";

async function main() {
  const endpoint = process.env.PYTH_HERMES_ENDPOINT;
  const source = new PythSource({ endpoint, timeoutMs: 15_000 });
  const symbols = symbolsFor(UNIVERSE);

  console.log(`Resolving ${symbols.length} feeds from ${endpoint ?? "hermes.pyth.network"}…\n`);

  const feeds = await source.resolveFeeds(symbols);
  const found: Record<string, string> = {};
  const missing: string[] = [];

  for (const symbol of symbols) {
    const feed = feeds.get(symbol);
    if (feed) found[symbol] = feed.id;
    else missing.push(symbol);
  }

  for (const entry of UNIVERSE) {
    const equity = feeds.has(entry.equitySymbol) ? "ok" : "MISSING";
    const token = feeds.has(entry.tokenSymbol) ? "ok" : "MISSING";
    const status = equity === "ok" && token === "ok" ? " " : "!";
    console.log(
      `${status} ${entry.ticker.padEnd(6)} equity:${equity.padEnd(8)} token(${entry.tokenTicker}):${token}`,
    );
  }

  await mkdir("config", { recursive: true });
  await writeFile(
    "config/feeds.json",
    `${JSON.stringify({ resolvedAt: new Date().toISOString(), feeds: found }, null, 2)}\n`,
  );

  console.log(`\nWrote config/feeds.json — ${Object.keys(found).length} feeds, ${missing.length} missing.`);
  if (missing.length) {
    console.log("Missing:", missing.join(", "));
    console.log("Pairs missing either leg render as “No data” rather than a guessed price.");
  }
}

main().catch((err) => {
  console.error("\nsync-feeds failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
