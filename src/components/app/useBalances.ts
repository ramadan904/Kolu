"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PublicKey, type Connection } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  parseTokenBalances,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type TokenBalance,
} from "@/lib/tokens";

/** Balances move on-chain without us; a slow poll keeps the portfolio honest. */
const POLL_MS = 30_000;
/** Back-off before each retry of a rate-limited read. */
const RETRY_DELAYS_MS = [800, 2_000];

export const REFRESH_EVENT = "kolu:balances-refresh";
const WATCH_STORAGE_KEY = "kolu:watch-address";

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
  /** The address being read: the connected wallet, else a watched address, else null. */
  owner: string | null;
  /** True when `owner` is a watched address rather than a connected wallet. */
  watching: boolean;
  /** Read any address, read-only. Returns false if it is not a valid Solana address. */
  watch: (address: string) => boolean;
  stopWatching: () => void;
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

/** Balances for the connected (or watched) wallet, from the page's single reader. */
export function useBalances(): BalanceState {
  const state = useContext(BalancesContext);
  if (!state) throw new Error("useBalances must be used inside <BalancesProvider>");
  return state;
}

function isRateLimit(err: unknown): boolean {
  return err instanceof Error && /429|rate|too many/i.test(err.message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Both token programs, retried through short rate-limit bursts. The public
 * endpoint answers 429 in bursts that clear within a second or two; failing
 * on the first one would show "could not read" to someone whose wallet is fine.
 */
async function readBalances(connection: Connection, owner: PublicKey) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const [classic, token2022] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner, {
          programId: new PublicKey(TOKEN_PROGRAM_ID),
        }),
        connection.getParsedTokenAccountsByOwner(owner, {
          programId: new PublicKey(TOKEN_2022_PROGRAM_ID),
        }),
      ]);
      return new Map([...parseTokenBalances(classic), ...parseTokenBalances(token2022)]);
    } catch (err) {
      if (!isRateLimit(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * Token balances for the connected wallet — or, with none connected, for an
 * address someone asked to watch.
 *
 * Watching exists so the portfolio can be seen working without a wallet or
 * without holding xStocks: paste any address and its real holdings are valued
 * against the live gaps. It is strictly read-only; nothing can be signed for
 * an address you only watch, and a connected wallet always takes precedence.
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
  const [watched, setWatched] = useState<string | null>(null);
  // Which address the balances on screen belong to. Switching must not present
  // the previous address's holdings as a "refresh" of the new one.
  const readFor = useRef<string | null>(null);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Restored after mount, not during render, so server and client HTML agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(WATCH_STORAGE_KEY);
      if (saved) setWatched(new PublicKey(saved).toBase58());
    } catch {
      /* storage blocked or a bad value: start with nothing watched */
    }
  }, []);

  const watch = useCallback((address: string) => {
    let key: string;
    try {
      key = new PublicKey(address.trim()).toBase58();
    } catch {
      return false;
    }
    setWatched(key);
    try {
      window.localStorage.setItem(WATCH_STORAGE_KEY, key);
    } catch {
      /* still watched for this visit */
    }
    return true;
  }, []);

  const stopWatching = useCallback(() => {
    setWatched(null);
    try {
      window.localStorage.removeItem(WATCH_STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  const walletOwner = connected && publicKey ? publicKey.toBase58() : null;
  const owner = walletOwner ?? watched;
  const watching = walletOwner === null && watched !== null;

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
    if (!owner) {
      setBalances(new Map());
      setError(null);
      setUpdatedAt(null);
      readFor.current = null;
      return;
    }

    let cancelled = false;
    const hasRead = readFor.current === owner;
    if (hasRead) {
      setRefreshing(true);
    } else {
      setBalances(new Map());
      setUpdatedAt(null);
      setError(null);
      setLoading(true);
    }

    void (async () => {
      try {
        const merged = await readBalances(connection, new PublicKey(owner));
        if (cancelled) return;
        setBalances(merged);
        setError(null);
        setUpdatedAt(Date.now());
        readFor.current = owner;
      } catch (err) {
        if (cancelled) return;
        if (!hasRead) setBalances(new Map());
        setError(
          isRateLimit(err)
            ? "The Solana network is rate limiting balance reads right now. Retrying automatically."
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
  }, [owner, connection, nonce]);

  return useMemo(
    () => ({
      balances,
      loading,
      refreshing,
      error,
      updatedAt,
      refresh,
      owner,
      watching,
      watch,
      stopWatching,
    }),
    [balances, loading, refreshing, error, updatedAt, refresh, owner, watching, watch, stopWatching],
  );
}
