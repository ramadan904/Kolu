"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { BalancesProvider } from "./useBalances";

/**
 * Wallet plumbing.
 *
 * No adapter list: Phantom, Solflare, Backpack and the rest register themselves
 * through the Wallet Standard, so hardcoding adapters only means shipping a
 * bundle of wallets the user does not have and missing the one they do.
 */
export function SolanaProviders({ children }: { children: React.ReactNode }) {
  // The public mainnet endpoint refuses browser requests outright (403), so
  // without a dedicated endpoint the browser talks to Kolu's own relay, which
  // forwards the wallet flow's calls from the server. Connection needs an
  // absolute URL; during server render there is no origin and nothing is sent.
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SOLANA_RPC ??
      (typeof window === "undefined"
        ? "http://localhost/api/rpc"
        : `${window.location.origin}/api/rpc`),
    [],
  );
  // Confirmation is polled over HTTP (see lib/confirm), so no subscription is
  // ever opened. Pointing the socket at the real cluster stops web3.js from
  // deriving a ws:// URL on the relay, which a serverless route cannot serve.
  const config = useMemo(
    () => ({
      commitment: "confirmed" as const,
      wsEndpoint: process.env.NEXT_PUBLIC_SOLANA_WS ?? "wss://api.mainnet-beta.solana.com",
    }),
    [],
  );
  const wallets = useMemo<Adapter[]>(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <BalancesProvider>{children}</BalancesProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
