"use client";

import { useCallback, useEffect, useState } from "react";
import type { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { classify, nativeSolDelta, type ParsedTxLike } from "@/lib/activity";
import { SOL_MINT } from "@/lib/tokens";
import { loadJournal, saveJournal, withFill, withManual, type Journal } from "@/lib/journal";

const CHANGE_EVENT = "kolu:journal";

export function useJournal(owner: string | null) {
  const [journal, setJournal] = useState<Journal>({ fills: [], manual: {} });

  useEffect(() => {
    if (!owner) return setJournal({ fills: [], manual: {} });
    const read = () => setJournal(loadJournal(owner));
    read();
    window.addEventListener(CHANGE_EVENT, read);
    // Another tab recording a fill or an entry.
    const onStorage = (e: StorageEvent) => {
      if (e.key?.endsWith(owner)) read();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, read);
      window.removeEventListener("storage", onStorage);
    };
  }, [owner]);

  const setManual = useCallback(
    (ticker: string, price: number | null) => {
      if (!owner) return;
      saveJournal(owner, withManual(loadJournal(owner), ticker, price));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [owner],
  );

  return { journal, setManual };
}

/**
 * Records a confirmed Kolu swap from what the transaction actually moved, not
 * from the quote: the fill is the price paid, slippage included. If the
 * transaction cannot be read back, nothing is recorded — an entry price built
 * from the quote would be a guess wearing the fill's name.
 */
export async function recordFill(
  connection: Connection,
  signature: string,
  owner: string,
  ticker: string,
  tokenMint: string,
  /** The other leg: USDC at $1, or native SOL at its price when quoted. */
  pay: { mint: string; priceUsd: number },
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const tx = (await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })) as ParsedTransactionWithMeta | null;
      if (tx) {
        const parsed = tx as unknown as ParsedTxLike;
        const sol = pay.mint === SOL_MINT;
        const item = classify(parsed, owner, { [tokenMint]: ticker }, sol ? null : pay.mint);
        if (!item || item.failed) return;
        let usd = item.usdcAmount;
        let kind = item.kind;
        if (sol) {
          // Native SOL is not a token balance: read the lamports that moved,
          // net of fee and new-account rent, and value them at the quoted price.
          const delta = nativeSolDelta(parsed, owner);
          if (delta === null || !(pay.priceUsd > 0)) return;
          const bought = item.kind === "received" && delta < 0;
          const sold = item.kind === "sent" && delta > 0;
          if (!bought && !sold) return;
          kind = bought ? "bought" : "sold";
          usd = Math.abs(delta) * pay.priceUsd;
        }
        if (usd === null || (kind !== "bought" && kind !== "sold")) return;
        saveJournal(
          owner,
          withFill(loadJournal(owner), {
            signature,
            t: (item.time ?? Math.floor(Date.now() / 1000)) * 1000,
            ticker,
            side: kind === "bought" ? "buy" : "sell",
            tokenAmount: item.tokenAmount,
            usdcAmount: usd,
          }),
        );
        window.dispatchEvent(new Event(CHANGE_EVENT));
        return;
      }
    } catch {
      /* not indexed yet, or rate-limited: try again shortly */
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}
