/**
 * Probes free, unauthenticated price sources.
 *
 *   npm run probe-sources
 *
 * The board currently runs on modelled prices because Pyth put live price
 * updates behind a paid plan. That is a real weakness: a page that says none of
 * its numbers are real prices is a page a judge stops trusting, and the honest
 * fix is live data rather than a quieter disclaimer.
 *
 * Two legs are needed. The tokenized leg looks obtainable from Jupiter, which
 * we already call and which needs no key. The equity leg is the hard one.
 * This script finds out what each candidate actually returns, on a machine
 * with network access, so the decision is made on evidence.
 */

import { appendFile } from "node:fs/promises";
import { loadMints } from "../src/lib/mints";

interface Probe {
  name: string;
  url: string;
  note: string;
  extract?: (body: unknown) => string;
}

function truncate(value: unknown, max = 320): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "(empty)";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function run(probe: Probe): Promise<string> {
  try {
    const res = await fetch(probe.url, { headers: { accept: "application/json" } });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep the raw body */
    }
    if (!res.ok) return `HTTP ${res.status} — ${truncate(text, 140)}`;
    const extracted = probe.extract ? probe.extract(parsed) : truncate(parsed);
    return `ok — ${extracted}`;
  } catch (err) {
    return `failed — ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function main() {
  const mints = await loadMints(true);
  const spyx = mints.tokens.SPY?.mint;
  const aaplx = mints.tokens.AAPL?.mint;

  const probes: Probe[] = [
    {
      name: "Jupiter price v3 (token leg)",
      url: `https://lite-api.jup.ag/price/v3?ids=${spyx},${aaplx}`,
      note: "USD price per mint, no auth",
    },
    {
      name: "Jupiter tokens v2 (metadata)",
      url: `https://lite-api.jup.ag/tokens/v2/search?query=SPYX`,
      note: "confirms symbol/decimals",
      extract: (b) =>
        Array.isArray(b) ? `${b.length} results, first: ${truncate(b[0], 160)}` : truncate(b, 160),
    },
    {
      name: "xStocks public API — assets",
      url: "https://api.xstocks.com/v1/assets",
      note: "listed in the hackathon brief as no-auth",
    },
    {
      name: "xStocks public API — alt host",
      url: "https://xstocks.com/api/assets",
      note: "fallback host guess",
    },
    {
      name: "Pyth price_feeds (unauthenticated)",
      url: "https://hermes.pyth.network/v2/price_feeds?query=SPY",
      note: "known to work without a key — metadata only",
      extract: (b) => (Array.isArray(b) ? `${b.length} feeds` : truncate(b, 140)),
    },
    {
      name: "Pyth latest price (unauthenticated)",
      url: "https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
      note: "expected to 401 — this is what forced demo mode",
    },
  ];

  const lines: string[] = [];
  const say = (line: string) => {
    console.log(line);
    lines.push(line);
  };

  say("| Source | Result |");
  say("| --- | --- |");
  for (const probe of probes) {
    const result = await run(probe);
    say(`| **${probe.name}**<br>${probe.note} | ${result.replace(/\|/g, "\\|")} |`);
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, `## Free price source probe\n\n${lines.join("\n")}\n`);
}

main().catch((err) => {
  console.error("probe failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
