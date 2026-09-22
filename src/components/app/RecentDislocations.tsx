"use client";

import type { Dislocation } from "@/app/api/dislocations/route";
import { fmtBps } from "@/lib/format";
import { etTime, PHASE_COPY } from "./GapHistory";
import { useDislocations } from "./useDislocations";

/**
 * The widest real gap each liquid pair showed in the last two days — when it
 * happened, in which session, and whether it would have paid. The honest
 * version of a "top movers" list: most rows say it would not have.
 */
export function RecentDislocations({ onSelect }: { onSelect: (ticker: string) => void }) {
  const { rows, breakevenBps: breakeven, failed } = useDislocations();

  return (
    <section className="panel mb-5 overflow-hidden" aria-labelledby="recent-dislocations">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <h2 id="recent-dislocations" className="eyebrow ">
          Recent dislocations
        </h2>
        <span className="text-[12px] text-[var(--text-3)]">
          Widest real gap per pair, hourly median, last 48h
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
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 border-b border-[var(--border)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--raised)] sm:grid-cols-[120px_1fr_150px_340px] sm:px-5"
                >
                  <span>
                    <span className="text-[14px] font-medium">{r.tokenTicker}</span>
                    <span className="ml-2 text-[12px] text-[var(--text-3)] sm:hidden">{r.name}</span>
                  </span>
                  <span className="hidden sm:block">
                    <Spark row={r} />
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

/**
 * The pair's 48h in 32px: hourly median gap, shut hours shaded, the widest
 * moment marked. Every row shares a scale, so the rows compare at a glance.
 */
function Spark({ row }: { row: Dislocation }) {
  const W = 320;
  const H = 32;
  const pts = row.spark;
  if (pts.length < 2) return null;
  const t0 = pts[0][0];
  const span = Math.max(pts[pts.length - 1][0] - t0, 1);
  const lim = Math.max(40, ...pts.map((p) => Math.abs(p[1])));
  const x = (t: number) => ((t - t0) / span) * W;
  const y = (b: number) => H / 2 - (b / lim) * (H / 2 - 2);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const shut: { x0: number; x1: number }[] = [];
  let start: number | null = null;
  pts.forEach((p, i) => {
    if (p[2] && start === null) start = p[0];
    if (start !== null && (!p[2] || i === pts.length - 1)) {
      shut.push({ x0: x(start), x1: x(p[0]) });
      start = null;
    }
  });
  const peak = pts.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
  const color = row.basisBps > 0 ? "var(--up)" : "var(--down)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      {shut.map((b, i) => (
        <rect key={i} x={b.x0} y={0} width={Math.max(b.x1 - b.x0, 1)} height={H} fill="rgba(255,255,255,0.035)" />
      ))}
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.1)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(peak[0])} cy={y(peak[1])} r={2.5} fill={color} />
    </svg>
  );
}
