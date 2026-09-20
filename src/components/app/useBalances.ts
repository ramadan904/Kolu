"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  parseTokenBalances,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type TokenBalance,
} from "@/lib/tokens";

export interface BalanceState {
  balances: Map<string, TokenBalance>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Token balances for the connected wallet.
 *
 * Queries both token programs, because xStocks are Token-2022 and USDC is not.
 * A failure returns an empty map with `error` set rather than pretending the
 * wallet is empty — "you hold nothing" and "we could not find out" lead to
 * different decisions.
 */
export function useBalances(): BalanceState {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const [balances, setBalances] = useState<Map<string, TokenBalance>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!connected || !publicKey) {
      setBalances(new Map());
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const [classic, token2022] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: new PublicKey(TOKEN_PROGRAM_ID),
          }),
          connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: new PublicKey(TOKEN_2022_PROGRAM_ID),
          }),
        ]);

        if (cancelled) return;
        const merged = new Map([
          ...parseTokenBalances(classic),
          ...parseTokenBalances(token2022),
        ]);
        setBalances(merged);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setBalances(new Map());
        setError(
          err instanceof Error && /429|rate/i.test(err.message)
            ? "The RPC endpoint is rate limiting. Set NEXT_PUBLIC_SOLANA_RPC to a dedicated one."
            : "Could not read balances from the network.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, nonce]);

  return { balances, loading, error, refresh };
}
