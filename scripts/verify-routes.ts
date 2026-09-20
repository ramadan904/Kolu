/**
 * Exercises the live trade path against real Jupiter, with the real mints.
 *
 *   npm run verify-routes
 *
 * The swap path is the one part of Kolu that has never run: this container
 * cannot reach Jupiter, and the only other test is a user's own money. This
 * script closes as much of that gap as can be closed without signing.
 *
 * For each core ticker it:
 *   1. Fetches a genuine quote in the direction the basis implies.
 *   2. Parses it with the production adapter — so a response-shape change
 *      fails here rather than in front of someone mid-trade.
 *   3. Sanity-checks the numbers: positive amounts, a plausible price impact,
 *      and an output whose implied price is near the quoted token price.
 *   4. Builds the actual swap transaction for a throwaway public key and
 *      deserializes it as a VersionedTransaction.
 *
 * Step 4 is the important one. It proves every stage up to the wallet prompt:
 * route, transaction assembly, encoding and deserialization. What remains
 * untested is only the signature itself, which by design nothing but the
 * user's wallet can produce.
 *
 * No key is used for anything. The keypair is generated in memory purely to
 * supply a syntactically valid address, holds nothing, and is discarded.
 */

import { appendFile } from "node:fs/promises";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { JupiterSource, toBaseUnits } from "../src/lib/data/jupiter";
import { loadMints } from "../src/lib/mints";
import { CORE_UNIVERSE } from "../src/lib/universe";

interface Row {
  ticker: string;
  side: "buy" | "sell";
  ok: boolean;
  impactBps?: number;
  route?: string;
  impliedPrice?: number;
  txBytes?: number;
  problem?: string;
}

/** Rough reference prices, only to size a sell leg and sanity-check output. */
const REFERENCE: Record<string, number> = {
  TSLA: 412, NVDA: 183, SPY: 665, AAPL: 238, QQQ: 592,
};

function fmt(n: number, dp = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

async function check(
  jupiter: JupiterSource,
  ticker: string,
  tokenMint: { mint: string; decimals: number },
  quoteMint: { mint: string; decimals: number },
  side: "buy" | "sell",
  notionalUsd: number,
  payer: string,
): Promise<Row> {
  const price = REFERENCE[ticker] ?? 100;
  const row: Row = { ticker, side, ok: false };

  try {
    const request =
      side === "buy"
        ? {
            inputMint: quoteMint.mint,
            outputMint: tokenMint.mint,
            amount: toBaseUnits(notionalUsd, quoteMint.decimals),
          }
        : {
            inputMint: tokenMint.mint,
            outputMint: quoteMint.mint,
            amount: toBaseUnits(notionalUsd / price, tokenMint.decimals),
          };

    const quote = await jupiter.getQuote(request);

    if (quote.outAmount <= 0n) {
      row.problem = "quote returned a zero output";
      return row;
    }

    // Implied price from the fill, to catch a decimals or direction mistake —
    // both of which produce a number wrong by orders of magnitude.
    const inUnits =
      Number(quote.inAmount) / 10 ** (side === "buy" ? quoteMint.decimals : tokenMint.decimals);
    const outUnits =
      Number(quote.outAmount) / 10 ** (side === "buy" ? tokenMint.decimals : quoteMint.decimals);
    const implied = side === "buy" ? inUnits / outUnits : outUnits / inUnits;

    row.impactBps = quote.priceImpactBps;
    row.route = quote.route.join(" → ") || "(unnamed)";
    row.impliedPrice = implied;

    if (!Number.isFinite(implied) || implied <= 0) {
      row.problem = "implied price was not a positive number";
      return row;
    }
    // An order-of-magnitude miss means a decimals bug, not a market move.
    if (implied < price / 10 || implied > price * 10) {
      row.problem = `implied price ${fmt(implied)} is nowhere near the ~${price} reference — check decimals`;
      return row;
    }
    if (quote.priceImpactBps > 5_000) {
      row.problem = `price impact ${fmt(quote.priceImpactBps, 0)}bps — effectively no liquidity at this size`;
      return row;
    }

    // The real prize: build the transaction the wallet would be asked to sign.
    const base64 = await jupiter.buildSwap(quote.raw, payer);
    const raw = Buffer.from(base64, "base64");
    const tx = VersionedTransaction.deserialize(raw);
    row.txBytes = raw.length;

    if (tx.message.compiledInstructions.length === 0) {
      row.problem = "transaction deserialized but contains no instructions";
      return row;
    }

    row.ok = true;
    return row;
  } catch (err) {
    row.problem = err instanceof Error ? err.message : String(err);
    return row;
  }
}

async function main() {
  const mints = await loadMints(true);
  if (!mints.quote) {
    console.error("config/mints.json has no quote leg. Run `npm run discover-mints` first.");
    process.exitCode = 1;
    return;
  }

  // Ephemeral, holds nothing, never signs — only a valid address for Jupiter.
  const payer = Keypair.generate().publicKey.toBase58();
  const jupiter = new JupiterSource({ endpoint: process.env.JUPITER_ENDPOINT, timeoutMs: 20_000 });

  const lines: string[] = [];
  const say = (line: string) => {
    console.log(line);
    lines.push(line);
  };

  say(`Endpoint: ${process.env.JUPITER_ENDPOINT ?? "https://lite-api.jup.ag"}`);
  say(`Probe address: ${payer} (generated, empty, never signs)`);
  say("");
  say("| Pair | Side | Impact | Implied px | Tx | Result |");
  say("| --- | --- | --- | --- | --- | --- |");

  const rows: Row[] = [];
  for (const entry of CORE_UNIVERSE) {
    const token = mints.tokens[entry.ticker];
    if (!token) {
      rows.push({ ticker: entry.ticker, side: "buy", ok: false, problem: "no mint configured" });
      continue;
    }
    for (const side of ["buy", "sell"] as const) {
      const row = await check(jupiter, entry.ticker, token, mints.quote, side, 250, payer);
      rows.push(row);
      say(
        `| ${entry.tokenTicker} | ${side} | ${row.impactBps !== undefined ? `${fmt(row.impactBps, 1)}bps` : "—"} | ${row.impliedPrice !== undefined ? `$${fmt(row.impliedPrice)}` : "—"} | ${row.txBytes ? `${row.txBytes}B` : "—"} | ${row.ok ? "ok" : `**${row.problem}**`} |`,
      );
    }
  }

  const ok = rows.filter((r) => r.ok).length;
  say("");
  say(`${ok}/${rows.length} legs quoted, built and deserialized.`);
  say("");
  say(
    ok === rows.length
      ? "Every stage up to the wallet prompt works against live Jupiter. Only the signature is untested, and only a user's wallet can produce one."
      : "Some legs failed. A failure here is a failure a user would have hit mid-trade.",
  );

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, `## Live route verification\n\n${lines.join("\n")}\n`);

  if (ok === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify-routes failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
