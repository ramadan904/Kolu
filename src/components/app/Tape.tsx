"use client";

import type { BasisReading } from "@/lib/basis/compute";
import { fmtPct } from "@/lib/format";
import { useFlash } from "./useFlash";

/**
 * Every pair's live gap, scrolling. Pauses under the pointer; each item opens
 * its ticket. The fastest possible answer to "is anything moving?".
 */
export function Tape({ readings, onSelect }: { readings: BasisReading[]; onSelect: (ticker: string) => void }) {
  const items = readings.filter((r) => r.basisBps !== null && r.token);
  if (items.length === 0) return null;
  // Two identical halves, so translating by half loops seamlessly.
  const half = (copy: number) =>
    items.map((r) => <TapeItem key={`${copy}-${r.ticker}`} reading={r} onSelect={onSelect} hidden={copy === 1} />);
  return (
    <div className="tape relative -mx-1 overflow-hidden border-y border-[var(--border)] py-2" aria-label="Live gaps">
      <div
        className="tape-track flex w-max"
        style={{ ["--tape-duration" as string]: `${Math.max(28, items.length * 7)}s` }}
      >
        <div className="flex shrink-0">{half(0)}</div>
        <div className="flex shrink-0" aria-hidden="true">
          {half(1)}
        </div>
      </div>
    </div>
  );
}

function TapeItem({
  reading: r,
  onSelect,
  hidden,
}: {
  reading: BasisReading;
  onSelect: (ticker: string) => void;
  hidden: boolean;
}) {
  const flash = useFlash(r.token?.price);
  const bps = r.basisBps ?? 0;
  const noise = r.signal === "noise" || r.signal === "degraded_feed";
  const color = noise ? "var(--text-2)" : bps < 0 ? "var(--down)" : "var(--up)";
  return (
    <button
      type="button"
      tabIndex={hidden ? -1 : 0}
      onClick={() => onSelect(r.ticker)}
      className="mono group flex shrink-0 items-center gap-2.5 border-r border-[var(--border)] px-5 text-[12px] transition-colors hover:bg-white/[0.03]"
    >
      <span className="font-medium text-white">{r.tokenTicker}</span>
      <span className={`num rounded px-1 text-[var(--text-2)] ${flash}`}>${r.token!.price.toFixed(2)}</span>
      <span className="num" style={{ color }}>
        {bps < 0 ? "▼" : bps > 0 ? "▲" : "■"} {fmtPct(bps)}
      </span>
    </button>
  );
}
