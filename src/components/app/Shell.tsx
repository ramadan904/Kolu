"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { TopNav } from "./TopNav";
import { WalletButton } from "./WalletButton";

function Mark() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect width="20" height="20" rx="5" fill="#12141b" stroke="rgba(255,255,255,0.12)" />
        <rect x="9.25" y="3.5" width="1.5" height="13" rx="0.75" fill="#5c5c66" />
        <rect x="10.75" y="5.5" width="5.75" height="3" rx="1.5" fill="#ef4444" />
        <rect x="3.5" y="11.5" width="5.75" height="3" rx="1.5" fill="#1aa179" />
      </svg>
      <span className="text-[16px] font-semibold tracking-[-0.03em]">Kolu</span>
    </span>
  );
}

/**
 * The swap that proves the trade path: made through this ticket, signed in a
 * wallet, confirmed on mainnet. Figures are the transaction's own balance
 * changes, not the quote that preceded it.
 */
const REAL_FILL = {
  paid: "4.007 USDC",
  received: "0.010582 TSLAX",
  date: "22 Sep 2026",
  url: "https://solscan.io/tx/5YyfS2csucHcc7e4U1XsrvA3gk8whBLHt5CcEHL1M7ZyBHU1a86NM8K2qxoJWZGzGxn9ZC9XMmLeJ1rNSbMe9MhY",
};

export function Shell({
  children,
  nav,
}: {
  children: ReactNode;
  nav?: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[#05060a]/70 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="Kolu, board">
            <Mark />
          </Link>
          <div className="hidden flex-1 sm:block">{nav}</div>
          <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
            <WalletButton />
          </div>
        </div>
        {/* Phones: the four pages as a tab row under the bar. */}
        {nav && (
          <div className="border-t border-[var(--border)] px-2 py-1.5 sm:hidden">
            <TopNav compact />
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">{children}</main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Mark />
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-[var(--text-2)]">
              When a tokenized stock trades away from the real share, what that gap is worth
              after costs — and a way to act on it.
            </p>
          </div>
          <FooterCol
            title="Product"
            links={[
              ["Board", "/"],
              ["Portfolio", "/portfolio"],
              ["Gap history", "/history"],
              ["Backtest", "/backtest"],
              ["Replay a real dislocation", "/?replay=1"],
              ["A live portfolio", "/portfolio?view=example"],
            ]}
          />
          <FooterCol
            title="Data"
            links={[
              ["Live prices · Jupiter", "https://jup.ag"],
              ["Pool history · GeckoTerminal", "https://www.geckoterminal.com/solana"],
              ["xStocks", "https://xstocks.com"],
              ["System health", "/api/health"],
            ]}
          />
          <FooterCol
            title="Project"
            links={[
              ["Source on GitHub", "https://github.com/ramadan904/Kolu"],
              ["Built for STOCKLANA", "https://hackathons.solana.com/hackathons/stocklana"],
            ]}
          />
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          {/* The proof that the trade path is not a diagram: a swap made here,
              on mainnet, that anyone can open and check. */}
          <a
            href={REAL_FILL.url}
            target="_blank"
            rel="noreferrer noopener"
            className="group flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-[var(--border)] pt-5 text-[12px] text-[var(--text-3)] transition-colors hover:text-[var(--text-2)]"
          >
            <span className="mono rounded-full border border-[var(--down)]/30 bg-[var(--down-soft)] px-2 py-0.5 text-[10.5px] tracking-[0.06em] text-[var(--down)]">
              REAL FILL
            </span>
            <span className="num text-[var(--text-2)]">{REAL_FILL.paid}</span>
            <span aria-hidden="true">→</span>
            <span className="num text-[var(--text-2)]">{REAL_FILL.received}</span>
            <span>· swapped through Kolu on {REAL_FILL.date}, signed in a wallet, confirmed on mainnet</span>
            <span className="text-[var(--accent)] underline-offset-2 group-hover:underline">view on Solscan ↗</span>
          </a>
          <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-3)]">
            Prices are mid, not a quote you can hit; the ticket prices trades from live
            Jupiter quotes. Kolu never holds keys — every trade and order is signed in your wallet.
            Kolu is analysis, not investment advice.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">{title}</div>
      <ul className="mt-3 space-y-2 text-[13px]">
        {links.map(([label, href]) => {
          const external = href.startsWith("http");
          return (
            <li key={label}>
              {external || href.startsWith("/api") ? (
                <a
                  href={href}
                  {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                  className="text-[var(--text-2)] transition-colors hover:text-white"
                >
                  {label}
                  {external && " ↗"}
                </a>
              ) : (
                // In-app pages keep the board's state (prices, a replay, a watched address).
                <Link href={href} className="text-[var(--text-2)] transition-colors hover:text-white">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
