"use client";

import { useMemo, useState } from "react";
import { backtest, type BacktestResult } from "@/lib/backtest";
import { fmtUsd } from "@/lib/format";
import { etTime } from "./GapHistory";
import { useDislocations } from "./useDislocations";

const SIZES = [500, 2_000, 10_000, 50_000] as const;
const EXITS = [
  [30, "+30m"],
  [60, "+1h"],
  [180, "+3h"],
] as const;
const SWEEP = Array.from({ length: 19 }, (_, i) => 20 + i * 10); // 20..200bps

const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}${fmtUsd(Math.abs(v), Math.abs(v) >= 100 ? 0 : 2)}`;
const signedBps = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}bps`;
const tone = (v: number) => (v > 0 ? "var(--down)" : v < 0 ? "var(--up)" : "var(--text-2)");
const sizeLabel = (s: number) => (s >= 1000 ? `$${s / 1000}k` : `$${s}`);

/**
 * "Would trading the gap have paid?" answered on last week's real trades, with
 * the knobs a trader would turn. Runs in the browser from the week the page
 * already loaded, so every change is instant.
 */
export function Backtest({ onTrade }: { onTrade: (ticker: string) => void }) {
  const { rows, failed, missing } = useDislocations();
  const [threshold, setThreshold] = useState(60);
  const [size, setSize] = useState<number>(10_000);
  const [exitAfter, setExitAfter] = useState(60);
  const [showAll, setShowAll] = useState(false);

  const pairs = useMemo(
    () => (rows ?? []).filter((r) => r.week?.length).map((r) => ({ ticker: r.ticker, tokenTicker: r.tokenTicker, week: r.week })),
    [rows],
  );
  const result = useMemo(
    () => (pairs.length ? backtest({ pairs, thresholdBps: threshold, notionalUsd: size, exitAfterMin: exitAfter }) : null),
    [pairs, threshold, size, exitAfter],
  );
  const sweep = useMemo(
    () =>
      pairs.length
        ? SWEEP.map((th) => {
            const r = backtest({ pairs, thresholdBps: th, notionalUsd: size, exitAfterMin: exitAfter });
            return { th, net: r.netGapUsd, n: r.trades.length };
          })
        : [],
    [pairs, size, exitAfter],
  );

  if (failed || !result) return null;
  const best = sweep.filter((s) => s.n > 0).sort((a, b) => b.net - a.net)[0];
  const n = result.trades.length;
  const avgCaptured = n ? result.trades.reduce((s, t) => s + t.capturedBps, 0) / n : 0;
  const shown = showAll ? result.trades : result.trades.slice(-6).reverse();

  return (
    <section id="backtest" className="panel mb-5 overflow-hidden" aria-labelledby="backtest-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <h2 id="backtest-title" className="text-[13px] uppercase tracking-[0.07em] text-[var(--text-3)]">
          Your rule, on last week's trades
        </h2>
        <span className="text-[12px] text-[var(--text-3)]">
          Last week, real trades at 30-min medians · costs modelled, {Math.round(result.costBps)}bps round trip at {sizeLabel(size)}
          {missing > 0 && (
            <span className="text-[var(--warn)]">
              {" "}
              · {pairs.length} of {pairs.length + missing} pairs — history for the rest is rate-limited, reload in a minute
            </span>
          )}
        </span>
      </div>

      {/* The rule, as a sentence you edit. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-[var(--border)] px-4 py-3.5 text-[13px] text-[var(--text-2)] sm:px-5">
        <span>While the market is shut, at a gap of</span>
        <label className="flex items-center gap-2">
          <input
            type="range"
            min={20}
            max={200}
            step={10}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-[120px] accent-[var(--accent)]"
            aria-label="Entry threshold, bps"
          />
          <span className="num w-[52px] text-white">{threshold}bps</span>
        </label>
        <span>trade</span>
        <Segmented options={SIZES.map((s) => [s, sizeLabel(s)] as const)} value={size} onChange={setSize} label="Size" />
        <span>on the side that captures it; unwind at the open</span>
        <Segmented options={EXITS} value={exitAfter} onChange={setExitAfter} label="Exit" />
      </div>

      <div className="grid gap-6 px-4 py-4 sm:px-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Stat label="Trades" value={String(n)} sub={result.pending.length ? `${result.pending.length} waiting for the open` : "one per closure per pair"} />
            <Stat
              label="Beat costs"
              value={n ? `${result.wins} of ${n}` : "—"}
              sub={n ? `avg gap closed ${signedBps(avgCaptured)}` : "no gap reached it"}
            />
            <Stat
              label="If hedged"
              value={n ? signedUsd(result.netGapUsd) : "—"}
              color={n ? tone(result.netGapUsd) : undefined}
              sub="gap captured − costs"
              title="What the gap's movement alone paid, after costs: what a trader able to hedge the share would have kept."
            />
            <Stat
              label="As traded"
              value={n ? signedUsd(result.netTokenUsd) : "—"}
              color={n ? tone(result.netTokenUsd) : undefined}
              sub="token return − costs"
              title="What the token position really did, the share's own move while unhedged included. This is the number a closed-market trade lives with."
            />
          </div>

          <Curve result={result} />

          <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-2)]">{verdict(result, threshold, size, avgCaptured)}</p>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">Net if hedged, by threshold</div>
          <Sweep sweep={sweep} active={threshold} onPick={setThreshold} />
          <div className="mt-1 flex justify-between text-[10px] text-[var(--text-3)]">
            <span>20bps</span>
            <span>threshold</span>
            <span>200bps</span>
          </div>
          {best && (
            <p className="mt-2 text-[12px] text-[var(--text-3)]">
              Best last week: <span className="num text-white">{best.th}bps</span>, {signedUsd(best.net)} over {best.n} trade
              {best.n === 1 ? "" : "s"}. Hindsight, not a forecast — a week is a small sample.
            </p>
          )}
        </div>
      </div>

      {n > 0 && (
        <div className="border-t border-[var(--border)]">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
                <th className="px-4 py-2 text-left font-normal sm:px-5">Trade</th>
                <th className="hidden px-2 py-2 text-left font-normal sm:table-cell">Entered</th>
                <th className="px-2 py-2 text-right font-normal">Gap in → out</th>
                <th className="hidden px-2 py-2 text-right font-normal sm:table-cell">Token return</th>
                <th className="px-4 py-2 text-right font-normal sm:px-5">Net, as traded</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr
                  key={`${t.ticker}${t.entryT}`}
                  className="cursor-pointer border-t border-[var(--border)] transition-colors hover:bg-[var(--raised)]"
                  onClick={() => onTrade(t.ticker)}
                >
                  <td className="px-4 py-2 sm:px-5">
                    <span className="font-medium text-white">{t.side === "buy" ? "Buy" : "Sell"} {t.tokenTicker}</span>
                  </td>
                  <td className="hidden px-2 py-2 text-[var(--text-3)] sm:table-cell">{etTime(t.entryT)} ET</td>
                  <td className="num px-2 py-2 text-right text-[var(--text-2)]">
                    {Math.round(t.entryBps)} → {Math.round(t.exitBps)}
                    <span className="ml-1.5" style={{ color: tone(t.capturedBps) }}>
                      ({signedBps(t.capturedBps)})
                    </span>
                  </td>
                  <td className="num hidden px-2 py-2 text-right sm:table-cell" style={{ color: tone(t.tokenReturnBps) }}>
                    {signedBps(t.tokenReturnBps)}
                  </td>
                  <td className="num px-4 py-2 text-right sm:px-5" style={{ color: tone(t.netTokenUsd) }}>
                    {signedUsd(t.netTokenUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {n > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="w-full border-t border-[var(--border)] py-2 text-[12px] text-[var(--text-3)] transition-colors hover:text-white"
            >
              {showAll ? "Show latest 6" : `Show all ${n} trades`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function verdict(r: BacktestResult, threshold: number, size: number, avgCaptured: number): string {
  const n = r.trades.length;
  if (n === 0) {
    return `No gap reached ${threshold}bps while the market was shut last week. A lower threshold trades more often — and pays the ${Math.round(r.costBps)}bps round trip each time.`;
  }
  const hedged = r.netGapUsd;
  const traded = r.netTokenUsd;
  const lead =
    hedged > 0
      ? `At ${sizeLabel(size)}, trading every shut-market gap over ${threshold}bps would have kept ${signedUsd(hedged)} from the gap alone.`
      : `At ${sizeLabel(size)}, trading every shut-market gap over ${threshold}bps would have lost ${signedUsd(hedged).slice(1)} after costs: gaps closed ${signedBps(avgCaptured)} on average against a ${Math.round(r.costBps)}bps round trip.`;
  const risk =
    Math.sign(traded) !== Math.sign(hedged)
      ? ` Unhedged, the share's own moves turned that into ${signedUsd(traded)} — the risk a closed-market trade carries.`
      : traded >= 0
        ? ` Unhedged, the position made ${signedUsd(traded)}, the share's own moves included.`
        : ` Unhedged, the share's own moves included, it lost ${signedUsd(traded).slice(1)}.`;
  return lead + risk;
}

function Stat({ label, value, sub, color, title }: { label: string; value: string; sub?: string; color?: string; title?: string }) {
  return (
    <div title={title}>
      <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">{label}</div>
      <div className="num mt-1 text-[20px] leading-none" style={{ color: color ?? "white" }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-[var(--text-3)]">{sub}</div>}
    </div>
  );
}

function Segmented<T extends number>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex rounded-[6px] border border-[var(--border)] p-0.5" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-[4px] px-2 py-0.5 text-[12px] transition-colors ${
            value === v ? "bg-[var(--raised)] text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Cumulative P&L at each exit: gap captured (solid) and as traded (faint). */
function Curve({ result }: { result: BacktestResult }) {
  const W = 600;
  const H = 110;
  const pts = result.curve;
  if (pts.length === 0) return <div className="mt-4 h-[110px] rounded-[6px] bg-[var(--raised)] opacity-40" aria-hidden="true" />;
  const t0 = result.trades[0].entryT;
  const t1 = pts[pts.length - 1].t;
  const span = Math.max(t1 - t0, 1);
  const vals = pts.flatMap((p) => [p.gap, p.token, 0]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const range = Math.max(hi - lo, 1);
  const x = (t: number) => ((t - t0) / span) * (W - 8) + 4;
  const y = (v: number) => H - 6 - ((v - lo) / range) * (H - 12);
  const path = (key: "gap" | "token") =>
    `M${x(t0).toFixed(1)},${y(0).toFixed(1)} ` + pts.map((p) => `H${x(p.t).toFixed(1)} V${y(p[key]).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <figure className="m-0 mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[110px] w-full" role="img" aria-label="Cumulative P&L at each exit">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={path("token")} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        <path d={path("gap")} fill="none" stroke={tone(last.gap)} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex gap-4 text-[11px] text-[var(--text-3)]">
        <span style={{ color: tone(last.gap) }}>━ if hedged</span>
        <span>━ as traded</span>
        <span className="ml-auto">cumulative, at each exit</span>
      </figcaption>
    </figure>
  );
}

/** Net if hedged at every threshold; the bar under the slider is lit. Click to try one. */
function Sweep({
  sweep,
  active,
  onPick,
}: {
  sweep: { th: number; net: number; n: number }[];
  active: number;
  onPick: (th: number) => void;
}) {
  const max = Math.max(1, ...sweep.map((s) => Math.abs(s.net)));
  return (
    <div className="mt-3 flex h-[120px] items-stretch gap-[3px]" role="group" aria-label="Net by threshold">
      {sweep.map((s) => {
        const h = (Math.abs(s.net) / max) * 50;
        const on = s.th === active;
        return (
          <button
            key={s.th}
            type="button"
            onClick={() => onPick(s.th)}
            title={`${s.th}bps: ${s.n} trade${s.n === 1 ? "" : "s"}, ${signedUsd(s.net)} if hedged`}
            aria-label={`${s.th}bps threshold`}
            aria-pressed={on}
            className="relative flex-1 rounded-[2px] transition-colors hover:bg-[var(--raised)]"
          >
            <span className="absolute left-0 right-0 top-1/2 h-px bg-[rgba(255,255,255,0.12)]" />
            {s.n > 0 && (
              <span
                className="absolute left-0 right-0 rounded-[1px]"
                style={{
                  height: `${Math.max(h, 1)}%`,
                  ...(s.net >= 0 ? { bottom: "50%" } : { top: "50%" }),
                  background: tone(s.net),
                  opacity: on ? 1 : 0.35,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

const METHOD = [
  [
    "Entry",
    "While the share's market is shut — overnight, weekends, holidays — the first 30-minute median gap at or beyond your threshold. Buy a cheap token; sell a rich one you hold.",
  ],
  [
    "Exit",
    "The first 30-minute median at your chosen time after the 09:30 ET open, once the share trades and the gap has had its chance to close. One trade per closure per pair.",
  ],
  [
    "Costs",
    "The same round-trip model the ticket starts from: swap fees on both legs, price impact and network cost at your size. The live ticket replaces impact with a real Jupiter quote.",
  ],
  [
    "Two answers",
    "If hedged: how far the gap itself moved, minus costs. As traded: what the token really returned, the share's own move included — the risk a closed-market trade carries.",
  ],
] as const;

/** How the backtest decides, stated plainly enough to disagree with. */
export function BacktestMethod() {
  return (
    <section className="mb-5" aria-labelledby="backtest-method">
      <h2 id="backtest-method" className="mb-3 text-[13px] uppercase tracking-[0.07em] text-[var(--text-3)]">
        How the backtest works
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {METHOD.map(([title, body], i) => (
          <div key={title} className="panel px-4 py-3.5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-white">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-strong)] text-[11px] text-[var(--text-3)]">
                {i + 1}
              </span>
              {title}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-3)]">{body}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-[var(--text-3)]">
        Real prices: the token's deepest pool (GeckoTerminal, 15-minute candles) against the share's last exchange print
        (pre- and post-market included). A week is a small sample; past gaps are not a forecast.
      </p>
    </section>
  );
}
