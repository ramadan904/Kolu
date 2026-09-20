/**
 * Resolves the universe against a real Hermes endpoint and reports what exists.
 *
 *   npm run sync-feeds
 *
 * This script is the answer to the one thing about this integration that cannot
 * be verified without network access: what the tokenized twins are actually
 * called. It does not merely check the configured naming — when a token symbol
 * fails to resolve it runs a discovery query and prints every symbol Hermes
 * knows for that ticker, so the real convention is read off the output rather
 * than guessed at.
 *
 * Run it in CI (.github/workflows/verify-feeds.yml) and the answer lands in the
 * job summary.
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { PythSource, queryKeyFor } from "../src/lib/data/pyth";
import { UNIVERSE, symbolsFor } from "../src/lib/universe";

interface Discovered {
  ticker: string;
  equityOk: boolean;
  tokenOk: boolean;
  /** Everything Hermes returned for this ticker, when the token leg missed. */
  candidates: string[];
}

async function discoverCandidates(
  endpoint: string,
  ticker: string,
): Promise<string[]> {
  const res = await fetch(
    `${endpoint}/v2/price_feeds?query=${encodeURIComponent(ticker)}`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) return [];
  const body: unknown = await res.json();
  if (!Array.isArray(body)) return [];

  return body
    .map((item) => {
      const attrs = (item as { attributes?: Record<string, unknown> })?.attributes;
      const symbol = attrs?.symbol;
      return typeof symbol === "string" ? symbol : null;
    })
    .filter((s): s is string => s !== null)
    .sort();
}

async function main() {
  const endpoint = (process.env.PYTH_HERMES_ENDPOINT ?? "https://hermes.pyth.network").replace(
    /\/$/,
    "",
  );
  const source = new PythSource({ endpoint, timeoutMs: 20_000 });
  const symbols = symbolsFor(UNIVERSE);

  console.log(`Resolving ${symbols.length} symbols from ${endpoint}\n`);

  const feeds = await source.resolveFeeds(symbols);
  const found: Record<string, string> = {};
  for (const symbol of symbols) {
    const feed = feeds.get(symbol);
    if (feed) found[symbol] = feed.id;
  }

  const rows: Discovered[] = [];
  for (const entry of UNIVERSE) {
    const equityOk = feeds.has(entry.equitySymbol);
    const tokenOk = feeds.has(entry.tokenSymbol);
    const candidates =
      tokenOk || !equityOk ? [] : await discoverCandidates(endpoint, entry.ticker);
    rows.push({ ticker: entry.ticker, equityOk, tokenOk, candidates });
  }

  const lines: string[] = [];
  const say = (line: string) => {
    console.log(line);
    lines.push(line);
  };

  say("| Ticker | Equity feed | Token feed | Configured token symbol |");
  say("| --- | --- | --- | --- |");
  for (const row of rows) {
    const entry = UNIVERSE.find((u) => u.ticker === row.ticker)!;
    say(
      `| ${row.ticker} | ${row.equityOk ? "ok" : "MISSING"} | ${row.tokenOk ? "ok" : "MISSING"} | \`${entry.tokenSymbol}\` |`,
    );
  }

  const brokenTokens = rows.filter((r) => !r.tokenOk);
  if (brokenTokens.length > 0) {
    say("");
    say("### Token symbols that did not resolve");
    say("");
    say(
      "The naming below is what Hermes actually publishes for these tickers. " +
        "Set `KOLU_TOKEN_SYMBOL_TEMPLATE` to match it — no code change is needed.",
    );
    for (const row of brokenTokens) {
      say("");
      say(`**${row.ticker}** — Hermes knows:`);
      if (row.candidates.length === 0) {
        say("- (nothing returned for this ticker)");
      } else {
        for (const candidate of row.candidates.slice(0, 12)) say(`- \`${candidate}\``);
      }
    }
  } else {
    say("");
    say("All configured token symbols resolved. No template change needed.");
  }

  await mkdir("config", { recursive: true });
  await writeFile(
    "config/feeds.json",
    `${JSON.stringify(
      {
        resolvedAt: new Date().toISOString(),
        endpoint,
        queryKeys: [...new Set(symbols.map(queryKeyFor))],
        feeds: found,
      },
      null,
      2,
    )}\n`,
  );

  say("");
  say(
    `Resolved ${Object.keys(found).length}/${symbols.length} symbols. Wrote config/feeds.json.`,
  );

  // GitHub Actions: put the table straight into the job summary.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await appendFile(summaryPath, `## Pyth feed resolution\n\n${lines.join("\n")}\n`);
  }

  // A missing equity feed means the endpoint or the universe is wrong, which is
  // worth failing CI over. A missing token feed is the naming question this
  // script exists to answer, so it reports rather than fails.
  if (rows.some((r) => !r.equityOk)) {
    console.error("\nSome EQUITY feeds are missing — check the endpoint and universe.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\nsync-feeds failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
