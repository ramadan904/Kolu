"use client";

import type { ReactNode } from "react";
import { WalletButton } from "./WalletButton";

function Mark() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect width="20" height="20" rx="5" fill="#16161a" />
        <rect x="9.25" y="3.5" width="1.5" height="13" rx="0.75" fill="#5c5c66" />
        <rect x="10.75" y="5.5" width="5.75" height="3" rx="1.5" fill="#ef4444" />
        <rect x="3.5" y="11.5" width="5.75" height="3" rx="1.5" fill="#1aa179" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.02em]">Kolu</span>
    </span>
  );
}

export function Shell({
  children,
  nav,
}: {
  children: ReactNode;
  nav?: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Mark />
          <div className="hidden flex-1 sm:block">{nav}</div>
          <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
            <WalletButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        <p className="text-[11px] leading-relaxed text-[var(--text-3)]">
          Prices are oracle mid, not a quote you can hit. Net edge assumes the price
          impact shown. Kolu is analysis, not investment advice.
        </p>
      </footer>
    </div>
  );
}
