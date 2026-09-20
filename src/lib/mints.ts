/**
 * Token addresses, loaded from `config/mints.json` rather than compiled in.
 *
 * A wrong mint does not throw — it routes an order into a different asset that
 * happens to share a ticker. This repo therefore ships no addresses at all, only
 * an example file and a loader. Until you fill it in with mints you have checked
 * yourself, the execution path stays disabled and the UI says why.
 *
 * See `config/mints.example.json`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface MintConfig {
  mint: string;
  decimals: number;
}

export interface MintRegistry {
  /** The stablecoin quote leg, e.g. USDC. */
  quote: MintConfig | null;
  /** Keyed by underlying ticker, e.g. `AAPL` for the AAPLX token. */
  tokens: Record<string, MintConfig>;
}

const EMPTY: MintRegistry = { quote: null, tokens: {} };

/** Base58, 32–44 chars. Rejects hex, 0x-prefixed and obviously truncated input. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

let cache: MintRegistry | null = null;

function parseMint(value: unknown, context: string): MintConfig | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  const mint = rec.mint;
  const decimals = rec.decimals;

  if (typeof mint !== "string" || !BASE58_ADDRESS.test(mint)) {
    console.warn(`[mints] ${context}: "${String(mint)}" is not a base58 address — skipped.`);
    return null;
  }
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    console.warn(`[mints] ${context}: decimals must be an integer 0–18 — skipped.`);
    return null;
  }
  return { mint, decimals };
}

export async function loadMints(force = false): Promise<MintRegistry> {
  if (cache && !force) return cache;

  try {
    const raw = await readFile(path.join(process.cwd(), "config", "mints.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return (cache = EMPTY);

    const rec = parsed as Record<string, unknown>;
    const tokens: Record<string, MintConfig> = {};
    const rawTokens = (rec.tokens ?? {}) as Record<string, unknown>;

    for (const [ticker, value] of Object.entries(rawTokens)) {
      const entry = parseMint(value, `tokens.${ticker}`);
      if (entry) tokens[ticker.toUpperCase()] = entry;
    }

    cache = { quote: parseMint(rec.quote, "quote"), tokens };
    return cache;
  } catch (err) {
    // Absent config is the normal state, not an error.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn("[mints] config/mints.json could not be read:", err);
    }
    return (cache = EMPTY);
  }
}

export function resetMintCache(): void {
  cache = null;
}

export function executionReady(registry: MintRegistry, ticker: string): boolean {
  return registry.quote !== null && ticker.toUpperCase() in registry.tokens;
}
