"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { classify, type Activity, type ParsedTxLike } from "@/lib/activity";
import { TOKEN_2022_PROGRAM_ID } from "@/lib/tokens";
import type { MintMap } from "./TradePanel";
import { REFRESH_EVENT } from "./useBalances";

const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** Most transactions fetched per read; stops early once enough movements are found. */
const MAX_TX = 8;
/** Gap between transaction reads: the public cluster limits each method's burst. */
const SPACING_MS = 150;
/** Token accounts of the largest holdings to scan, and signatures from each. */
const HOLDINGS_SCANNED = 4;
const PER_ACCOUNT = 2;
const SHOWN = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimit(err: unknown): boolean {
  return /429|rate|too many/i.test(err instanceof Error ? err.message : String(err));
}

/** One call, retried through a short rate-limit burst. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (err) {
      if (!isRateLimit(err) || attempt >= 2) throw err;
      await sleep(700 * (attempt + 1));
    }
  }
}

async function getTx(connection: Connection, signature: string) {
  return withRetry(() =>
    connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    }),
  );
}

export interface ActivityState {
  items: Activity[];
  loading: boolean;
  error: string | null;
}

/**
 * Recent xStock movements for an address.
 *
 * A personal wallet's own latest transactions are where its trades are. An
 * exchange or fund wallet transacts every few seconds, so its own history is
 * all noise — for those, the token account of each large holding is scanned
 * directly, which finds xStock activity however busy the wallet is. Read on
 * demand (address change, or after a fill), never on the balance poll: this is
 * a dozen RPC calls, not two.
 */
export function useActivity(
  owner: string | null,
  mints: MintMap | null,
  heldMints: string[],
): ActivityState {
  const { connection } = useConnection();
  const [state, setState] = useState<ActivityState>({ items: [], loading: false, error: null });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const heldKey = heldMints.slice(0, HOLDINGS_SCANNED).join(",");

  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, refresh);
    return () => window.removeEventListener(REFRESH_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!owner || !mints) {
      setState({ items: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    void (async () => {
      try {
        const ownerKey = new PublicKey(owner);
        const program = new PublicKey(TOKEN_2022_PROGRAM_ID);
        const accounts = heldKey
          ? heldKey.split(",").map(
              (mint) =>
                PublicKey.findProgramAddressSync(
                  [ownerKey.toBuffer(), program.toBuffer(), new PublicKey(mint).toBuffer()],
                  ATA_PROGRAM,
                )[0],
            )
          : [];

        // Token-account history first: every one of those moved an xStock. The
        // wallet's own history after it, which is where a personal wallet's
        // trades are. Sequential, because the public cluster rate-limits bursts.
        const accountSigs: { signature: string; blockTime?: number | null }[] = [];
        for (const account of accounts) {
          const list = await withRetry(() =>
            connection.getSignaturesForAddress(account, { limit: PER_ACCOUNT }, "confirmed"),
          ).catch(() => []); // a holding outside its canonical account has no ATA history
          accountSigs.push(...list);
        }
        const ownSigs = await withRetry(() =>
          connection.getSignaturesForAddress(ownerKey, { limit: MAX_TX }, "confirmed"),
        );
        const byTime = (a: { blockTime?: number | null }, b: { blockTime?: number | null }) =>
          (b.blockTime ?? 0) - (a.blockTime ?? 0);
        const ordered: string[] = [];
        for (const s of [...accountSigs.sort(byTime), ...ownSigs.sort(byTime)]) {
          if (!ordered.includes(s.signature)) ordered.push(s.signature);
        }

        const tokens: Record<string, string> = {};
        for (const [ticker, { mint }] of Object.entries(mints.tokens)) tokens[mint] = `${ticker}X`;

        const found: Activity[] = [];
        for (const signature of ordered.slice(0, MAX_TX)) {
          if (cancelled || found.length >= SHOWN) break;
          const tx = (await getTx(connection, signature)) as ParsedTransactionWithMeta | null;
          const item = tx
            ? classify(tx as unknown as ParsedTxLike, owner, tokens, mints.quote?.mint ?? null)
            : null;
          if (item) found.push(item);
          await sleep(SPACING_MS);
        }
        const items = found.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));

        if (!cancelled) setState({ items, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // History is a nice-to-have beside balances; keep the cause findable.
        console.warn("[kolu] recent activity read failed:", err);
        setState((s) => ({
          ...s,
          loading: false,
          error:
            isRateLimit(err)
              ? "The network is rate limiting history reads. Try Refresh in a moment."
              : "Could not read recent activity.",
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, mints, heldKey, connection, nonce]);

  return state;
}
