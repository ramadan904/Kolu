"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter } from "@solana/wallet-adapter-base";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BalancesProvider } from "./useBalances";

/**
 * Wallet plumbing.
 *
 * Almost no adapter list: Phantom, Solflare, Backpack and the rest register
 * themselves through the Wallet Standard, so hardcoding adapters would ship a
 * bundle of wallets the user does not have and miss the one they do. The single
 * exception is Solflare's web wallet (below), which needs no extension.
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
  // Phantom, Backpack and most others register themselves through the Wallet
  // Standard, and on Android the provider adds the Mobile Wallet Adapter. The
  // one adapter listed here is Solflare's, for its web wallet: it lets someone
  // with no extension installed connect at all. With the extension present,
  // the Standard wallet of the same name takes precedence.
  const wallets = useMemo<Adapter[]>(() => [new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <BalancesProvider>{children}</BalancesProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
