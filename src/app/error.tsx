"use client";

import { useEffect } from "react";

/**
 * The last line of defence: an error no section boundary caught. Replaces
 * Next's bare "Application error" with something that says what happened and
 * offers the two things that fix most of these — retry, or a clean reload.
 */
export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error("[kolu] page failed to render:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <p className="text-[13px] uppercase tracking-[0.08em] text-[var(--text-3)]">Kolu</p>
      <h1 className="display mt-3 text-[34px] leading-tight">Something on this page broke.</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-2)]">
        Nothing was signed or sent — Kolu never acts without your wallet. Try again; if it
        keeps happening, a clean reload clears any saved view.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="h-10 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Try again
        </button>
        <a
          href="/"
          className="flex h-10 items-center rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-4 text-sm text-[var(--text-2)] hover:text-white"
        >
          Reload Kolu
        </a>
      </div>
    </main>
  );
}
