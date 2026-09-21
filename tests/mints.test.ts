import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { executionReady, loadMints, resetMintCache } from "@/lib/mints";

const cwd = process.cwd();

afterEach(() => {
  process.chdir(cwd);
  resetMintCache();
});

async function withConfig(contents: string | null) {
  const dir = await mkdtemp(path.join(tmpdir(), "kolu-mints-"));
  if (contents !== null) {
    await mkdir(path.join(dir, "config"), { recursive: true });
    await writeFile(path.join(dir, "config", "mints.json"), contents);
  }
  process.chdir(dir);
  resetMintCache();
  // Leave the directory before removing it: Windows refuses to delete the cwd.
  return async () => {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  };
}

const VALID = "So11111111111111111111111111111111111111112";

describe("loadMints", () => {
  it("treats a missing config as the normal unconfigured state", async () => {
    const cleanup = await withConfig(null);
    const registry = await loadMints(true);
    expect(registry.quote).toBeNull();
    expect(registry.tokens).toEqual({});
    await cleanup();
  });

  it("loads a well-formed config and upper-cases tickers", async () => {
    const cleanup = await withConfig(
      JSON.stringify({
        quote: { mint: VALID, decimals: 6 },
        tokens: { aapl: { mint: VALID, decimals: 8 } },
      }),
    );
    const registry = await loadMints(true);
    expect(registry.quote?.decimals).toBe(6);
    expect(registry.tokens.AAPL?.mint).toBe(VALID);
    expect(executionReady(registry, "aapl")).toBe(true);
    await cleanup();
  });

  it("drops entries that are not base58 addresses", async () => {
    const cleanup = await withConfig(
      JSON.stringify({
        quote: { mint: VALID, decimals: 6 },
        tokens: {
          // Placeholder left in from the example file.
          AAPL: { mint: "<AAPLx mint address>", decimals: 8 },
          // Hex, not base58 — contains characters base58 excludes.
          NVDA: { mint: "0x0000000000000000000000000000000000000000", decimals: 8 },
          TSLA: { mint: VALID, decimals: 8 },
        },
      }),
    );
    const registry = await loadMints(true);
    expect(registry.tokens.AAPL).toBeUndefined();
    expect(registry.tokens.NVDA).toBeUndefined();
    expect(registry.tokens.TSLA).toBeDefined();
    expect(executionReady(registry, "AAPL")).toBe(false);
    await cleanup();
  });

  it("drops entries with impossible decimals", async () => {
    const cleanup = await withConfig(
      JSON.stringify({
        quote: { mint: VALID, decimals: 6 },
        tokens: {
          AAPL: { mint: VALID, decimals: 99 },
          NVDA: { mint: VALID, decimals: 2.5 },
        },
      }),
    );
    const registry = await loadMints(true);
    expect(Object.keys(registry.tokens)).toHaveLength(0);
    await cleanup();
  });

  it("survives malformed JSON without taking the app down", async () => {
    const cleanup = await withConfig("{ not json");
    const registry = await loadMints(true);
    expect(registry.quote).toBeNull();
    await cleanup();
  });
});
