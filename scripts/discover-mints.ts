/**
 * Finds and verifies the SPL mints for the tokenized universe.
 *
 *   npm run discover-mints
 *
 * A wrong mint does not throw — it routes an order into a different asset that
 * happens to share a ticker. So nothing here is accepted on one source's word.
 * Each candidate must clear three gates:
 *
 *   1. A token registry returns it for an EXACT symbol match (case-insensitive).
 *      A substring hit is a candidate, never an identification.
 *   2. The mint account actually exists on chain and is owned by the SPL Token
 *      or Token-2022 program — xStocks are Token-2022, so both are allowed.
 *   3. The decimals the registry claims match the decimals the chain reports.
 *      A mismatch means the registry entry is for a different token, and a
 *      wrong decimals value silently scales every order by a power of ten.
 *
 * Anything that fails a gate is reported and omitted. Ambiguity is printed in
 * full rather than resolved by guessing.
 */

import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { UNIVERSE } from "../src/lib/universe";

const JUPITER = (process.env.JUPITER_ENDPOINT ?? "https://lite-api.jup.ag").replace(/\/$/, "");
const RPC = process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

/** The two programs that can own a legitimate SPL mint. */
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface Candidate {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
}

interface Verified extends Candidate {
  owner: string;
  chainDecimals: number;
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

function readCandidates(body: unknown): Candidate[] {
  // The registry has changed response shape before; accept an array or a
  // wrapper around one rather than breaking on a cosmetic change.
  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { tokens?: unknown[] })?.tokens)
      ? (body as { tokens: unknown[] }).tokens
      : Array.isArray((body as { data?: unknown[] })?.data)
        ? (body as { data: unknown[] }).data
        : [];

  const out: Candidate[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const mint = typeof r.id === "string" ? r.id : typeof r.address === "string" ? r.address : null;
    const symbol = typeof r.symbol === "string" ? r.symbol : null;
    const decimals = typeof r.decimals === "number" ? r.decimals : null;
    if (!mint || !symbol || decimals === null || !BASE58.test(mint)) continue;
    out.push({
      mint,
      symbol,
      decimals,
      name: typeof r.name === "string" ? r.name : symbol,
    });
  }
  return out;
}

async function search(query: string): Promise<Candidate[]> {
  try {
    return readCandidates(
      await getJson(`${JUPITER}/tokens/v2/search?query=${encodeURIComponent(query)}`),
    );
  } catch (err) {
    console.error(`  registry lookup failed for ${query}: ${(err as Error).message}`);
    return [];
  }
}

/** Confirms the mint exists on chain, is a token mint, and agrees on decimals. */
async function verifyOnChain(mint: string): Promise<{ owner: string; decimals: number } | null> {
  try {
    const body = (await getJson(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [mint, { encoding: "jsonParsed" }],
      }),
    })) as {
      result?: {
        value?: {
          owner?: string;
          data?: { parsed?: { type?: string; info?: { decimals?: number } } };
        } | null;
      };
      error?: { message?: string };
    };

    const value = body.result?.value;
    if (!value) return null;

    const owner = value.owner;
    const parsed = value.data?.parsed;
    if (typeof owner !== "string") return null;
    if (owner !== TOKEN_PROGRAM && owner !== TOKEN_2022_PROGRAM) return null;
    if (parsed?.type !== "mint") return null;

    const decimals = parsed.info?.decimals;
    if (typeof decimals !== "number") return null;
    return { owner, decimals };
  } catch (err) {
    console.error(`  chain lookup failed for ${mint}: ${(err as Error).message}`);
    return null;
  }
}

async function resolve(symbol: string): Promise<{ ok: Verified | null; candidates: Candidate[] }> {
  const candidates = await search(symbol);
  const exact = candidates.filter((c) => c.symbol.toUpperCase() === symbol.toUpperCase());
  if (exact.length === 0) return { ok: null, candidates };

  for (const candidate of exact) {
    const chain = await verifyOnChain(candidate.mint);
    if (!chain) continue;
    if (chain.decimals !== candidate.decimals) {
      console.error(
        `  ${symbol}: registry says ${candidate.decimals} decimals, chain says ${chain.decimals} — rejected`,
      );
      continue;
    }
    return {
      ok: { ...candidate, owner: chain.owner, chainDecimals: chain.decimals },
      candidates,
    };
  }
  return { ok: null, candidates: exact };
}

async function main() {
  const lines: string[] = [];
  const say = (line: string) => {
    console.log(line);
    lines.push(line);
  };

  say(`Registry: ${JUPITER}`);
  say(`Chain:    ${RPC}`);
  say("");

  const quote = await resolve("USDC");
  if (!quote.ok) {
    console.error("Could not verify the USDC mint — refusing to write a config without a quote leg.");
    process.exitCode = 1;
    return;
  }

  const tokens: Record<string, { mint: string; decimals: number }> = {};
  const rows: string[] = [];
  const unresolved: { ticker: string; candidates: Candidate[] }[] = [];

  for (const entry of UNIVERSE) {
    const { ok, candidates } = await resolve(entry.tokenTicker);
    if (ok) {
      tokens[entry.ticker] = { mint: ok.mint, decimals: ok.decimals };
      const program = ok.owner === TOKEN_2022_PROGRAM ? "Token-2022" : "SPL Token";
      rows.push(
        `| ${entry.tokenTicker} | \`${ok.mint}\` | ${ok.decimals} | ${program} | verified |`,
      );
    } else {
      unresolved.push({ ticker: entry.tokenTicker, candidates });
      rows.push(`| ${entry.tokenTicker} | — | — | — | **not found** |`);
    }
  }

  say("| Token | Mint | Decimals | Program | Status |");
  say("| --- | --- | --- | --- | --- |");
  for (const row of rows) say(row);
  say("");
  say(`| USDC | \`${quote.ok.mint}\` | ${quote.ok.decimals} | quote leg | verified |`);

  if (unresolved.length > 0) {
    say("");
    say("### Not resolved");
    for (const item of unresolved) {
      say("");
      say(`**${item.ticker}** — registry returned:`);
      if (item.candidates.length === 0) say("- (nothing)");
      else
        for (const c of item.candidates.slice(0, 8))
          say(`- \`${c.symbol}\` · ${c.name} · \`${c.mint}\` · ${c.decimals}dp`);
    }
  }

  await mkdir("config", { recursive: true });
  const config = {
    _generated: new Date().toISOString(),
    _verification: "exact symbol match + on-chain mint account + decimals agreement",
    quote: { mint: quote.ok.mint, decimals: quote.ok.decimals },
    tokens,
  };
  await writeFile("config/mints.json", `${JSON.stringify(config, null, 2)}\n`);

  say("");
  say(
    `Verified ${Object.keys(tokens).length}/${UNIVERSE.length} token mints. Wrote config/mints.json.`,
  );

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, `## Mint discovery\n\n${lines.join("\n")}\n`);

  if (Object.keys(tokens).length === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("discover-mints failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
