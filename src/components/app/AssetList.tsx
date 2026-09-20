"use client";

import type { BasisReading } from "@/lib/basis/compute";
import { computeEdge } from "@/lib/basis/edge";
import { formatAge } from "@/lib/basis/compute";
import { fmtBps, fmtPct, fmtUsd } from "@/lib/format";
import { Dot } from "@/components/ui/Badge";

const SIGNAL_LABEL: Record<BasisReading["signal"], string> = {
  actionable: "Live gap",
  stale_reference: "Overnight drift",
  noise: "Within noise",
  degraded_feed: "Feed stalled",
  unavailable: "No data",
};

function GapBar({ bps, domain }: { bps: number; domain: number }) {
  const pct = Math.min(Math.abs(bps) / domain, 1) * 50;
  const discount = bps < 0;
  return (
    <div className="relative h-1 w-full" aria-hidden="true">
      <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
      <div
        className="absolute top-0 h-1 rounded-full"
        style={{
          left: discount ? `${50 - pct}%` : "50%",
          width: `${Math.max(pct, 0.5)}%`,
          background: discount ? "var(--down)" : "var(--up)",
        }}
      />
    </div>
  );
}

export function AssetList({
  readings,
  hedgeable,
  selected,
  onSelect,
}: {
  readings: BasisReading[];
  hedgeable: boolean;
  selected: string | null;
  onSelect: (ticker: string) => void;
}) {
  const domain = Math.max(60, ...readings.map((r) => Math.abs(r.basisBps ?? 0)));

  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--border)] px-4 py-2.5 text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)] sm:grid-cols-[1.4fr_1fr_1fr_1.1fr_0.9fr] sm:px-5">
        <span>Asset</span>
        <span className="hidden text-right sm:block">Token</span>
        <span className="hidden text-right sm:block">Real share</span>
        <span className="text-right">Gap</span>
        <span className="hidden text-right sm:block">Net at $10k</span>
      </div>

      <ul>
        {readings.map((r) => {
          const missing = r.basisBps === null;
          const discount = (r.basisBps ?? 0) < 0;
          const muted = r.signal === "noise" || r.signal === "degraded_feed" || missing;
          const edge = missing
            ? null
            : computeEdge({ basisBps: r.basisBps!, notionalUsd: 10_000, hedgeable });
          const isSelected = selected === r.ticker;

          return (
            <li key={r.ticker}>
              <button
                type="button"
                onClick={() => onSelect(r.ticker)}
                aria-expanded={isSelected}
                className={`group grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--border)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--raised)] sm:grid-cols-[1.4fr_1fr_1fr_1.1fr_0.9fr] sm:px-5 ${isSelected ? "bg-[var(--raised)]" : ""}`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium">{r.tokenTicker}</span>
                    {r.signal === "degraded_feed" && <Dot tone="warn" />}
                    <svg
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                    >
                      <path
                        d="M4.5 2.5L8 6l-3.5 3.5"
                        stroke="var(--text-3)" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-[var(--text-3)]">
                    <span>{SIGNAL_LABEL[r.signal]}</span>
                    {r.referenceAgeSeconds !== null && r.referenceAgeSeconds > 120 && (
                      <span>· {formatAge(r.referenceAgeSeconds)} old</span>
                    )}
                  </span>
                </span>

                <span className="num hidden text-right text-[14px] sm:block">
                  {r.token ? fmtUsd(r.token.price) : "—"}
                </span>
                <span className="num hidden text-right text-[14px] text-[var(--text-2)] sm:block">
                  {r.equity ? fmtUsd(r.equity.price) : "—"}
                </span>

                <span className="text-right">
                  <span
                    className="num block text-[15px] font-medium"
                    style={{
                      color: missing
                        ? "var(--text-3)"
                        : muted
                          ? "var(--text-2)"
                          : discount
                            ? "var(--down)"
                            : "var(--up)",
                    }}
                  >
                    {missing ? "—" : fmtPct(r.basisBps!)}
                  </span>
                  {!missing && (
                    <span className="mt-1.5 block">
                      <GapBar bps={r.basisBps!} domain={domain} />
                    </span>
                  )}
                </span>

                {/* Always a number. Hiding a negative net behind a dash made
                    this column permanently blank during market hours, when the
                    honest answer — how far underwater the trade is — is
                    exactly what a trader needs. */}
                <span className="num hidden text-right text-[14px] sm:block">
                  {edge === null ? (
                    <span className="text-[var(--text-3)]">—</span>
                  ) : (
                    <>
                      <span
                        className="block"
                        style={{
                          color:
                            edge.netBps > 0
                              ? edge.tone === "good"
                                ? "var(--down)"
                                : "var(--warn)"
                              : "var(--text-2)",
                        }}
                      >
                        {fmtBps(edge.netBps, 0)}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-3)]">
                        {edge.netBps > 0 ? fmtUsd(edge.netUsd) : "below costs"}
                      </span>
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
