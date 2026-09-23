"use client";

import type { BasisReading } from "@/lib/basis/compute";
import { computeEdge, DEFAULT_COSTS } from "@/lib/basis/edge";
import { formatAge } from "@/lib/basis/compute";
import { fmtBps, fmtPct, fmtUsd } from "@/lib/format";
import { Dot } from "@/components/ui/Badge";
import { useFlash } from "./useFlash";

const SIGNAL_LABEL: Record<BasisReading["signal"], string> = {
  actionable: "Live gap",
  stale_reference: "Overnight drift",
  noise: "Within noise",
  degraded_feed: "Feed stalled",
  unavailable: "No data",
};

function GapBar({ bps, domain, muted = false }: { bps: number; domain: number; muted?: boolean }) {
  const pct = Math.min(Math.abs(bps) / domain, 1) * 50;
  const discount = bps < 0;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-white/[0.04]" aria-hidden="true">
      <div className="absolute -inset-y-0.5 left-1/2 w-px bg-[var(--border-strong)]" />
      <div
        className="absolute top-0 h-1.5 rounded-full transition-all duration-700"
        style={{
          left: discount ? `${50 - pct}%` : "50%",
          width: `${Math.max(pct, 0.5)}%`,
          // Colour and light mean signal: a gap inside the noise stays grey.
          background: muted
            ? "rgba(255,255,255,0.22)"
            : discount
              ? "linear-gradient(270deg, var(--down), var(--down-2))"
              : "linear-gradient(90deg, var(--up), var(--up-2))",
          boxShadow: muted ? undefined : `0 0 10px ${discount ? "rgba(25,209,143,0.55)" : "rgba(255,77,106,0.55)"}`,
        }}
      />
    </div>
  );
}

export function AssetList({
  readings,
  hedgeable,
  frozen = false,
  selected,
  onSelect,
  held,
}: {
  readings: BasisReading[];
  hedgeable: boolean;
  /** A replayed or modelled board: nothing on it is happening now. */
  frozen?: boolean;
  selected: string | null;
  onSelect: (ticker: string) => void;
  held?: ReadonlySet<string>;
}) {
  const domain = Math.max(60, ...readings.map((r) => Math.abs(r.basisBps ?? 0)));

  return (
    <div className="panel overflow-hidden">
      <div className="mono grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--border)] bg-white/[0.015] px-4 py-2.5 text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)] sm:grid-cols-[1.4fr_1fr_1fr_1.1fr_0.9fr] sm:px-5">
        <span>Asset</span>
        <span className="hidden text-right sm:block">Token</span>
        <span className="hidden text-right sm:block">Real share</span>
        <span className="text-right">Gap</span>
        {/* Labelled as an estimate because it is one: the board assumes the
            default price impact for every pair, while the ticket measures it.
            Same formula, different input — the label says which. */}
        <span
          className="hidden text-right sm:block"
          title={`Estimated with ${DEFAULT_COSTS.priceImpactBps}bps assumed price impact per leg. The trade ticket measures it live.`}
        >
          Net at $10k <span className="normal-case tracking-normal">est.</span>
        </span>
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
                className={`group relative grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--border)] px-4 py-3.5 text-left transition-colors duration-200 last:border-b-0 hover:bg-white/[0.03] sm:grid-cols-[1.4fr_1fr_1fr_1.1fr_0.9fr] sm:px-5 ${isSelected ? "bg-white/[0.04]" : ""}`}
              >
                {/* The row being pointed at is lit from its edge. */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-2 left-0 w-[2px] rounded-full bg-gradient-to-b from-[var(--accent)] to-[var(--accent-2)] shadow-[0_0_10px_var(--glow)] transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                />
                <span className="flex min-w-0 items-center gap-3">
                  <Monogram ticker={r.tokenTicker} tone={missing || muted ? "muted" : discount ? "down" : "up"} />
                  <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-medium">{r.tokenTicker}</span>
                    {r.signal === "degraded_feed" && <Dot tone="warn" />}
                    {held?.has(r.ticker) && (
                      <span className="rounded-full border border-[var(--border-strong)] px-1.5 text-[10px] leading-[16px] text-[var(--text-2)]">
                        Held
                      </span>
                    )}
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
                    {/* "Live gap" is the right words for a live board and the
                        wrong ones for a replayed moment. */}
                    <span>{frozen && r.signal === "actionable" ? "Real gap" : SIGNAL_LABEL[r.signal]}</span>
                    {r.referenceAgeSeconds !== null && r.referenceAgeSeconds > 120 && (
                      <span>· {formatAge(r.referenceAgeSeconds)} old</span>
                    )}
                  </span>
                  </span>
                </span>

                <span className="hidden text-right sm:block">
                  <TickingPrice value={r.token?.price ?? null} />
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
                      <GapBar bps={r.basisBps!} domain={domain} muted={muted} />
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

/** A price that washes green or red for a moment when it ticks. */
function TickingPrice({ value }: { value: number | null }) {
  const flash = useFlash(value);
  return <span className={`num inline-block px-1 text-[14px] ${flash}`}>{value !== null ? fmtUsd(value) : "—"}</span>;
}

/** The pair's mark: its ticker's letters on a tile tinted by the gap's direction. */
function Monogram({ ticker, tone }: { ticker: string; tone: "down" | "up" | "muted" }) {
  const c = tone === "down" ? "25,209,143" : tone === "up" ? "255,77,106" : "150,153,166";
  return (
    <span
      aria-hidden="true"
      className="mono flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-[11px] font-medium text-white/90 transition-transform duration-200 group-hover:scale-105"
      style={{
        background: `linear-gradient(145deg, rgba(${c},0.22), rgba(${c},0.04))`,
        boxShadow: `inset 0 0 0 1px rgba(${c},0.28), inset 0 1px 0 rgba(255,255,255,0.08)`,
      }}
    >
      {ticker.replace(/X$/, "").slice(0, 4)}
    </span>
  );
}
