"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter } from "@solana/wallet-adapter-base";

/**
 * Wallet plumbing.
 *
 * No adapter list: Phantom, Solflare, Backpack and the rest register themselves
 * through the Wallet Standard, so hardcoding adapters only means shipping a
 * bundle of wallets the user does not have and missing the one they do.
 */
export function SolanaProviders({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com",
    [],
  );
  const wallets = useMemo<Adapter[]>(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
