"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/Button";

function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Connect control. Built here rather than using the adapter's own modal, whose
 * styling cannot be reconciled with this design system.
 */
export function WalletButton({
  size = "sm",
  full = false,
  label = "Connect wallet",
}: {
  size?: "sm" | "lg";
  full?: boolean;
  label?: string;
} = {}) {
  const { wallets, select, connect, disconnect, connecting, connected, publicKey, wallet } =
    useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = useCallback(
    async (name: string) => {
      setError(null);
      try {
        select(name as never);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not select that wallet");
      }
    },
    [select],
  );

  // The adapter needs a tick between select() and connect().
  useEffect(() => {
    if (wallet && !connected && !connecting) {
      void connect().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Connection failed";
        // A user closing the wallet popup is not an error worth showing.
        if (!/user rejected|closed/i.test(message)) setError(message);
      });
    }
  }, [wallet, connected, connecting, connect]);

  if (connected && publicKey) {
    return (
      <div className="relative" ref={ref}>
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
          <span className="num">{short(publicKey.toBase58())}</span>
        </Button>
        {open && (
          <div className="panel absolute right-0 z-50 mt-2 w-48 overflow-hidden p-1">
            <button
              type="button"
              className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--text-2)] transition-colors hover:bg-[var(--raised)] hover:text-white"
              onClick={() => {
                void navigator.clipboard?.writeText(publicKey.toBase58());
                setOpen(false);
              }}
            >
              Copy address
            </button>
            <button
              type="button"
              className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--up)] transition-colors hover:bg-[var(--up-soft)]"
              onClick={() => {
                void disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  const installed = wallets.filter((w) => w.readyState === "Installed");
  const choices = installed.length > 0 ? installed : wallets;

  return (
    <div className={`relative ${full ? "w-full" : ""}`} ref={ref}>
      <Button size={size} full={full} loading={connecting} onClick={() => setOpen((v) => !v)}>
        {connecting ? "Connecting" : label}
      </Button>

      {open && (
        <div className={`panel absolute right-0 z-50 mt-2 p-1 ${full ? "left-0" : "w-60"}`}>
          {choices.length === 0 ? (
            <div className="px-3 py-4 text-sm text-[var(--text-2)]">
              No Solana wallet detected.
              <a
                href="https://phantom.app"
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 block text-[var(--accent)] hover:underline"
              >
                Install Phantom
              </a>
            </div>
          ) : (
            choices.map((w) => (
              <button
                key={w.adapter.name}
                type="button"
                onClick={() => void pick(w.adapter.name)}
                className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--raised)]"
              >
                {w.adapter.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.adapter.icon} alt="" className="h-5 w-5 rounded" />
                )}
                <span className="flex-1">{w.adapter.name}</span>
                {w.readyState === "Installed" && (
                  <span className="text-[11px] text-[var(--text-3)]">Detected</span>
                )}
              </button>
            ))
          )}
          {error && (
            <p className="px-3 py-2 text-[12px] leading-relaxed text-[var(--up)]">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
