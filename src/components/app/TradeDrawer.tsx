"use client";

import { useEffect, useRef } from "react";
import type { BasisReading } from "@/lib/basis/compute";
import type { HistorySeries } from "@/lib/history";
import type { AlertDirection, AlertRule } from "@/lib/alerts";
import { fmtPct, fmtUsd } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { AlertControl } from "./Alerts";
import { BasisChart } from "./BasisChart";
import { TradePanel, type MintMap, type Side } from "./TradePanel";

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
  rules: AlertRule[];
  permission: NotificationPermission | "unsupported";
  onAddRule: (ticker: string, thresholdBps: number, direction: AlertDirection) => void;
  onRemoveRule: (id: string) => void;
  onRequestPermission: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

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
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[600px] flex-col border-l border-[var(--border)] bg-[var(--surface)] outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[22px] font-semibold tracking-[-0.025em]">
                {reading.tokenTicker}
              </h2>
              <Badge tone={status.tone}>{status.text}</Badge>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-[var(--text-3)]">{reading.name}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-3)] transition-colors hover:bg-[var(--raised)] hover:text-white"
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
        </header>

        {/* The three numbers the decision rests on, restated so nobody trades
            against a figure they have scrolled past. */}
        <div className="grid grid-cols-3 gap-px border-b border-[var(--border)] bg-[var(--border)]">
          <Stat label="Token" value={reading.token ? fmtUsd(reading.token.price) : "—"} />
          <Stat label="Real share" value={reading.equity ? fmtUsd(reading.equity.price) : "—"} />
          <Stat
            label="Gap"
            value={reading.basisBps === null ? "—" : fmtPct(reading.basisBps)}
            sub={reading.basisBps === null ? undefined : `${fmtUsd(gapUsd)} per share`}
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
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "down" | "up";
}) {
  return (
    <div className="bg-[var(--surface)] px-5 py-3.5 sm:px-6">
      <div className="text-[10px] uppercase tracking-[0.09em] text-[var(--text-3)]">{label}</div>
      <div
        className="num mt-1 text-[17px] font-semibold"
        style={{ color: tone ? `var(--${tone})` : "var(--text)" }}
      >
        {value}
      </div>
      {sub && <div className="num mt-0.5 text-[11px] text-[var(--text-3)]">{sub}</div>}
    </div>
  );
}
