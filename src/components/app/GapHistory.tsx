"use client";

import { useEffect, useMemo, useState } from "react";
import type { BasisReading } from "@/lib/basis/compute";
import type { HistorySeries } from "@/lib/history";
import type { SessionPhase } from "@/lib/market/session";
import { downsample, gapContext } from "@/lib/data/market-history";
import { fmtBps } from "@/lib/format";
import { BasisChart } from "./BasisChart";

export const PHASE_COPY: Record<SessionPhase, string> = {
  regular: "market open",
  premarket: "pre-market",
  afterhours: "after hours",
  closed: "overnight, market shut",
  weekend: "weekend, market shut",
  holiday: "holiday, market shut",
};

/** "Mon 21, 02:30" in New York time: the date too, since a week holds two Mondays' worth of ambiguity. */
export function etTime(t: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day}, ${parts.hour}:${parts.minute}`;
}

/** "Thu 17" in New York time. */
export function etDay(t: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", day: "numeric" })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day}`;
}

/**
 * The thesis, on the page rather than behind a click: any pair's last 48 hours
 * of real basis, with the numbers that summarise it. The ticket shows the same
 * series for one pair; this is where you compare them.
 */
export function GapHistory({
  readings,
  ticker,
  onTicker,
  onTrade,
  demo,
  days,
  onDays,
}: {
  readings: BasisReading[];
  ticker: string | null;
  onTicker: (ticker: string) => void;
  onTrade: (ticker: string) => void;
  demo: boolean;
  /** Window: two days (the default) or the week, which always holds a weekend. */
  days: 2 | 7;
  onDays: (days: 2 | 7) => void;
}) {
  const [series, setSeries] = useState<HistorySeries | null>(null);
  const [loading, setLoading] = useState(false);
  const active = ticker ?? readings[0]?.ticker ?? null;
  const reading = readings.find((r) => r.ticker === active) ?? null;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/history?ticker=${active}${demo ? "&modelled=1" : days === 7 ? "&days=7" : ""}`);
        if (!res.ok) throw new Error();
        const body = (await res.json()) as HistorySeries;
        if (!cancelled) setSeries(body);
      } catch {
        if (!cancelled) setSeries(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, demo, days]);

  const real = series?.source === "market" && series.ticker === active;
  const stats = useMemo(() => {
    if (!real || !series || series.points.length === 0) return null;
    // Hourly median, as the chart's main line: a lone print is not a gap.
    const widest = downsample(series.points).reduce((a, b) => (Math.abs(b.basisBps) > Math.abs(a.basisBps) ? b : a));
    const ctx = reading?.basisBps != null ? gapContext(series.points, reading.basisBps) : null;
    return { widest, ctx };
  }, [real, series, reading?.basisBps]);

  if (!active) return null;

  return (
    <section className="panel mb-5 px-4 pt-3.5 pb-4 sm:px-5" aria-labelledby="gap-history">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="gap-history" className="eyebrow ">
          Gap history · {days === 7 ? "7 days" : "48 hours"}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
        {!demo && (
          <div className="flex rounded-[6px] border border-[var(--border)] p-0.5" role="group" aria-label="Window">
            {([2, 7] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => onDays(d)}
                className={`rounded-[4px] px-2 py-0.5 text-[12px] transition-colors ${
                  days === d ? "bg-[var(--raised)] text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {d === 2 ? "48h" : "7d"}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Pair">
          {readings.map((r) => (
            <button
              key={r.ticker}
              type="button"
              role="tab"
              aria-selected={r.ticker === active}
              onClick={() => onTicker(r.ticker)}
              className={`rounded-[5px] px-2.5 py-1 text-[12px] transition-colors ${
                r.ticker === active
                  ? "bg-[var(--raised)] text-white"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              {r.tokenTicker}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          {series && series.ticker === active ? (
            <BasisChart series={series} days={demo ? 2 : days} />
          ) : (
            <div className="skeleton h-[190px]" aria-label={loading ? "Loading history" : "History unavailable"} />
          )}
        </div>

        <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-4 text-[13px] lg:grid-cols-1">
          <Fact label="Now">
            <span className="display num text-[24px] text-white">{reading?.basisBps != null ? fmtBps(reading.basisBps, 0) : "—"}</span>
            {stats?.ctx && (
              <span className="block text-[12px] text-[var(--text-3)]">
                {stats.ctx.percentile >= 50
                  ? `wider than ${stats.ctx.percentile}% of the window`
                  : `tighter than ${100 - stats.ctx.percentile}% of the window`}
              </span>
            )}
          </Fact>
          <Fact label={`Widest hour in ${days === 7 && !demo ? "7 days" : "48h"}`}>
            {stats ? (
              <>
                <span className="display num text-[24px] text-white">{fmtBps(stats.widest.basisBps, 0)}</span>
                <span className="block text-[12px] text-[var(--text-3)]">
                  {etTime(stats.widest.t)} ET · {PHASE_COPY[stats.widest.phase]}
                </span>
              </>
            ) : (
              <span className="text-[var(--text-3)]">{loading ? "…" : "—"}</span>
            )}
          </Fact>
          <Fact label="Typical gap">
            {stats?.ctx && stats.ctx.typicalOpenBps !== null && stats.ctx.typicalShutBps !== null ? (
              <span className="num text-white">
                {Math.round(stats.ctx.typicalOpenBps)}bps open ·{" "}
                {Math.round(stats.ctx.typicalShutBps)}bps shut
              </span>
            ) : (
              <span className="text-[var(--text-3)]">{loading ? "…" : "—"}</span>
            )}
          </Fact>
          <div className="self-end">
            <button
              type="button"
              onClick={() => onTrade(active)}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--raised)] hover:text-white"
            >
              Open {reading?.tokenTicker ?? active} ticket →
            </button>
          </div>
        </dl>
      </div>

      {!real && series && series.ticker === active && !loading && (
        <p className="mt-3 text-[12px] text-[var(--text-3)]">
          {demo
            ? "Replay: this shape is modelled."
            : "Real history is briefly unavailable (the sources rate-limit), so this is the labelled model."}
        </p>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
