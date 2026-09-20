"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { BoardSnapshot } from "@/lib/board";
import { formatAge } from "@/lib/basis/compute";
import { fmtBps, fmtClock, fmtPct, fmtUsd } from "@/lib/format";
import {
  evaluate,
  loadRules,
  makeRule,
  saveRules,
  type AlertDirection,
  type AlertHit,
  type AlertRule,
} from "@/lib/alerts";
import type { HistorySeries } from "@/lib/history";
import { AlertPanel } from "./AlertPanel";
import { BasisBar } from "./BasisBar";
import { BasisChart } from "./BasisChart";
import { EdgePanel } from "./EdgePanel";
import { SessionStrip } from "./SessionStrip";
import { SignalBadge } from "./SignalBadge";

const POLL_MS = 10_000;

export function Board({ initial }: { initial: BoardSnapshot }) {
  const [board, setBoard] = useState(initial);
  const [tier, setTier] = useState<"core" | "all">("core");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<HistorySeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [fired, setFired] = useState<AlertHit[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );
  // Rules are read inside the poll callback, which must not be rebuilt on every
  // rule change or the poll interval would reset each time.
  const rulesRef = useRef<AlertRule[]>([]);

  useEffect(() => {
    const stored = loadRules();
    setRules(stored);
    rulesRef.current = stored;
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  const applyRules = useCallback((snapshot: BoardSnapshot) => {
    const current = rulesRef.current;
    if (current.length === 0) return;

    const { hits, rules: next } = evaluate(current, snapshot.readings, Date.now());
    if (hits.length === 0) return;

    rulesRef.current = next;
    setRules(next);
    saveRules(next);
    setFired((prev) => [...hits, ...prev].slice(0, 20));

    // Demo data must never masquerade as a live signal, including in a
    // notification the viewer reads with the tab in the background.
    const prefix = snapshot.fellBack ? "[demo] " : "";
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const hit of hits) {
        try {
          new Notification(`${prefix}Kolu — ${hit.ticker}X`, { body: hit.message });
        } catch {
          // Some browsers reject constructed notifications outside a service
          // worker; the in-page list still shows the hit.
        }
      }
    }
  }, []);

  const refresh = useCallback(
    async (which: "core" | "all") => {
      try {
        const res = await fetch(`/api/basis?tier=${which}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Board request failed (${res.status})`);
        const snapshot: BoardSnapshot = await res.json();
        setBoard(snapshot);
        setError(null);
        applyRules(snapshot);
      } catch (err) {
        // Keep showing the last good board; say that it is no longer fresh.
        setError(err instanceof Error ? err.message : "Refresh failed");
      }
    },
    [applyRules],
  );

  const addRule = useCallback(
    (ticker: string, thresholdBps: number, direction: AlertDirection) => {
      const next = [...rulesRef.current, makeRule(ticker, thresholdBps, direction)];
      rulesRef.current = next;
      setRules(next);
      saveRules(next);
    },
    [],
  );

  const removeRule = useCallback((id: string) => {
    const next = rulesRef.current.filter((r) => r.id !== id);
    rulesRef.current = next;
    setRules(next);
    saveRules(next);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(tier), POLL_MS);
    return () => clearInterval(id);
  }, [refresh, tier]);

  useEffect(() => {
    void refresh(tier);
  }, [tier, refresh]);

  // History is fetched only for the open row — the full series for every
  // ticker would be a large payload nobody is looking at.
  useEffect(() => {
    if (!expanded) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/history?ticker=${expanded}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const series = (await res.json()) as HistorySeries;
        if (!cancelled) setHistory(series);
      } catch {
        if (!cancelled) setHistory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded]);

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

      <AlertPanel
        rules={rules}
        tickers={board.readings.map((r) => r.ticker)}
        recent={fired}
        permission={permission}
        onAdd={addRule}
        onRemove={removeRule}
        onRequestPermission={requestPermission}
      />

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
                        {history?.ticker === r.ticker && (
                          <div
                            className="mb-5 border-b pb-5"
                            style={{ borderColor: "var(--border)" }}
                          >
                            <BasisChart series={history} />
                          </div>
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
