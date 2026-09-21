"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "kolu:first-visit-dismissed";

/**
 * Three things to try, for someone arriving cold — usually a judge with two
 * minutes. Each is a real action, not a tour step: the replay, a live
 * portfolio, and a trade ticket to dry-run. Dismissed once, remembered.
 * Hidden until mounted so server and client render the same HTML.
 */
export function FirstVisit({
  onReplay,
  onExample,
  onTicket,
}: {
  onReplay: () => void;
  onExample: () => void;
  onTicket: () => void;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(DISMISSED_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* hidden for this visit */
    }
  };

  if (!show) return null;

  const step = (n: number, label: string, detail: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 flex-1 items-start gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left transition-colors hover:bg-[var(--raised)]"
    >
      <span className="num mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-[11px] text-[var(--text-3)] group-hover:border-[var(--accent)] group-hover:text-[var(--accent)]">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-white">{label}</span>
        <span className="block text-[12px] leading-snug text-[var(--text-3)]">{detail}</span>
      </span>
    </button>
  );

  return (
    <section
      className="panel mt-4 flex flex-col gap-1 p-1.5 sm:flex-row sm:items-stretch"
      aria-label="Things to try"
    >
      {step(1, "Replay a dislocation", "See Kolu recommend a trade that pays", onReplay)}
      {step(2, "See a live portfolio", "A public wallet's real xStocks, read-only", onExample)}
      {step(3, "Dry-run a trade", "Simulate the exact swap on mainnet", onTicket)}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="self-end rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[12px] text-[var(--text-3)] transition-colors hover:bg-[var(--raised)] hover:text-white sm:self-center"
      >
        Got it
      </button>
    </section>
  );
}
