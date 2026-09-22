"use client";

import { NOISE_MULTIPLE, type BasisReading } from "@/lib/basis/compute";
import { fmtPct } from "@/lib/format";

/**
 * Every tracked pair on one basis axis.
 *
 * The table answers "what is each pair doing"; it cannot answer "is this one
 * unusual". A 40bps discount means nothing on its own — it is either the
 * widest thing on the board or the fourth-widest of twelve, and those are
 * different trades. Putting all twelve on a shared axis makes the outlier the
 * thing your eye lands on, which is the entire job of this screen.
 *
 * The shaded centre is the noise floor: gaps inside it are smaller than the
 * feeds' own confidence and are not claims about the world.
 */

/**
 * Label rows available. A calm board clusters every ticker around zero, which
 * is exactly when a fixed three rows ran out and labels printed over each
 * other; the plot grows only as tall as the rows actually used.
 */
const MAX_ROWS = 6;
const MIN_ROWS = 3;
/** Percent of the axis width a label needs before it collides with its neighbour. */
const LABEL_WIDTH_PCT = 9;
/** Vertical gap between label rows. Must clear the label's own line box. */
const ROW_GAP_PX = 20;
/** Shortest stick, drawn for the bottom row. */
const BASE_STICK_PX = 22;
/** Width of the invisible hit area around each tick. */
const HIT_PX = 20;
/** Room above the axis line for the tallest stick plus its label. */
const plotPx = (rows: number) => BASE_STICK_PX + (rows - 1) * ROW_GAP_PX + 18;
/** Room below the axis line for the −/fair/+ scale labels. */
const SCALE_PX = 22;

interface Placed {
  reading: BasisReading;
  basisBps: number;
  x: number;
  row: number;
}

/**
 * Labels are laid out left to right, each dropping to the next row only when
 * it would overlap the last one placed on the row above. Twelve tickers on a
 * quiet board cluster hard around zero, so a single row would be unreadable.
 */
function place(readings: BasisReading[], domain: number): Placed[] {
  const sorted = readings
    .filter((r): r is BasisReading & { basisBps: number } => r.basisBps !== null)
    .map((r) => ({ reading: r, basisBps: r.basisBps }))
    .sort((a, b) => a.basisBps - b.basisBps);

  const lastX: number[] = new Array(MAX_ROWS).fill(-Infinity);

  return sorted.map(({ reading, basisBps }) => {
    const x = 50 + (Math.max(-domain, Math.min(domain, basisBps)) / domain) * 50;
    let row = 0;
    while (row < MAX_ROWS - 1 && x - lastX[row] < LABEL_WIDTH_PCT) row += 1;
    lastX[row] = x;
    return { reading, basisBps, x, row };
  });
}

export function MarketMap({
  readings,
  onSelect,
  held,
  heldIn = "your wallet",
  selected = null,
}: {
  readings: BasisReading[];
  onSelect: (ticker: string) => void;
  /** Tickers the connected wallet holds — ringed, so exposure reads on the map. */
  held?: ReadonlySet<string>;
  /** Whose holdings the rings show, for the legend. */
  heldIn?: string;
  selected?: string | null;
}) {
  const priced = readings.filter((r) => r.basisBps !== null);
  if (priced.length < 2) return null;

  const widest = Math.max(...priced.map((r) => Math.abs(r.basisBps!)));
  // A floor keeps a calm board from magnifying 3bps of nothing into a chart
  // full of drama; the headroom keeps the widest tick off the edge.
  const domain = Math.max(60, Math.ceil((widest * 1.15) / 10) * 10);

  // Per-pair noise floors differ slightly; the median is what the band means
  // in practice and avoids one wide-confidence feed defining the whole band.
  const floors = priced
    .map((r) => r.confidenceBps)
    .filter((c): c is number => c !== null)
    .sort((a, b) => a - b);
  const noiseBps =
    floors.length > 0 ? floors[Math.floor(floors.length / 2)] * NOISE_MULTIPLE : 0;
  const noisePct = Math.min(noiseBps / domain, 1) * 50;

  const placed = place(priced, domain);
  const rows = Math.max(MIN_ROWS, ...placed.map((p) => p.row + 1));
  // Whether a pair counts as a dislocation is the pair's own signal — the same
  // test the table's "Within noise" label and the hero use — not the median
  // band drawn here, which only illustrates it. A stalled reference is drawn
  // where its raw gap sits but never counted.
  const isQuiet = (p: Placed) =>
    p.reading.signal !== "actionable" && p.reading.signal !== "stale_reference";
  const outliers = placed.filter((p) => !isQuiet(p)).length;
  const delayed = placed.filter((p) => p.reading.signal === "degraded_feed").length;

  return (
    <section className="panel mb-5 px-4 pb-4 pt-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="eyebrow ">
          Market map
        </h2>
        <p className="text-[12px] text-[var(--text-3)]">
          {outliers === 0 ? (
            delayed > 0 ? "No clean dislocations" : "Every pair inside the noise floor"
          ) : (
            <>
              <span className="num text-white">{outliers}</span> of{" "}
              <span className="num">{placed.length}</span> outside the noise floor
            </>
          )}
          {delayed > 0 && (
            <span className="text-[var(--warn)]">
              {" "}
              · <span className="num">{delayed}</span> reference{delayed === 1 ? "" : "s"} delayed
            </span>
          )}
        </p>
      </div>

      <div className="relative mt-5" style={{ height: `${plotPx(rows) + SCALE_PX}px` }}>
        {/* Noise band, then the axis, then the zero rule on top of both. */}
        <div
          className="absolute top-0 rounded-[4px]"
          style={{
            left: `${50 - noisePct}%`,
            width: `${noisePct * 2}%`,
            bottom: `${SCALE_PX}px`,
            background:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 7px), linear-gradient(180deg, rgba(59,130,255,0.07), rgba(59,130,255,0.02))",
            boxShadow: "inset 0 0 0 1px rgba(59,130,255,0.14)",
          }}
          aria-hidden="true"
        />
        <div
          className="absolute right-0 left-0 h-px bg-[var(--border)]"
          style={{ bottom: `${SCALE_PX}px` }}
          aria-hidden="true"
        />
        <div
          className="absolute top-0 w-px"
          style={{
            left: "50%",
            bottom: `${SCALE_PX}px`,
            background: "linear-gradient(180deg, transparent, rgba(46,230,255,0.7))",
            boxShadow: "0 0 8px rgba(46,230,255,0.5)",
          }}
          aria-hidden="true"
        />

        {placed.map((p) => {
          const { reading, basisBps, x, row } = p;
          const discount = basisBps < 0;
          const quiet = isQuiet(p);
          const color = quiet ? "var(--text-3)" : discount ? "var(--down)" : "var(--up)";
          // Taller sticks sit on the top row, so every label clears the one
          // below it and each dot reads as the end of its own line.
          const stick = BASE_STICK_PX + (rows - 1 - row) * ROW_GAP_PX;
          const owned = held?.has(reading.ticker) ?? false;
          const active = selected === reading.ticker;

          return (
            <button
              key={reading.ticker}
              type="button"
              onClick={() => onSelect(reading.ticker)}
              title={`${reading.tokenTicker} · ${fmtPct(basisBps)} · ${reading.name}${owned ? " · you hold this" : ""}`}
              aria-label={`${reading.tokenTicker}, ${fmtPct(basisBps)} against ${reading.name}${owned ? ", held" : ""}`}
              aria-pressed={active}
              // An explicit box: with only absolutely-positioned children the
              // button collapses to zero width and cannot be clicked at all.
              className="group absolute -translate-x-1/2 cursor-pointer"
              style={{
                left: `${x}%`,
                bottom: `${SCALE_PX}px`,
                width: `${HIT_PX}px`,
                height: `${stick + 18}px`,
              }}
            >
              <span
                className="absolute bottom-0 left-1/2 w-px -translate-x-1/2"
                style={{
                  height: `${stick}px`,
                  background: quiet ? color : `linear-gradient(180deg, ${color}, transparent)`,
                  opacity: quiet ? 0.4 : 1,
                }}
                aria-hidden="true"
              />
              <span
                className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full transition-transform duration-200 group-hover:scale-150"
                style={{
                  bottom: `${stick - 4}px`,
                  background: color,
                  opacity: quiet && !owned ? 0.5 : 1,
                  // A ring, not a colour change: colour already carries direction.
                  boxShadow: owned
                    ? `0 0 0 2px #090a0f, 0 0 0 3.5px ${color}`
                    : quiet
                      ? undefined
                      : `0 0 12px ${color}, 0 0 3px ${color}`,
                }}
                aria-hidden="true"
              />
              <span
                className={`mono absolute top-0 left-1/2 z-10 -translate-x-1/2 rounded-[3px] px-1 py-px text-[10.5px] leading-none whitespace-nowrap transition-colors group-hover:text-white ${owned || active ? "font-medium" : ""}`}
                style={{
                  color: active ? "var(--text)" : quiet && !owned ? "var(--text-3)" : "var(--text-2)",
                  // Backed in whatever colour sits behind it, so a neighbour's
                  // stick passes under the label instead of striking through it.
                  background: "#090a0f",
                }}
              >
                {reading.tokenTicker}
              </span>
            </button>
          );
        })}

        <span className="num absolute bottom-0 left-0 text-[11px] text-[var(--text-3)]">
          −{domain}bps
        </span>
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[11px] text-[var(--text-3)]">
          fair
        </span>
        <span className="num absolute right-0 bottom-0 text-[11px] text-[var(--text-3)]">
          +{domain}bps
        </span>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-3)]">
        Left of centre trades below the real share; right of centre trades above it.
        The shaded middle is the feeds&rsquo; own confidence — anything inside it is
        noise, not a dislocation.
        {held && held.size > 0 && (
          <>
            {" "}
            <span className="whitespace-nowrap">
              <span
                className="mx-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ background: "var(--text-2)", boxShadow: "0 0 0 2px var(--surface), 0 0 0 3.5px var(--text-2)" }}
                aria-hidden="true"
              />
              Ringed pairs are in {heldIn}.
            </span>
          </>
        )}
      </p>
    </section>
  );
}
