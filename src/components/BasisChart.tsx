"use client";

import { useMemo, useRef, useState } from "react";
import type { HistoryPoint, HistorySeries } from "@/lib/history";
import { niceDomain } from "@/lib/chart-scale";
import { fmtBps } from "@/lib/format";
import { SESSION_COPY } from "@/lib/market/session";

const W = 800;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 22, left: 44 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** Phases where no US venue is quoting — the shaded regions on the chart. */
const SHUT = new Set(["closed", "weekend", "holiday"]);

interface Band {
  x0: number;
  x1: number;
  label: string;
}

/**
 * Basis over time, with the closed-market periods shaded.
 *
 * The shading is the point of the chart, not decoration: it shows the gap
 * opening while the underlying cannot be traded and collapsing once it can.
 * A line alone would show the same numbers and none of the mechanism.
 *
 * One series, so no legend — the heading names it. Grid and axes stay
 * recessive; the value is read from the crosshair, not from a label on every
 * point.
 */
export function BasisChart({ series }: { series: HistorySeries }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { points, x, y, path, bands, domain } = useMemo(() => {
    const pts = series.points;
    if (pts.length < 2) {
      return { points: pts, x: () => 0, y: () => 0, path: "", bands: [], domain: 0 };
    }

    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const span = Math.max(t1 - t0, 1);
    const maxAbs = Math.max(25, ...pts.map((p) => Math.abs(p.basisBps)));
    const dom = niceDomain(maxAbs * 1.08);

    const xOf = (t: number) => PAD.left + ((t - t0) / span) * PLOT_W;
    const yOf = (bps: number) => PAD.top + PLOT_H / 2 - (bps / dom) * (PLOT_H / 2);

    const d = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t).toFixed(2)},${yOf(p.basisBps).toFixed(2)}`)
      .join(" ");

    // Contiguous runs where the market was shut.
    const bandList: Band[] = [];
    let runStart: HistoryPoint | null = null;
    pts.forEach((p, i) => {
      const shut = SHUT.has(p.phase);
      if (shut && !runStart) runStart = p;
      const isLast = i === pts.length - 1;
      if (runStart && (!shut || isLast)) {
        const end = shut && isLast ? p : pts[i - 1] ?? p;
        if (end.t > runStart.t) {
          bandList.push({
            x0: xOf(runStart.t),
            x1: xOf(end.t),
            label: SESSION_COPY[runStart.phase],
          });
        }
        runStart = null;
      }
    });

    return { points: pts, x: xOf, y: yOf, path: d, bands: bandList, domain: dom };
  }, [series.points]);

  if (points.length < 2) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Collecting history — the chart appears once a few samples are in. Nothing
        is invented to fill it.
      </p>
    );
  }

  const active = hover === null ? null : points[hover];

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const t0 = points[0].t;
    const span = points[points.length - 1].t - t0;
    const target = t0 + ((px - PAD.left) / PLOT_W) * span;

    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const dist = Math.abs(points[i].t - target);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    }
    setHover(nearest);
  };

  const ticks = [domain, domain / 2, 0, -domain / 2, -domain];

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{series.ticker}X basis, last 48h</span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          shaded = underlying market shut
          {series.synthetic &&
            ` · modelled history (demo), ${series.observedMinutes}m observed`}
        </span>
      </figcaption>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ height: "auto" }}
        role="img"
        aria-label={`${series.ticker} basis over the last 48 hours, currently ${fmtBps(points[points.length - 1].basisBps, 1)}`}
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
            fill="var(--neutral-mid)"
            opacity={0.55}
          />
        ))}

        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(value)}
              y2={y(value)}
              stroke={value === 0 ? "var(--baseline)" : "var(--gridline)"}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.left - 8}
              y={y(value) + 3.5}
              textAnchor="end"
              fontSize={10}
              fill="var(--text-muted)"
              className="tnum"
            >
              {value === 0 ? "0" : Math.round(value)}
            </text>
          </g>
        ))}

        <path
          d={path}
          fill="none"
          stroke={points[points.length - 1].basisBps >= 0 ? "var(--premium)" : "var(--discount)"}
          strokeWidth={2}
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
              stroke="var(--text-muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={x(active.t)}
              cy={y(active.basisBps)}
              r={4.5}
              fill={active.basisBps >= 0 ? "var(--premium)" : "var(--discount)"}
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          </g>
        )}

        <text x={PAD.left} y={H - 6} fontSize={10} fill="var(--text-muted)">
          {new Date(points[0].t).toLocaleString("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
            hour: "2-digit",
            hour12: false,
          })}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="var(--text-muted)">
          now
        </text>
      </svg>

      <div
        className="mt-1 h-5 text-xs tnum"
        style={{ color: active ? "var(--text-secondary)" : "var(--text-muted)" }}
        aria-live="polite"
      >
        {active ? (
          <>
            {new Date(active.t).toLocaleString("en-US", {
              timeZone: "America/New_York",
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}{" "}
            ET · {fmtBps(active.basisBps, 1)} · {SESSION_COPY[active.phase]}
          </>
        ) : (
          "Hover the chart for a reading."
        )}
      </div>
    </figure>
  );
}
