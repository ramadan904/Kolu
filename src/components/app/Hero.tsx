"use client";

import { useEffect, useMemo, useState } from "react";
import type { BasisReading } from "@/lib/basis/compute";
import { NOISE_MULTIPLE } from "@/lib/basis/compute";
import { computeEdge } from "@/lib/basis/edge";
import type { HistoryPoint, HistorySeries } from "@/lib/history";
import { rollingMedian } from "@/lib/data/market-history";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { fmtPct, fmtUsd } from "@/lib/format";
import { SESSION_COPY, timeUntilClose, type MarketSession } from "@/lib/market/session";
import { useCountUp } from "./useFlash";

/**
 * The first three seconds. One pair, one number, drawn big enough to read from
 * across the room — and, beside it, the evidence: the two prices the gap sits
 * between, and the pair's last 48 hours of real gap.
 */
export function Hero({
  reading,
  hedgeable,
  session,
  delayed = 0,
  onTrade,
  breakevenBps,
  armedAtBreakeven = 0,
  pairs = 0,
  signals = 0,
  closest = null,
  asOf = null,
  onArmBreakeven,
  onReplay,
}: {
  reading: BasisReading | null;
  hedgeable: boolean;
  session: MarketSession;
  /** Pairs flagged `degraded_feed`: excluded from the headline, never "in line". */
  delayed?: number;
  onTrade: (ticker: string) => void;
  /** Gross gap a $10k clip needs to cover costs — the level worth being told about. */
  breakevenBps?: number;
  armedAtBreakeven?: number;
  pairs?: number;
  /** Pairs whose gap is outside the noise floor right now. */
  signals?: number;
  /** On a quiet board, the pair nearest to a real gap: the card shows its evidence instead. */
  closest?: BasisReading | null;
  /** Set while replaying a past moment: the headline must not claim to be live. */
  asOf?: string | null;
  onArmBreakeven?: () => void;
  /** Replays a modelled dislocation, for a board with nothing to show. */
  onReplay?: () => void;
}) {
  const replayButton = (label: string) =>
    onReplay ? (
      <button
        type="button"
        onClick={onReplay}
        className="group mt-5 inline-flex items-center gap-1.5 text-[13px] text-[var(--accent-hover)] transition-colors hover:text-white"
      >
        {label}
        <span className="transition-transform group-hover:translate-x-0.5">→</span>
      </button>
    ) : null;
  const replayPrimary = onReplay ? (
    <Button size="lg" onClick={onReplay} className="min-w-[260px]">
      Replay a real dislocation
      <span aria-hidden="true">→</span>
    </Button>
  ) : null;
  const armAction =
    onArmBreakeven && breakevenBps ? (
      pairs > 0 && armedAtBreakeven >= pairs ? (
        <p className="mt-5 flex items-center gap-2 text-[13px] text-[var(--down)]">
          <span className="live-ring inline-block h-1.5 w-1.5 rounded-full bg-[var(--down)] text-[var(--down)]" />
          Watching all {pairs} pairs — alerted the moment a gap passes {breakevenBps}bps.
        </p>
      ) : (
        <Button size="lg" variant="secondary" onClick={onArmBreakeven}>
          Alert me when a gap pays
        </Button>
      )
    ) : null;

  if (!reading || reading.basisBps === null || reading.equity === null || reading.token === null) {
    const closesIn = timeUntilClose(session);
    const stalled = session.isRegularHours && delayed > 0;
    return (
      <section className="relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-12">
        <div className="rise min-w-0">
        <span className="eyebrow">
          {stalled ? "Market open · reference delayed" : session.isRegularHours ? "Market open · tracking tight" : "Nothing dislocated"}
        </span>
        <h1 className="display text-electric mt-5 text-[52px] leading-[0.95] sm:text-[84px]">
          {stalled ? "No clean read" : session.isRegularHours ? "Priced in line" : "All within noise"}
        </h1>
        <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-[var(--text-2)]">
          {stalled ? (
            <>
              {delayed === 1 ? "One real-share price has" : `${delayed} real-share prices have`} not ticked in over two
              minutes, so Kolu will not call a gap on {delayed === 1 ? "it" : "them"}.{" "}
              {closesIn && <span className="text-white">After-hours gaps open when the market closes, in {closesIn}.</span>}
            </>
          ) : session.isRegularHours ? (
            <>
              Every tokenized stock is tracking its real share to within the noise floor — anyone can hedge, so nobody
              leaves a gap.{" "}
              {closesIn && <span className="text-white">The interesting part starts when it closes, in {closesIn}.</span>}
            </>
          ) : (
            "Nothing is trading far enough from its real share to be worth the fees. Gaps tend to open as the session ages."
          )}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {replayPrimary}
          {armAction}
        </div>
        <p className="mono mt-3 text-[11px] text-[var(--text-3)]">
          Quiet is the normal state — the replay rebuilds the board from the widest real gap of the week.
        </p>
        </div>
        {closest && closest.basisBps !== null && (
          <SignalCard
            reading={closest}
            netBps={computeEdge({ basisBps: closest.basisBps, notionalUsd: 10_000, hedgeable }).netBps}
            hedgeable={hedgeable}
            session={session}
            pairs={pairs}
            signals={signals}
            title="closest to a gap"
          />
        )}
      </section>
    );
  }

  return (
    <Dislocation
      reading={reading}
      hedgeable={hedgeable}
      session={session}
      onTrade={onTrade}
      asOf={asOf}
      replayAction={
        onReplay ? (
          <Button size="lg" variant="secondary" onClick={onReplay}>
            Replay a real dislocation
          </Button>
        ) : null
      }
      armAction={armAction}
      replay={replayButton("Nothing pays yet — replay the widest real gap of the week")}
      breakevenBps={breakevenBps}
      pairs={pairs}
      signals={signals}
    />
  );
}

function Dislocation({
  reading,
  hedgeable,
  session,
  onTrade,
  asOf,
  replayAction,
  armAction,
  replay,
  breakevenBps,
  pairs,
  signals,
}: {
  reading: BasisReading;
  hedgeable: boolean;
  session: MarketSession;
  onTrade: (ticker: string) => void;
  asOf: string | null;
  replayAction: React.ReactNode;
  armAction: React.ReactNode;
  replay: React.ReactNode;
  breakevenBps?: number;
  pairs: number;
  signals: number;
}) {
  const bps = reading.basisBps!;
  const discount = bps < 0;
  const shown = useCountUp(bps);
  const gapUsd = Math.abs(reading.basisUsd ?? 0);
  const edge = computeEdge({ basisBps: bps, notionalUsd: 10_000, hedgeable });
  const pays = edge.netBps > 0;

  return (
    <section className="relative grid gap-10 py-12 sm:py-14 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-12">
      <div className="rise min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow">Widest dislocation · {asOf ? `${asOf} ET` : "live"}</span>
          <Badge tone={discount ? "down" : "up"}>{discount ? "▼ Trading cheap" : "▲ Trading rich"}</Badge>
        </div>

        <h1 className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <span className="display text-electric text-[64px] leading-[0.88] sm:text-[104px]">{reading.tokenTicker}</span>
          <span className={`display num text-[52px] leading-[0.88] sm:text-[84px] ${discount ? "text-cheap" : "text-rich"}`}>
            {fmtPct(shown)}
          </span>
        </h1>

        <SpreadGauge
          token={reading.token!.price}
          share={reading.equity!.price}
          name={reading.name}
          tokenTicker={reading.tokenTicker}
          bps={bps}
        />

        <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-[var(--text-2)]">
          {reading.tokenTicker} is trading <span className="num text-white">{fmtUsd(gapUsd)}</span>{" "}
          {discount ? "below" : "above"} the real {reading.name} share.{" "}
          {!pays
            ? `On a $10k clip, fees and slippage outweigh it by about ${Math.round(-edge.netBps)}bps — watch it, don't trade it yet.`
            : hedgeable
              ? `About ${Math.round(edge.netBps)}bps survives fees and slippage on a $10k clip.`
              : `Worth about ${fmtUsd(edge.netUsd)} on a $10k position if it converges at the open.`}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => onTrade(reading.ticker)} className="min-w-[180px]">
            Trade {reading.tokenTicker}
            <span aria-hidden="true">→</span>
          </Button>
          {!pays && replayAction}
        </div>
        {!pays && <div className="mt-3 flex flex-wrap items-center gap-3">{armAction}</div>}
        {!pays && breakevenBps && (
          <p className="mono mt-3 text-[11px] text-[var(--text-3)]">
            Alerts arm every pair at {breakevenBps}bps — where a $10k trade starts to clear fees and impact.
          </p>
        )}

      </div>

      <SignalCard
        reading={reading}
        netBps={edge.netBps}
        hedgeable={hedgeable}
        session={session}
        pairs={pairs}
        signals={signals}
      />
    </section>
  );
}

/**
 * The gap as a physical distance: the token's price and the real share's,
 * with the gap drawn between them in its direction's colour.
 */
function SpreadGauge({
  token,
  share,
  name,
  tokenTicker,
  bps,
}: {
  token: number;
  share: number;
  name: string;
  tokenTicker: string;
  bps: number;
}) {
  const discount = bps < 0;
  const color = discount ? "var(--down)" : "var(--up)";
  const color2 = discount ? "var(--down-2)" : "var(--up-2)";
  // Token on the side it sits: left when cheaper than the share.
  const left = discount ? { label: tokenTicker, price: token } : { label: `${name} share`, price: share };
  const right = discount ? { label: `${name} share`, price: share } : { label: tokenTicker, price: token };
  return (
    <div className="mt-7 max-w-xl">
      <div className="flex items-end justify-between gap-4">
        <PriceEnd label={left.label} price={left.price} />
        <PriceEnd label={right.label} price={right.price} align="right" />
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="sweep absolute inset-y-0 left-[6%] right-[6%] overflow-hidden rounded-full"
          style={{
            background: `linear-gradient(90deg, ${color}, ${color2})`,
            boxShadow: `0 0 18px ${color}`,
          }}
        />
        <span className="absolute left-[6%] top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded bg-white" />
        <span className="absolute right-[6%] top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded bg-white" />
      </div>
      <div className="mono mt-2 text-center text-[11px] text-[var(--text-3)]">
        gap <span style={{ color }}>{fmtUsd(Math.abs(token - share))}</span> · {Math.abs(Math.round(bps))}bps
      </div>
    </div>
  );
}

function PriceEnd({ label, price, align = "left" }: { label: string; price: number; align?: "left" | "right" }) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)]">{label}</div>
      <div className="num mt-1 text-[22px] font-medium tracking-[-0.02em] text-white">{fmtUsd(price)}</div>
    </div>
  );
}

/** The evidence card: the pair's real 48h gap, and the three facts that decide a trade. */
function SignalCard({
  reading,
  netBps,
  hedgeable,
  session,
  pairs,
  signals,
  title,
}: {
  reading: BasisReading;
  netBps: number;
  /** Replaces "48h gap" in the header, e.g. on a quiet board. */
  title?: string;
  hedgeable: boolean;
  session: MarketSession;
  pairs: number;
  signals: number;
}) {
  const [series, setSeries] = useState<HistorySeries | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/history?ticker=${reading.ticker}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: HistorySeries | null) => !cancelled && setSeries(body))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reading.ticker]);

  const noise = reading.confidenceBps !== null ? reading.confidenceBps * NOISE_MULTIPLE : null;
  const next = session.nextPhase && session.minutesToNextPhase !== null
    ? `${SESSION_COPY[session.nextPhase].toLowerCase()} in ${fmtMinutes(session.minutesToNextPhase)}`
    : null;

  return (
    <aside className="rise glass relative overflow-hidden rounded-[16px] p-5" style={{ animationDelay: "120ms" }}>
      <div className="flex items-center justify-between">
        <span className="mono flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-2)]">
          <span className="live-ring inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-2)] text-[var(--accent-2)]" />
          {reading.tokenTicker} · {title ?? "48h gap"}
        </span>
        <span className="mono text-[11px] text-[var(--text-3)]">
          {series?.source === "market" ? "48h · real trades" : series ? "48h · modelled" : "loading"}
        </span>
      </div>
      {title && (
        <div className="mt-3 flex items-baseline gap-3">
          <span className={`display num text-[40px] leading-none ${(reading.basisBps ?? 0) < 0 ? "text-cheap" : "text-rich"}`}>
            {fmtPct(reading.basisBps ?? 0)}
          </span>
          <span className="text-[12px] text-[var(--text-3)]">vs the real {reading.name} share</span>
        </div>
      )}
      <MiniChart points={series?.points ?? null} real={series?.source === "market"} discount={(reading.basisBps ?? 0) < 0} />
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
        <Fact label="Net at $10k" value={`${netBps > 0 ? "+" : "−"}${Math.abs(Math.round(netBps))}bps`} color={netBps > 0 ? "var(--down)" : "var(--text-2)"} />
        <Fact label="Noise floor" value={noise !== null ? `±${noise.toFixed(0)}bps` : "—"} />
        <Fact label="Hedgeable" value={hedgeable ? "Yes" : "No"} color={hedgeable ? "var(--down)" : "var(--warn)"} />
      </dl>
      <div className="mono mt-4 flex items-center justify-between text-[11px] text-[var(--text-3)]">
        <span>
          <span className="text-white">{signals}</span> of {pairs} pairs outside noise
        </span>
        {next && <span>{next}</span>}
      </div>
    </aside>
  );
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

function Fact({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <dt className="mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-3)]">{label}</dt>
      <dd className="num mt-1 text-[18px] font-medium tracking-[-0.02em]" style={{ color: color ?? "white" }}>
        {value}
      </dd>
    </div>
  );
}

/** 48 hours in 140px: hourly median gap as a lit area, closed-market hours shaded, now as a glowing point. */
function MiniChart({ points, real, discount }: { points: HistoryPoint[] | null; real: boolean; discount: boolean }) {
  const W = 400;
  const H = 140;
  const data = useMemo(() => (points && points.length > 1 ? (real ? rollingMedian(points, 4) : points) : null), [points, real]);
  if (!data) return <div className="skeleton mt-4 h-[140px]" />;
  const t0 = data[0].t;
  const span = Math.max(data[data.length - 1].t - t0, 1);
  const vals = data.map((p) => p.basisBps);
  const lim = Math.max(30, ...vals.map(Math.abs)) * 1.15;
  const x = (t: number) => ((t - t0) / span) * W;
  const y = (b: number) => H / 2 - (b / lim) * (H / 2);
  const line = data.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.basisBps).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H / 2} L0,${H / 2} Z`;
  const shut: { a: number; b: number }[] = [];
  let s: number | null = null;
  data.forEach((p, i) => {
    const closed = p.phase === "closed" || p.phase === "weekend" || p.phase === "holiday";
    if (closed && s === null) s = p.t;
    if (s !== null && (!closed || i === data.length - 1)) {
      shut.push({ a: x(s), b: x(p.t) });
      s = null;
    }
  });
  const last = data[data.length - 1];
  const color = discount ? "#19d18f" : "#ff4d6a";
  const id = discount ? "mc-cheap" : "mc-rich";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-[140px] w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Gap over the last 48 hours">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="50%" stopColor={color} stopOpacity="0.02" />
          <stop offset="100%" stopColor={color} stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {shut.map((b, i) => (
        <rect key={i} x={b.a} y={0} width={Math.max(b.b - b.a, 1)} height={H} fill="rgba(255,255,255,0.022)" />
      ))}
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.14)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeDasharray={real ? undefined : "4 3"}
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
      <circle cx={x(last.t)} cy={y(last.basisBps)} r={3.5} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
    </svg>
  );
}
