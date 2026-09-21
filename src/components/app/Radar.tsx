"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardSnapshot } from "@/lib/board";
import type { HistorySeries } from "@/lib/history";
import {
  evaluate,
  loadRules,
  makeRule,
  saveRules,
  type AlertDirection,
  type AlertHit,
  type AlertRule,
} from "@/lib/alerts";
import { AlertControl, ArmedStrip } from "./Alerts";
import { observed as observedHistory, record as recordHistory } from "@/lib/client-history";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AssetList } from "./AssetList";
import { BasisChart } from "./BasisChart";
import { Hero } from "./Hero";
import { MarketClock } from "./MarketClock";
import { MarketMap } from "./MarketMap";
import { Portfolio } from "./Portfolio";
import { type MintMap, type Side } from "./TradePanel";
import { TradeDrawer } from "./TradeDrawer";
import { useBalances } from "./useBalances";
import { breakevenBps } from "@/lib/basis/edge";
import type { Scenario } from "@/lib/data/fixtures";

const POLL_MS = 10_000;

export function Radar({ initial }: { initial: BoardSnapshot }) {
  const [board, setBoard] = useState(initial);
  const [tier, setTier] = useState<"core" | "all">("core");
  // A replayed dislocation, requested from the page. Null = live prices.
  const [demo, setDemo] = useState<Scenario | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Set only when a holding asks for a specific side; otherwise the ticket
  // opens on the side that captures the gap.
  const [tradeSide, setTradeSide] = useState<Side | undefined>(undefined);
  const [history, setHistory] = useState<HistorySeries | null>(null);
  const [stale, setStale] = useState(false);
  const [mints, setMints] = useState<MintMap | null>(null);
  const [observed, setObserved] = useState<{ t: number; basisBps: number }[]>([]);
  const [fired, setFired] = useState<AlertHit[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );
  // Mirrored in a ref because the poll callback reads the current rules, and
  // depending on the state would rebuild the interval on every rule change.
  const rulesRef = useRef<AlertRule[]>([]);
  // Only the newest board request may land. Switching between live and a
  // replayed scenario otherwise lets a slow response paint the wrong mode.
  const requestSeq = useRef(0);

  const commitRules = useCallback((next: AlertRule[]) => {
    rulesRef.current = next;
    setRules(next);
    saveRules(next);
  }, []);

  // Fetched once: mints are public identifiers and change only on a redeploy.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/mints");
        if (res.ok) setMints((await res.json()) as MintMap);
      } catch {
        /* balances simply stay hidden */
      }
    })();
  }, []);

  useEffect(() => {
    const stored = loadRules();
    rulesRef.current = stored;
    setRules(stored);
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
  }, []);

  const addRule = useCallback(
    (ticker: string, thresholdBps: number, direction: AlertDirection) => {
      commitRules([...rulesRef.current, makeRule(ticker, thresholdBps, direction)]);
    },
    [commitRules],
  );

  const removeRule = useCallback(
    (id: string) => commitRules(rulesRef.current.filter((r) => r.id !== id)),
    [commitRules],
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  }, []);

  const applyRules = useCallback((snapshot: BoardSnapshot) => {
    const current = rulesRef.current;
    if (current.length === 0) return;
    const { hits, rules: next } = evaluate(current, snapshot.readings, Date.now());
    if (hits.length === 0) return;
    rulesRef.current = next;
    setRules(next);
    saveRules(next);
    setFired((prev) => [...hits, ...prev].slice(0, 6));
    const prefix = snapshot.fellBack ? "[demo] " : "";
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const hit of hits) {
        try {
          new Notification(`${prefix}Kolu — ${hit.ticker}X`, { body: hit.message });
        } catch {
          /* in-page list still shows it */
        }
      }
    }
  }, []);

  const refresh = useCallback(
    async (which: "core" | "all") => {
      const seq = ++requestSeq.current;
      try {
        const res = await fetch(
          `/api/basis?tier=${which}${demo ? `&scenario=${demo}` : ""}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(String(res.status));
        const snapshot: BoardSnapshot = await res.json();
        if (seq !== requestSeq.current) return;
        setBoard(snapshot);
        setStale(false);
        // A replayed scenario is modelled: it must never fire an alert or
        // enter the browser's recorded history of real readings.
        if (demo) return;
        applyRules(snapshot);

        // Recorded in the browser because a serverless process cannot hold
        // history: every request may land on a fresh instance.
        for (const r of snapshot.readings) {
          if (r.basisBps !== null) recordHistory(r.ticker, r.basisBps);
        }
      } catch {
        setStale(true);
      }
    },
    [applyRules, demo],
  );

  useEffect(() => {
    void refresh(tier);
    const id = setInterval(() => void refresh(tier), POLL_MS);
    return () => clearInterval(id);
  }, [tier, refresh]);

  useEffect(() => {
    if (!selected) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/history?ticker=${selected}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const series = (await res.json()) as HistorySeries;
        if (!cancelled) {
          setHistory(series);
          setObserved(observedHistory(selected));
        }
      } catch {
        if (!cancelled) setHistory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const { balances, watching } = useBalances();
  const held = useMemo(() => {
    const out = new Set<string>();
    if (!mints) return out;
    for (const [ticker, { mint }] of Object.entries(mints.tokens)) {
      if ((balances.get(mint)?.amount ?? 0) > 0) out.add(ticker);
    }
    return out;
  }, [mints, balances]);

  // One click from "nothing to trade" to "tell me when there is": an alert on
  // every visible pair at the gap a $10k clip needs just to cover its costs.
  const breakeven = breakevenBps();
  const armedAtBreakeven = board.readings.filter((r) =>
    rules.some((x) => x.ticker === r.ticker && x.thresholdBps === breakeven),
  ).length;
  const armBreakeven = useCallback(() => {
    const have = new Set(
      rulesRef.current.filter((x) => x.thresholdBps === breakeven).map((x) => x.ticker),
    );
    const add = board.readings
      .filter((r) => !have.has(r.ticker))
      .map((r) => makeRule(r.ticker, breakeven, "either"));
    if (add.length > 0) commitRules([...rulesRef.current, ...add]);
  }, [board.readings, breakeven, commitRules]);

  const openTrade = useCallback((ticker: string, side?: Side) => {
    setTradeSide(side);
    setSelected(ticker);
  }, []);

  const hedgeable = board.session.isRegularHours;
  const tradeable = board.readings.filter(
    (r) => r.signal === "actionable" || r.signal === "stale_reference",
  );
  const headline = tradeable.reduce<(typeof tradeable)[number] | null>((best, r) => {
    if (r.basisBps === null) return best;
    if (!best || Math.abs(r.basisBps) > Math.abs(best.basisBps ?? 0)) return r;
    return best;
  }, null);

  // Pairs the board will not call a gap on because the reference stopped
  // ticking mid-session. The hero must not describe them as "in line".
  const delayed = board.readings.filter((r) => r.signal === "degraded_feed").length;

  const detail = selected ? board.readings.find((r) => r.ticker === selected) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MarketClock session={board.session} />
        <div className="flex items-center gap-2">
          {board.degraded === "no_feeds" ? (
            <Badge tone="up">Misconfigured</Badge>
          ) : board.source === "fixture" ? (
            // Configured demo mode is not a fallback, so `fellBack` is false
            // here. Keying the badge off that alone once labelled demo numbers
            // "Live" — the one thing this product must never do.
            <Badge tone="warn">{board.fellBack ? "Demo data" : "Demo mode"}</Badge>
          ) : stale ? (
            <Badge tone="warn">Reconnecting</Badge>
          ) : (
            <Badge tone="down">
              <Dot tone="down" live />
              Live
            </Badge>
          )}
        </div>
      </div>

      {board.degraded === "no_feeds" && (
        <p className="mt-4 rounded-[var(--radius)] border border-[var(--up)]/25 bg-[var(--up-soft)] px-4 py-3 text-[13px] leading-relaxed">
          The oracle answered and none of the requested symbols exist. Demo data is
          withheld on purpose — showing it would hide this. Check{" "}
          <code className="text-[var(--text-2)]">/api/health</code>.
        </p>
      )}

      {board.source === "fixture" && board.degraded !== "no_feeds" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--warn)]/20 bg-[var(--warn-soft)] px-4 py-2.5 text-[12px] leading-relaxed text-[var(--text-2)]">
          <p>
            {demo
              ? "Replaying a modelled dislocation, so you can see what Kolu does when a gap opens. Trading and your position are off while it runs."
              : board.fellBack
                ? "The price feed is unreachable, so this is a modelled market."
                : "Demo mode is switched on, so this is a modelled market."}{" "}
            <span className="text-white">No number on this page is a real market price.</span>
          </p>
          {demo && (
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setDemo(null);
              }}
              className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--warn)]/40 px-3 py-1 text-[12px] font-medium text-[var(--warn)] transition-colors hover:bg-[var(--warn)]/10"
            >
              Back to live prices
            </button>
          )}
        </div>
      )}

      <div className="mt-4" />
      <Portfolio
        readings={board.readings}
        mints={mints}
        onTrade={openTrade}
        onShowAll={tier === "all" ? undefined : () => setTier("all")}
        demo={demo !== null}
      />

      <Hero
        reading={headline}
        hedgeable={hedgeable}
        session={board.session}
        delayed={delayed}
        onTrade={(t) => openTrade(t)}
        breakevenBps={breakeven}
        armedAtBreakeven={armedAtBreakeven}
        pairs={board.readings.length}
        onArmBreakeven={demo ? undefined : armBreakeven}
        onReplay={demo ? undefined : () => { setSelected(null); setDemo("live_dislocation"); }}
      />

      <ArmedStrip
        rules={rules}
        visibleTickers={board.readings.map((r) => r.ticker)}
        onRemove={removeRule}
      />

      {fired.length > 0 && (
        <div className="mb-5 space-y-1.5">
          {fired.slice(0, 2).map((hit, i) => (
            <p
              key={`${hit.rule.id}-${i}`}
              className="rounded-[var(--radius-sm)] bg-[var(--raised)] px-3 py-2 text-[13px] text-[var(--text-2)]"
            >
              <span className="num text-white">{hit.basisBps.toFixed(0)}bps</span> — {hit.message}
            </p>
          ))}
        </div>
      )}

      <MarketMap
        readings={board.readings}
        onSelect={(t) => openTrade(t)}
        held={held}
        heldIn={watching ? "the watched address" : "your wallet"}
        selected={selected}
      />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] uppercase tracking-[0.07em] text-[var(--text-3)]">
          All tracked pairs
        </h2>
        <div className="flex rounded-[var(--radius-sm)] border border-[var(--border)] p-0.5">
          {(["core", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              aria-pressed={tier === t}
              className={`rounded-[5px] px-2.5 py-1 text-[12px] transition-colors ${
                tier === t
                  ? "bg-[var(--raised)] text-white"
                  : "text-[var(--text-3)] hover:text-[var(--text-2)]"
              }`}
            >
              {t === "core" ? "Liquid" : "All"}
            </button>
          ))}
        </div>
      </div>

      <AssetList
        readings={board.readings}
        hedgeable={hedgeable}
        selected={selected}
        held={held}
        onSelect={(t) => {
          setTradeSide(undefined);
          setSelected((cur) => (cur === t ? null : t));
        }}
      />

      {detail && (
        <TradeDrawer
          key={`${detail.ticker}:${tradeSide ?? "auto"}`}
          reading={detail}
          history={history}
          observed={observed}
          hedgeable={hedgeable}
          mints={mints}
          initialSide={tradeSide}
          demo={demo !== null}
          rules={rules}
          permission={permission}
          onAddRule={addRule}
          onRemoveRule={removeRule}
          onRequestPermission={requestPermission}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
