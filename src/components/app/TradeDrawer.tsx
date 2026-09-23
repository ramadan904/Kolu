"use client";

import { useEffect, useRef, useState } from "react";
import type { BasisReading } from "@/lib/basis/compute";
import type { HistorySeries } from "@/lib/history";
import type { AlertDirection, AlertRule } from "@/lib/alerts";
import { fmtPct, fmtUsd } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { AlertControl } from "./Alerts";
import { BasisChart } from "./BasisChart";
import { TradePanel, type MintMap, type Side } from "./TradePanel";
import { gapContext } from "@/lib/data/market-history";

/**
 * A focused surface for committing capital.
 *
 * The ticket used to live inline beneath the table, which made trading feel
 * like scrolling. Money decisions deserve their own context: everything else
 * recedes, the pair and the gap are restated at the top so nobody acts on a
 * number they have scrolled away from, and there is one obvious way out.
 */
export function TradeDrawer({
  reading,
  history,
  observed,
  hedgeable,
  mints,
  initialSide,
  demo = false,
  replayKind = "modelled",
  rules,
  permission,
  onAddRule,
  onRemoveRule,
  onRequestPermission,
  onClose,
}: {
  reading: BasisReading;
  history: HistorySeries | null;
  observed: { t: number; basisBps: number }[];
  hedgeable: boolean;
  mints: MintMap | null;
  initialSide?: Side;
  demo?: boolean;
  /** Passed through: a real replayed moment reads differently from a modelled one. */
  replayKind?: "real" | "modelled";
  rules: AlertRule[];
  permission: NotificationPermission | "unsupported";
  onAddRule: (ticker: string, thresholdBps: number, direction: AlertDirection) => void;
  onRemoveRule: (id: string) => void;
  onRequestPermission: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // The address bar already mirrors this ticket (see Radar), so sharing it is
  // copying the current URL.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the address bar still has the link */
    }
  };

  // Escape closes, focus moves in, and the page behind does not scroll away
  // underneath the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // How unusual this gap is for this pair — only from real history, never
  // from the modelled fallback.
  const context =
    history?.source === "market" && reading.basisBps !== null
      ? gapContext(history.points, reading.basisBps)
      : null;

  const discount = (reading.basisBps ?? 0) < 0;
  const gapUsd = Math.abs(reading.basisUsd ?? 0);
  // "Trading cheap" is a claim. It is only made when the board calls the gap
  // a signal; otherwise the header says what the board concluded instead.
  const signal = reading.signal === "actionable" || reading.signal === "stale_reference";
  const status: { tone: "down" | "up" | "warn" | "neutral"; text: string } = signal
    ? { tone: discount ? "down" : "up", text: discount ? "Trading cheap" : "Trading rich" }
    : reading.signal === "degraded_feed"
      ? { tone: "warn", text: "Feed stalled" }
      : reading.signal === "noise"
        ? { tone: "neutral", text: "Within noise" }
        : { tone: "neutral", text: "No data" };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-[3px]"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-full w-full min-w-0 max-w-[600px] flex-col border-l border-white/10 shadow-[-40px_0_80px_-20px_rgba(0,0,0,0.9)]"
        // Focus lands here for the keyboard; the site-wide ring would draw a
        // stray line down the panel's edge.
        style={{
          outline: "none",
          background:
            "radial-gradient(520px 260px at 80% -60px, rgba(59,130,255,0.16), transparent 70%), linear-gradient(180deg, #0b0c12, #07080c)",
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="display text-electric text-[30px] leading-none">
                {reading.tokenTicker}
              </h2>
              <Badge tone={status.tone}>{status.text}</Badge>
            </div>
            <p className="mono mt-1.5 truncate text-[11px] uppercase tracking-[0.08em] text-[var(--text-3)]">{reading.name} · vs the real share</p>
          </div>

          <div className="-mr-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copyLink()}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[var(--text-3)] transition-colors hover:bg-[var(--raised)] hover:text-white"
            aria-live="polite"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[var(--radius-sm)] p-1.5 text-[var(--text-3)] transition-colors hover:bg-[var(--raised)] hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d="M4.5 4.5l9 9m0-9l-9 9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          </div>
        </header>

        {/* The three numbers the decision rests on, restated so nobody trades
            against a figure they have scrolled past. */}
        <div className="grid grid-cols-3 gap-px border-b border-white/[0.07] bg-white/[0.07]">
          <Stat label="Token" value={reading.token ? fmtUsd(reading.token.price) : "—"} />
          <Stat label="Real share" value={reading.equity ? fmtUsd(reading.equity.price) : "—"} />
          <Stat
            label="Gap"
            value={reading.basisBps === null ? "—" : fmtPct(reading.basisBps)}
            sub={reading.basisBps === null ? undefined : `${fmtUsd(gapUsd)} per share`}
            sub2={
              context
                ? context.percentile >= 50
                  ? `wider than ${context.percentile}% of 48h`
                  : `tighter than ${100 - context.percentile}% of 48h`
                : undefined
            }
            tone={signal ? (discount ? "down" : "up") : undefined}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {/* The recommendation below already covers noise and stalled feeds;
              only the closed-market context adds something it does not. */}
          {reading.note && reading.signal === "stale_reference" && (
            <p className="mb-3 text-[12px] leading-relaxed text-[var(--text-3)]">{reading.note}</p>
          )}

          <TradePanel
            reading={reading}
            hedgeable={hedgeable}
            mints={mints}
            initialSide={initialSide}
            demo={demo}
            replayKind={replayKind}
            typical={
              context && context.typicalOpenBps !== null && context.typicalShutBps !== null
                ? { openBps: context.typicalOpenBps, shutBps: context.typicalShutBps }
                : undefined
            }
          >
            {history && (
              <div className="border-t border-[var(--border)] pt-6">
                <BasisChart series={history} observed={observed} />
              </div>
            )}

            <div className={`border-t border-[var(--border)] pt-6 ${history ? "mt-7" : ""}`}>
              <AlertControl
                ticker={reading.ticker}
                tokenTicker={reading.tokenTicker}
                currentBps={reading.basisBps}
                rules={rules}
                permission={permission}
                onAdd={onAddRule}
                onRemove={onRemoveRule}
                onRequestPermission={onRequestPermission}
              />
            </div>
          </TradePanel>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  sub2,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  sub2?: string;
  tone?: "down" | "up";
}) {
  return (
    <div className="bg-[#08090d] px-5 py-4 sm:px-6">
      <div className="mono text-[10px] uppercase tracking-[0.09em] text-[var(--text-3)]">{label}</div>
      <div
        className={`display num mt-1.5 text-[22px] leading-none ${tone === "down" ? "text-cheap" : tone === "up" ? "text-rich" : "text-white"}`}
      >
        {value}
      </div>
      {sub && <div className="num mt-0.5 text-[11px] text-[var(--text-3)]">{sub}</div>}
      {sub2 && <div className="num text-[11px] text-[var(--text-2)]">{sub2}</div>}
    </div>
  );
}
