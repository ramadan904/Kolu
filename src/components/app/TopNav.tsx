"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const PAGES = [
  { href: "/", label: "Board" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/history", label: "History" },
  { href: "/backtest", label: "Backtest" },
] as const;

export type View = "board" | "portfolio" | "history" | "backtest";

export function viewFor(pathname: string | null): View {
  if (pathname?.startsWith("/portfolio")) return "portfolio";
  if (pathname?.startsWith("/history")) return "history";
  if (pathname?.startsWith("/backtest")) return "backtest";
  return "board";
}

/**
 * The four pages. Links carry no query: an open ticket or a replay is state
 * the shared board keeps, not something each page has to re-read.
 */
export function TopNav({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const active = viewFor(pathname);
  return (
    <nav aria-label="Pages" className={compact ? "flex gap-1 overflow-x-auto" : "flex items-center gap-1"}>
      {PAGES.map((p) => {
        const on = viewFor(p.href) === active;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className={`relative shrink-0 rounded-[6px] px-3 py-1.5 text-[13px] transition-colors ${
              on ? "text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
            } ${compact ? "flex-1 text-center" : ""}`}
          >
            {p.label}
            {on && (
              <span
                aria-hidden="true"
                className={`absolute left-3 right-3 h-[2px] rounded-full bg-[var(--accent)] ${
                  compact ? "-bottom-[9px]" : "-bottom-[13px]"
                }`}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
