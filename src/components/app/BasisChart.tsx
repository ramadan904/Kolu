"use client";

import { useMemo, useRef, useState } from "react";
import type { HistoryPoint, HistorySeries } from "@/lib/history";
import { basisDomain } from "@/lib/chart-scale";
import { fmtBps } from "@/lib/format";
import { SESSION_COPY } from "@/lib/market/session";

const W = 720;
const H = 168;
const PAD = { top: 10, right: 8, bottom: 18, left: 38 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const SHUT = new Set(["closed", "weekend", "holiday"]);

/**
 * Basis over 48 hours, with the closed-market periods shaded.
 *
 * The shading is the argument, not decoration: the gap sits pinned near zero
 * while the underlying can be traded, opens once it cannot, and collapses at
 * the next open.
 */
export function BasisChart({ series }: { series: HistorySeries }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const pts = series.points;
    if (pts.length < 2) return null;

    const t0 = pts[0].t;
    const span = Math.max(pts[pts.length - 1].t - t0, 1);
    const dom = basisDomain(pts.map((p) => p.basisBps));
    const range = Math.max(dom.max - dom.min, 1);

    const x = (t: number) => PAD.left + ((t - t0) / span) * PLOT_W;
    const y = (b: number) => PAD.top + PLOT_H - ((b - dom.min) / range) * PLOT_H;

    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.basisBps).toFixed(1)}`)
      .join(" ");

    const bands: { x0: number; x1: number }[] = [];
    let start: HistoryPoint | null = null;
    pts.forEach((p, i) => {
      const shut = SHUT.has(p.phase);
      if (shut && !start) start = p;
      const last = i === pts.length - 1;
      if (start && (!shut || last)) {
        const end = shut && last ? p : (pts[i - 1] ?? p);
        if (end.t > start.t) bands.push({ x0: x(start.t), x1: x(end.t) });
        start = null;
      }
    });

    return { pts, x, y, line, bands, dom };
  }, [series.points]);

  if (!model) {
    return (
      <div className="flex h-[168px] items-center justify-center rounded-[var(--radius)] bg-[var(--raised)]">
        <p className="text-[13px] text-[var(--text-3)]">
          Collecting history — nothing is invented to fill it.
        </p>
      </div>
    );
  }

  const { pts, x, y, line, bands, dom } = model;
  const last = pts[pts.length - 1];
  const stroke = last.basisBps < 0 ? "var(--down)" : "var(--up)";
  const active = hover === null ? null : pts[hover];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t0 = pts[0].t;
    const span = pts[pts.length - 1].t - t0;
    const target = t0 + ((px - PAD.left) / PLOT_W) * span;

    let nearest = 0;
    let best = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.t - target);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setHover(nearest);
  };

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
          48 hours · shaded when the market was shut
        </span>
        <span className="num text-[12px] text-[var(--text-2)]" aria-live="polite">
          {active
            ? `${new Date(active.t).toLocaleString("en-US", {
                timeZone: "America/New_York",
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })} ET · ${fmtBps(active.basisBps, 1)} · ${SESSION_COPY[active.phase]}`
            : series.synthetic
              ? "Modelled history"
              : ""}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Basis over 48 hours, currently ${fmtBps(last.basisBps, 1)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {bands.map((b, i) => (
          <rect
            key={i}
            x={b.x0}
            y={PAD.top}
            width={Math.max(b.x1 - b.x0, 1)}
            height={PLOT_H}
            fill="rgba(255,255,255,0.028)"
          />
        ))}

        {[...new Set([dom.max, 0, dom.min])].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.05)"}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.left - 7}
              y={y(v) + 3}
              textAnchor="end"
              fontSize={9.5}
              fill="#5c5c66"
              className="num"
            >
              {v === 0 ? "0" : Math.round(v)}
            </text>
          </g>
        ))}

        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {active && (
          <g>
            <line
              x1={x(active.t)}
              x2={x(active.t)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="rgba(255,255,255,0.22)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={x(active.t)}
              cy={y(active.basisBps)}
              r={3.5}
              fill={active.basisBps < 0 ? "var(--down)" : "var(--up)"}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
    </figure>
  );
}
