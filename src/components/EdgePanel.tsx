"use client";

import { useEffect, useMemo, useState } from "react";
import type { BasisReading } from "@/lib/basis/compute";
import { computeEdge, DEFAULT_COSTS } from "@/lib/basis/edge";
import { fmtBps, fmtUsd } from "@/lib/format";

const SIZES = [1_000, 10_000, 50_000, 250_000];

interface QuoteState {
  status: "idle" | "loading" | "measured" | "unavailable";
  priceImpactBps: number | null;
  route: string[];
  detail: string | null;
}

const IDLE: QuoteState = { status: "idle", priceImpactBps: null, route: [], detail: null };

/**
 * The action surface. A gap is only interesting next to what it costs to touch
 * it, so size, costs and the net number are on screen together and the verdict
 * is stated in words.
 */
export function EdgePanel({ reading }: { reading: BasisReading }) {
  const [notional, setNotional] = useState(10_000);
  const [assumedBps, setAssumedBps] = useState(DEFAULT_COSTS.priceImpactBps);
  const [quote, setQuote] = useState<QuoteState>(IDLE);

  const hedgeable = reading.referenceQuality === "live";

  // A measured route beats an assumption, so it wins whenever one is available.
  const impactBps = quote.status === "measured" && quote.priceImpactBps !== null
    ? quote.priceImpactBps
    : assumedBps;

  // Debounced: dragging through the size presets should not fire a request per
  // keystroke, and the quote is only meaningful for the size you settle on.
  useEffect(() => {
    let cancelled = false;
    setQuote((prev) => ({ ...prev, status: "loading" }));

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/quote?ticker=${reading.ticker}&notional=${notional}`,
            { cache: "no-store" },
          );
          const body = await res.json();
          if (cancelled) return;

          if (body.available) {
            setQuote({
              status: "measured",
              priceImpactBps: Number(body.priceImpactBps),
              route: Array.isArray(body.route) ? body.route : [],
              detail: null,
            });
          } else {
            setQuote({
              status: "unavailable",
              priceImpactBps: null,
              route: [],
              detail: typeof body.detail === "string" ? body.detail : null,
            });
          }
        } catch {
          if (!cancelled) {
            setQuote({
              status: "unavailable",
              priceImpactBps: null,
              route: [],
              detail: "The quote service could not be reached.",
            });
          }
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reading.ticker, notional]);

  const edge = useMemo(() => {
    if (reading.basisBps === null) return null;
    return computeEdge({
      basisBps: reading.basisBps,
      notionalUsd: notional,
      hedgeable,
      costs: { priceImpactBps: impactBps },
    });
  }, [reading.basisBps, notional, impactBps, hedgeable]);

  if (!edge) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        No basis to act on — {reading.note}
      </p>
    );
  }

  const verdictColor = {
    good: "var(--status-good)",
    caution: "var(--status-warning)",
    bad: "var(--status-critical)",
  }[edge.tone];

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="space-y-4">
        <div>
          <label
            className="block text-xs font-medium uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
            htmlFor={`size-${reading.ticker}`}
          >
            Size
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setNotional(size)}
                className="rounded-md border px-2.5 py-1 text-sm tnum transition-colors"
                style={{
                  borderColor: notional === size ? "var(--discount)" : "var(--border)",
                  color: notional === size ? "var(--discount)" : "var(--text-secondary)",
                  background: notional === size ? "var(--surface-2)" : "transparent",
                }}
                aria-pressed={notional === size}
              >
                {size >= 1000 ? `$${size / 1000}k` : `$${size}`}
              </button>
            ))}
          </div>
          <input
            id={`size-${reading.ticker}`}
            type="number"
            min={100}
            step={100}
            value={notional}
            onChange={(e) => setNotional(Math.max(100, Number(e.target.value) || 100))}
            className="mt-2 w-full rounded-md border bg-transparent px-2.5 py-1.5 text-sm tnum"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          />
        </div>

        {quote.status === "measured" ? (
          <div>
            <div
              className="text-xs font-medium uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              Measured price impact
            </div>
            <div className="mt-1 text-lg font-semibold tnum">
              {impactBps.toFixed(1)}bps
              <span
                className="ml-2 text-xs font-normal"
                style={{ color: "var(--status-good)" }}
              >
                ● live route
              </span>
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {quote.route.length
                ? `Routed through ${quote.route.join(" → ")} for this size.`
                : "Quoted for this size."}
            </p>
          </div>
        ) : (
          <div>
            <label
              className="block text-xs font-medium uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
              htmlFor={`impact-${reading.ticker}`}
            >
              Assumed price impact — {assumedBps}bps per leg
            </label>
            <input
              id={`impact-${reading.ticker}`}
              type="range"
              min={0}
              max={120}
              value={assumedBps}
              onChange={(e) => setAssumedBps(Number(e.target.value))}
              className="mt-2 w-full"
            />
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {quote.status === "loading"
                ? "Asking the router for a quote at this size…"
                : `This is your assumption, not a measurement.${quote.detail ? ` ${quote.detail}` : ""}`}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <dl className="space-y-1.5 text-sm">
          <Row label="Gross gap" value={fmtBps(edge.grossBps, 1)} />
          {edge.breakdown.map((item) => (
            <Row
              key={item.label}
              label={item.label}
              value={`−${item.bps.toFixed(1)}bps`}
              muted
            />
          ))}
          <div
            className="flex items-baseline justify-between border-t pt-2"
            style={{ borderColor: "var(--border)" }}
          >
            <dt className="font-medium">Net edge</dt>
            <dd className="tnum text-lg font-semibold" style={{ color: verdictColor }}>
              {fmtBps(edge.netBps, 1)}{" "}
              <span className="text-sm font-normal" style={{ color: "var(--text-secondary)" }}>
                ({fmtUsd(edge.netUsd)})
              </span>
            </dd>
          </div>
        </dl>

        <p
          className="rounded-md p-2.5 text-xs leading-relaxed"
          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
        >
          <strong style={{ color: verdictColor }}>
            {edge.kind === "directional" ? "Directional" : "Hedgeable"}
          </strong>{" "}
          — {edge.caveat}
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt style={{ color: muted ? "var(--text-muted)" : "var(--text-secondary)" }}>{label}</dt>
      <dd className="tnum" style={{ color: muted ? "var(--text-muted)" : "var(--text-primary)" }}>
        {value}
      </dd>
    </div>
  );
}
