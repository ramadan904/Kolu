"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  parseTokenBalances,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type TokenBalance,
} from "@/lib/tokens";

/** Balances move on-chain without us; a slow poll keeps the portfolio honest. */
const POLL_MS = 30_000;

const REFRESH_EVENT = "kolu:balances-refresh";

/**
 * Ask every mounted balance reader to re-read the chain. Called after a swap
 * confirms, so the portfolio and the ticket both reflect the fill without a
 * reload — the moment someone is most likely to look.
 */
export function requestBalancesRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}

export interface BalanceState {
  balances: Map<string, TokenBalance>;
  /** True only until the first read lands; background polls do not flicker the UI. */
  loading: boolean;
  /** A re-read is in flight over data already on screen. */
  refreshing: boolean;
  error: string | null;
  /** When the balances on screen were read, ms since epoch. */
  updatedAt: number | null;
  refresh: () => void;
}

const BalancesContext = createContext<BalanceState | null>(null);

/**
 * One chain reader for the whole page.
 *
 * The portfolio, the ticket and the map all need the same balances. Each
 * calling the hook on its own meant two RPC round-trips per consumer per poll,
 * against a public endpoint that rate-limits — the failure mode the error copy
 * below already had to describe.
 */
export function BalancesProvider({ children }: { children: ReactNode }) {
  const state = useBalanceReader();
  return createElement(BalancesContext.Provider, { value: state }, children);
}

/** Balances for the connected wallet, from the page's single reader. */
export function useBalances(): BalanceState {
  const state = useContext(BalancesContext);
  if (!state) throw new Error("useBalances must be used inside <BalancesProvider>");
  return state;
}

/**
 * Token balances for the connected wallet.
 *
 * Queries both token programs, because xStocks are Token-2022 and USDC is not.
 * A failure on the first read returns an empty map with `error` set rather than
 * pretending the wallet is empty — "you hold nothing" and "we could not find
 * out" lead to different decisions. A failure on a later poll keeps the last
 * good read and marks it stale instead of blanking a portfolio that was right
 * thirty seconds ago.
 */
function useBalanceReader(): BalanceState {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const [balances, setBalances] = useState<Map<string, TokenBalance>>(new Map());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  // Which wallet the balances on screen belong to. Switching wallets must not
  // present the previous wallet's holdings as a "refresh" of the new one.
  const readFor = useRef<string | null>(null);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, refresh);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => {
      window.removeEventListener(REFRESH_EVENT, refresh);
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setBalances(new Map());
      setError(null);
      setUpdatedAt(null);
      readFor.current = null;
      return;
    }

    let cancelled = false;
    const owner = publicKey.toBase58();
    const hasRead = readFor.current === owner;
    if (hasRead) {
      setRefreshing(true);
    } else {
      setBalances(new Map());
      setUpdatedAt(null);
      setLoading(true);
    }

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
        setUpdatedAt(Date.now());
        readFor.current = owner;
      } catch (err) {
        if (cancelled) return;
        if (!hasRead) setBalances(new Map());
        setError(
          err instanceof Error && /429|rate/i.test(err.message)
            ? "The RPC endpoint is rate limiting. Set NEXT_PUBLIC_SOLANA_RPC to a dedicated one."
            : "Could not read balances from the network.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection, nonce]);

  return { balances, loading, refreshing, error, updatedAt, refresh };
}
