"use client";

import { NARROWED_PCT, type OpenEvent } from "@/lib/data/market-history";
import { etDay as day } from "./GapHistory";
import { useDislocations } from "./useDislocations";

const medianOf = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The test of the thesis, not the picture of it. If a token drifts only
 * because its reference is shut, the gap should shrink once the share trades
 * again. Each open in the last week, per pair: the gap in the hour before
 * 09:30 ET against the gap 30-90 minutes in. It usually narrows — not always,
 * and the misses are shown, because "it converges by the open" is the bet a
 * closed-market trade is making.
 */
export function OpenConvergence({ onSelect }: { onSelect: (ticker: string) => void }) {
  const { rows, failed } = useDislocations();
  if (failed || rows === null) return null;
  const all = rows.flatMap((r) => r.opens);
  if (all.length === 0) return null;

  const narrowed = all.filter((e) => e.closedPct >= NARROWED_PCT).length;
  const typical = medianOf(all.map((e) => e.closedPct));

  return (
    <section className="panel mb-5 overflow-hidden" aria-labelledby="open-convergence">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3 sm:px-5">
        <h2 id="open-convergence" className="eyebrow ">
          Does the gap close at the open?
        </h2>
        <span className="text-[12px] text-[var(--text-3)]">
          Last week, real trades · the hour before 09:30 ET vs 30–90 min after
        </span>
      </div>

      <div className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[260px_1fr]">
        <div>
          <p className="display num text-electric text-[52px] leading-none">
            {narrowed} <span className="text-[18px] text-[var(--text-3)]">of {all.length}</span>
          </p>
          <p className="mt-2 text-[13px] text-[var(--text-2)]">
            opens took at least a quarter off the gap
            {typical !== null && (
              <>
                ; the typical open closed <span className="num text-white">{Math.max(0, Math.round(typical))}%</span>{" "}
                of it within the first hour
              </>
            )}
            .
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-3)]">
            {narrowed / all.length > 0.6
              ? "Usually, not always."
              : narrowed / all.length >= 0.4
                ? "About half the time."
                : "Less often than the thesis assumes."} Placing a trade
            while the market is shut is a bet on this, not an arbitrage: the other opens held or widened.
            Opens with a gap inside the noise are left out.
          </p>
        </div>

        <ul className="min-w-0">
          {rows.map((r) => (
            <li key={r.ticker} className="border-b border-[var(--border)] last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(r.ticker)}
                className="grid w-full grid-cols-[80px_1fr] items-center gap-x-4 gap-y-2 px-2 py-2.5 text-left transition-colors hover:bg-[var(--raised)] sm:grid-cols-[80px_1fr_150px]"
              >
                <span className="text-[14px] font-medium">{r.tokenTicker}</span>
                <span className="flex flex-wrap gap-1.5">
                  {r.opens.length === 0 ? (
                    <span className="text-[12px] text-[var(--text-3)]">No open with a gap outside the noise</span>
                  ) : (
                    r.opens.map((e) => <OpenChip key={e.t} e={e} />)
                  )}
                </span>
                <span className="col-span-2 text-[12px] text-[var(--text-3)] sm:col-span-1 sm:text-right">
                  {r.opens.length > 0 &&
                    `narrowed ${r.opens.filter((e) => e.closedPct >= NARROWED_PCT).length} of ${r.opens.length}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function OpenChip({ e }: { e: OpenEvent }) {
  const closed = e.closedPct >= NARROWED_PCT;
  const flipped = Math.sign(e.beforeBps) !== Math.sign(e.afterBps) && Math.abs(e.afterBps) >= 5;
  const verdict = closed ? `${Math.min(100, e.closedPct)}% closed` : e.closedPct < 0 ? "widened" : "held";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[5px] border px-2 py-1 text-[12px] ${
        closed ? "border-[var(--border-strong)] text-[var(--text-2)]" : "border-[var(--border)] text-[var(--text-3)]"
      }`}
      title={`${day(e.t)}: ${Math.round(e.beforeBps)}bps before the open, ${Math.round(e.afterBps)}bps an hour in${
        flipped ? " — crossed fair value" : ""
      }`}
    >
      <span className="text-[var(--text-3)]">{day(e.t)}</span>
      <span className="num">
        {Math.round(Math.abs(e.beforeBps))}→{Math.round(Math.abs(e.afterBps))}
      </span>
      <span style={{ color: closed ? "var(--down)" : undefined }}>{verdict}</span>
    </span>
  );
}
