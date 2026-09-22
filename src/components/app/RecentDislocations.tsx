"use client";

import { useEffect, useState } from "react";
import type { Dislocation } from "@/app/api/dislocations/route";
import { fmtBps } from "@/lib/format";
import { etTime, PHASE_COPY } from "./GapHistory";

/**
 * The widest real gap each liquid pair showed in the last two days — when it
 * happened, in which session, and whether it would have paid. The honest
 * version of a "top movers" list: most rows say it would not have.
 */
export function RecentDislocations({ onSelect }: { onSelect: (ticker: string) => void }) {
  const [rows, setRows] = useState<Dislocation[] | null>(null);
  const [breakeven, setBreakeven] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dislocations");
        const body = await res.json();
        if (cancelled) return;
        setRows(body.dislocations ?? []);
        setBreakeven(body.breakevenBps ?? null);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const max = Math.max(1, ...(rows ?? []).map((r) => Math.abs(r.basisBps)));

  return (
    <section className="panel mb-5 overflow-hidden" aria-labelledby="recent-dislocations">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <h2 id="recent-dislocations" className="text-[13px] uppercase tracking-[0.07em] text-[var(--text-3)]">
          Recent dislocations
        </h2>
        <span className="text-[12px] text-[var(--text-3)]">
          Widest real gap per pair, last 48h
          {breakeven !== null && <> · a $10k trade needs {breakeven}bps to pay</>}
        </span>
      </div>

      {failed ? (
        <p className="px-4 py-4 text-[13px] text-[var(--text-3)] sm:px-5">Could not load recent history.</p>
      ) : rows === null ? (
        <div className="space-y-2 px-4 py-4 sm:px-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-9" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-[var(--text-3)] sm:px-5">
          History sources are rate-limiting right now; this fills in within a few minutes.
        </p>
      ) : (
        <ul>
          {rows.map((r) => {
            const rich = r.basisBps > 0;
            return (
              <li key={r.ticker}>
                <button
                  type="button"
                  onClick={() => onSelect(r.ticker)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 border-b border-[var(--border)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--raised)] sm:grid-cols-[120px_1fr_150px_minmax(280px,auto)] sm:px-5"
                >
                  <span>
                    <span className="text-[14px] font-medium">{r.tokenTicker}</span>
                    <span className="ml-2 text-[12px] text-[var(--text-3)] sm:hidden">{r.name}</span>
                  </span>
                  <span className="hidden items-center gap-3 sm:flex">
                    <span className="relative h-1.5 flex-1 rounded-full bg-[var(--raised)]">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${(Math.abs(r.basisBps) / max) * 100}%`,
                          background: rich ? "var(--up)" : "var(--down)",
                          opacity: r.clearedCosts ? 1 : 0.55,
                        }}
                      />
                    </span>
                  </span>
                  <span className="num text-right text-[14px] sm:text-left" style={{ color: rich ? "var(--up)" : "var(--down)" }}>
                    {fmtBps(r.basisBps, 0)}
                    <span className="ml-2 text-[12px] text-[var(--text-3)]">{rich ? "rich" : "cheap"}</span>
                  </span>
                  <span className="col-span-2 text-[12px] text-[var(--text-3)] sm:col-span-1 sm:text-right sm:whitespace-nowrap">
                    {etTime(r.t)} ET · {PHASE_COPY[r.phase]}
                    <span
                      className="ml-2"
                      style={{ color: r.clearedCosts ? "var(--down)" : "var(--text-3)" }}
                    >
                      {r.clearedCosts ? "· would have paid" : "· below costs"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
