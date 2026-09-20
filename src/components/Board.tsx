"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { BoardSnapshot } from "@/lib/board";
import { formatAge } from "@/lib/basis/compute";
import { fmtBps, fmtClock, fmtPct, fmtUsd } from "@/lib/format";
import { BasisBar } from "./BasisBar";
import { EdgePanel } from "./EdgePanel";
import { SessionStrip } from "./SessionStrip";
import { SignalBadge } from "./SignalBadge";

const POLL_MS = 10_000;

export function Board({ initial }: { initial: BoardSnapshot }) {
  const [board, setBoard] = useState(initial);
  const [tier, setTier] = useState<"core" | "all">("core");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (which: "core" | "all") => {
    try {
      const res = await fetch(`/api/basis?tier=${which}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Board request failed (${res.status})`);
      setBoard(await res.json());
      setError(null);
    } catch (err) {
      // Keep showing the last good board; say that it is no longer fresh.
      setError(err instanceof Error ? err.message : "Refresh failed");
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(tier), POLL_MS);
    return () => clearInterval(id);
  }, [refresh, tier]);

  useEffect(() => {
    void refresh(tier);
  }, [tier, refresh]);

  const domain = Math.max(
    50,
    ...board.readings.map((r) => Math.abs(r.basisBps ?? 0)),
  );

  return (
    <div className="space-y-5">
      <div
        className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      >
        <SessionStrip session={board.session} />
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="tnum">Updated {fmtClock(board.generatedAt)} ET</span>
          <div className="flex rounded-md border" style={{ borderColor: "var(--border)" }}>
            {(["core", "all"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className="px-2.5 py-1 text-xs capitalize first:rounded-l-md last:rounded-r-md"
                style={{
                  background: tier === t ? "var(--surface-2)" : "transparent",
                  color: tier === t ? "var(--text-primary)" : "var(--text-muted)",
                }}
                aria-pressed={tier === t}
              >
                {t === "core" ? "Liquid" : "All"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(board.fellBack || error) && (
        <div
          className="card px-4 py-3 text-sm"
          style={{ borderColor: "var(--status-warning)" }}
        >
          <span style={{ color: "var(--status-warning)" }} aria-hidden="true">
            {"▲"}{" "}
          </span>
          {board.fellBack ? (
            <>
              <strong>Demo data.</strong> The live price source was unreachable
              {board.scenario ? ` — showing the “${board.scenario.replace("_", " ")}” scenario` : ""}.
              Nothing here is a live market price.{" "}
              <span style={{ color: "var(--text-muted)" }}>({board.fallbackReason})</span>
            </>
          ) : (
            <>
              <strong>Stale.</strong> {error} — showing the last board that loaded.
            </>
          )}
        </div>
      )}

      <Tiles board={board} />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Tokenized stocks ranked by how far each trades from its underlying.
          </caption>
          <thead>
            <tr
              className="text-left text-xs uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              <th scope="col" className="px-4 py-2.5 font-medium">Ticker</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Underlying</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Token</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Basis</th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                Discount {"←"} 0 {"→"} Premium
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">Signal</th>
            </tr>
          </thead>
          <tbody>
            {board.readings.map((r) => {
              const isOpen = expanded === r.ticker;
              return (
                <Fragment key={r.ticker}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : r.ticker)}
                    className="cursor-pointer border-t transition-colors"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      <div>{r.tokenTicker}</div>
                      <div className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                        {r.name}
                      </div>
                    </th>
                    <td className="px-4 py-3 text-right tnum">
                      {r.equity ? fmtUsd(r.equity.price) : "—"}
                      {r.referenceAgeSeconds !== null && r.referenceAgeSeconds > 120 && (
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {formatAge(r.referenceAgeSeconds)} old
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tnum">
                      {r.token ? fmtUsd(r.token.price) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tnum font-medium">
                      {r.basisBps === null ? (
                        "—"
                      ) : (
                        <>
                          <div
                            style={{
                              color:
                                r.signal === "noise" || r.signal === "degraded_feed"
                                  ? "var(--text-secondary)"
                                  : r.basisBps > 0
                                    ? "var(--premium)"
                                    : "var(--discount)",
                            }}
                          >
                            {fmtPct(r.basisBps)}
                          </div>
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {fmtBps(r.basisBps, 1)}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {r.basisBps !== null && (
                        <BasisBar
                          basisBps={r.basisBps}
                          confidenceBps={r.confidenceBps}
                          domainBps={domain}
                          muted={r.signal === "noise" || r.signal === "degraded_feed"}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SignalBadge signal={r.signal} />
                    </td>
                  </tr>

                  {isOpen && (
                    <tr style={{ background: "var(--surface-2)" }}>
                      <td colSpan={6} className="px-4 py-4">
                        {r.note && (
                          <p
                            className="mb-4 text-sm leading-relaxed"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {r.note}
                          </p>
                        )}
                        <EdgePanel reading={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Basis is (token − underlying) ÷ underlying. Prices are oracle mid, not a
        quote you can hit; the net edge above assumes the price impact you set.
        Kolu is analysis, not investment advice.
      </p>
    </div>
  );
}

function Tiles({ board }: { board: BoardSnapshot }) {
  const { summary } = board;
  const hedgeable = board.session.isRegularHours;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile
        label="Widest dislocation"
        value={summary.widestBps === null ? "—" : fmtPct(summary.widestBps)}
        sub={summary.widestTicker ? `${summary.widestTicker}X` : "Nothing outside the noise floor"}
        color={
          summary.widestBps === null
            ? "var(--text-primary)"
            : summary.widestBps > 0
              ? "var(--premium)"
              : "var(--discount)"
        }
      />
      <Tile
        label="Names worth watching"
        value={String(summary.actionable)}
        sub={`of ${board.readings.length} tracked`}
      />
      <Tile
        label="Can it be hedged?"
        value={hedgeable ? "Yes" : "No"}
        sub={
          hedgeable
            ? "Underlying is open — a short leg exists"
            : "Underlying is shut — convergence bet only"
        }
        color={hedgeable ? "var(--status-good)" : "var(--status-warning)"}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  color = "var(--text-primary)",
}: {
  label: string;
  value: string;
  sub: string;
  color?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
        {sub}
      </div>
    </div>
  );
}
