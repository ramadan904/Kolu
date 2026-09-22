"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardSnapshot } from "@/lib/board";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { viewFor } from "./TopNav";
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
import { FirstVisit } from "./FirstVisit";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { GapHistory } from "./GapHistory";
import { RecentDislocations } from "./RecentDislocations";
import { HowItReads } from "./HowItReads";
import { OpenConvergence } from "./OpenConvergence";
import { Backtest, BacktestMethod } from "./Backtest";
import { type MintMap, type Side } from "./TradePanel";
import { TradeDrawer } from "./TradeDrawer";
import { useBalances } from "./useBalances";
import { breakevenBps } from "@/lib/basis/edge";
import type { Scenario } from "@/lib/data/fixtures";
import { findEntry, UNIVERSE } from "@/lib/universe";
import { fmtPct } from "@/lib/format";
import { CommandPalette, PaletteButton, type Command } from "./CommandPalette";
import { EXAMPLE_WALLET } from "@/lib/known-wallets";

const POLL_MS = 10_000;

/** Scrolls to an element once the page that holds it has rendered. */
function scrollWhenReady(id: string, block: ScrollLogicalPosition = "start") {
  const until = Date.now() + 3000;
  const tick = () => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block });
    else if (Date.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function Radar({ initial }: { initial: BoardSnapshot }) {
  const pathname = usePathname();
  const router = useRouter();
  const view = viewFor(pathname);
  /** To a page (and a section on it), keeping every piece of board state. */
  const go = (path: string, id?: string) => {
    if (viewFor(path) !== view) router.push(path, { scroll: !id });
    if (id) scrollWhenReady(id);
  };
  const [board, setBoard] = useState(initial);
  const [tier, setTier] = useState<"core" | "all">("core");
  // A replayed dislocation, requested from the page. Null = live prices.
  const [demo, setDemo] = useState<Scenario | null>(null);
  // Pair shown in the on-page gap history; defaults to the headline pair.
  const [chartTicker, setChartTicker] = useState<string | null>(null);
  const [chartDays, setChartDays] = useState<2 | 7>(2);
  // From a list below the chart: switch it to that pair (and window), and bring it into view.
  const showHistory = (ticker: string, days?: 2 | 7) => {
    setChartTicker(ticker);
    if (days) setChartDays(days);
    if (view !== "history") router.push("/history", { scroll: false });
    scrollWhenReady("gap-history", "center");
  };
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
        const res = await fetch(
          `/api/history?ticker=${selected}${demo ? "&modelled=1" : ""}`,
          { cache: "no-store" },
        );
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
  }, [selected, demo]);

  const { balances, watching, owner, watch } = useBalances();

  // Deep links: ?trade=TSLA[&side=sell], ?replay=1, ?view=example. Read once,
  // so a shared link opens exactly the view it was copied from.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("replay") === "1") setDemo("live_dislocation");
    if (params.get("view") === "example") {
      watch(EXAMPLE_WALLET.address);
      // Older links opened the example on the one-page board; it lives on Portfolio now.
      if (view !== "portfolio") router.replace("/portfolio?view=example");
    }
    const ticker = params.get("trade");
    const entry = ticker ? findEntry(ticker) : undefined;
    if (entry) {
      if (entry.tier !== "core") setTier("all");
      const side = params.get("side");
      setTradeSide(side === "buy" || side === "sell" ? side : undefined);
      setSelected(entry.ticker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ...and kept in the address bar, so copying it always shares the current
  // view. A watched address is never put in a URL — only the public example.
  useEffect(() => {
    const params = new URLSearchParams();
    if (selected) {
      params.set("trade", selected);
      if (tradeSide) params.set("side", tradeSide);
    }
    if (demo) params.set("replay", "1");
    if (view === "portfolio" && watching && owner === EXAMPLE_WALLET.address) params.set("view", "example");
    const query = params.toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", next);
    }
  }, [selected, tradeSide, demo, watching, owner, view]);
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

  // Everything on the page, one search away (⌘K or /).
  const commands = useMemo<Command[]>(() => {
    const pairs: Command[] = UNIVERSE.flatMap((entry) => {
      const r = board.readings.find((x) => x.ticker === entry.ticker);
      const gap = r?.basisBps ?? null;
      const trade: Command = {
        id: `trade-${entry.ticker}`,
        group: "Pairs",
        label: `Trade ${entry.tokenTicker} · ${entry.name}`,
        hint: gap === null ? undefined : fmtPct(gap),
        hintColor: gap === null ? undefined : gap < 0 ? "var(--down)" : "var(--up)",
        keywords: `${entry.ticker} ticket buy sell swap limit`,
        run: () => {
          if (demo && entry.tier !== "core") setDemo(null);
          if (entry.tier !== "core") setTier("all");
          openTrade(entry.ticker);
        },
      };
      if (entry.tier !== "core") return [trade];
      return [
        trade,
        {
          id: `chart-${entry.ticker}`,
          group: "Pairs",
          label: `Chart ${entry.tokenTicker} · 7 days of real gaps`,
          keywords: `${entry.ticker} ${entry.name} history gap chart week`,
          run: () => showHistory(entry.ticker, 7),
        },
      ];
    });
    const goto: Command[] = [
      { id: "go-board", group: "Go to", label: "Board", hint: "page", keywords: "home live market map", run: () => go("/") },
      { id: "go-position", group: "Go to", label: "Portfolio", hint: "page", keywords: "position holdings wallet pnl orders activity", run: () => go("/portfolio") },
      { id: "go-history", group: "Go to", label: "History", hint: "page", keywords: "gap chart 48h 7d", run: () => go("/history") },
      { id: "go-backtest", group: "Go to", label: "Backtest", hint: "page", keywords: "would it have paid strategy simulate threshold", run: () => go("/backtest") },
      { id: "go-pairs", group: "Go to", label: "All tracked pairs", keywords: "table board", run: () => go("/", "pairs") },
      { id: "go-dislocations", group: "Go to", label: "Recent dislocations", keywords: "widest movers", run: () => go("/history", "recent-dislocations") },
      { id: "go-open", group: "Go to", label: "Does the gap close at the open?", keywords: "convergence thesis", run: () => go("/history", "open-convergence") },
      { id: "go-how", group: "Go to", label: "How Kolu reads a gap", keywords: "noise floor hedge breakeven explain", run: () => go("/", "how-it-reads") },
    ];
    const actions: Command[] = [
      demo
        ? { id: "live", group: "Actions", label: "Back to live prices", keywords: "replay stop demo", run: () => { setSelected(null); setDemo(null); } }
        : { id: "replay", group: "Actions", label: "Replay a dislocation", keywords: "demo scenario gap opens", run: () => { setSelected(null); setDemo("live_dislocation"); } },
      {
        id: "example",
        group: "Actions",
        label: "See a live portfolio · Kraken hot wallet",
        keywords: "example watch address holdings",
        run: () => {
          setDemo(null);
          watch(EXAMPLE_WALLET.address);
          go("/portfolio");
        },
      },
      tier === "all"
        ? { id: "tier-core", group: "Actions", label: "Show liquid pairs only", keywords: "filter core", run: () => setTier("core") }
        : { id: "tier-all", group: "Actions", label: "Show all 12 pairs", keywords: "filter extended every", run: () => setTier("all") },
      {
        id: "arm",
        group: "Actions",
        label: "Alert me when any gap pays",
        hint: `${breakeven}bps`,
        keywords: "alerts notify arm breakeven",
        run: armBreakeven,
      },
      {
        id: "copy",
        group: "Actions",
        label: "Copy link to this view",
        keywords: "share url",
        run: () => void navigator.clipboard?.writeText(window.location.href).catch(() => undefined),
      },
      { id: "health", group: "Actions", label: "System health", keywords: "status api sources", run: () => window.open("/api/health", "_blank", "noopener") },
    ];
    return [...pairs, ...goto, ...actions];
    // showHistory is recreated each render but only closes over setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.readings, demo, tier, breakeven, armBreakeven, openTrade, watch, view]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MarketClock session={board.session} />
        <div className="flex items-center gap-2">
          <PaletteButton />
          <CommandPalette commands={commands} />
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

      {view !== "board" && <PageHead view={view} />}

      {fired.length > 0 && (
        <div className="mb-5 space-y-1.5">
          {fired.slice(0, 2).map((hit, i) => (
            <div
              key={`${hit.rule.id}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--raised)] px-3 py-2 text-[13px] text-[var(--text-2)]"
            >
              <p>
                <span className="num text-white">{hit.basisBps.toFixed(0)}bps</span> — {hit.message}
              </p>
              {/* An alert is only useful if it leads somewhere: straight to the ticket. */}
              {!demo && (
                <button
                  type="button"
                  onClick={() => openTrade(hit.rule.ticker)}
                  className="shrink-0 text-[12px] text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Open ticket →
                </button>
              )}
            </div>
          ))}
        </div>
      )}


      {view === "board" && (
        <>
      <FirstVisit
        onReplay={() => {
          setSelected(null);
          setDemo("live_dislocation");
        }}
        onExample={() => {
          setDemo(null);
          watch(EXAMPLE_WALLET.address);
          go("/portfolio");
        }}
        onTicket={() => {
          setDemo(null);
          const target = headline?.ticker ?? board.readings[0]?.ticker;
          if (target) openTrade(target);
        }}
      />

      <ErrorBoundary name="The headline">
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
      </ErrorBoundary>

      <ArmedStrip
        rules={rules}
        visibleTickers={board.readings.map((r) => r.ticker)}
        onRemove={removeRule}
      />

      <ErrorBoundary name="The market map">
      <MarketMap
        readings={board.readings}
        onSelect={(t) => openTrade(t)}
        held={held}
        heldIn={watching ? "the watched address" : "your wallet"}
        selected={selected}
      />
      </ErrorBoundary>

      <div id="pairs" className="mb-3 flex scroll-mt-4 items-center justify-between">
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

      <ErrorBoundary name="The pairs table">
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
      </ErrorBoundary>


      <div className="mt-5" />
      <ErrorBoundary name="How Kolu reads a gap">
        <HowItReads readings={board.readings} session={board.session} hedgeable={hedgeable} />
      </ErrorBoundary>

      <Explore />
        </>
      )}

      {view === "portfolio" && (
        <>
      <div className="scroll-mt-4" id="position" />
      <ErrorBoundary name="Your position">
      <Portfolio
        readings={board.readings}
        mints={mints}
        onTrade={openTrade}
        onShowAll={tier === "all" ? undefined : () => setTier("all")}
        demo={demo !== null}
      />
      </ErrorBoundary>


        </>
      )}

      {view === "history" && (
        <>
      <ErrorBoundary name="Gap history">
        <GapHistory
          readings={board.readings}
          ticker={chartTicker ?? headline?.ticker ?? null}
          onTicker={setChartTicker}
          days={chartDays}
          onDays={setChartDays}
          onTrade={(t) => openTrade(t)}
          demo={demo !== null}
        />
      </ErrorBoundary>


      {demo ? (
        <DemoNote what="Recent dislocations and the open-by-open record" onLive={() => { setSelected(null); setDemo(null); }} />
      ) : (
        <>
          <ErrorBoundary name="Recent dislocations">
            <RecentDislocations onSelect={showHistory} />
          </ErrorBoundary>
          <ErrorBoundary name="Open convergence">
            <OpenConvergence onSelect={(t) => showHistory(t, 7)} />
          </ErrorBoundary>
        </>
      )}
        </>
      )}

      {view === "backtest" && (
        demo ? (
          <DemoNote what="The backtest" onLive={() => { setSelected(null); setDemo(null); }} />
        ) : (
          <>
            <ErrorBoundary name="Backtest">
              <Backtest onTrade={(t) => openTrade(t)} />
            </ErrorBoundary>
            <BacktestMethod />
          </>
        )
      )}

      {detail && (
        <ErrorBoundary
          name="The trade ticket"
          fallback={() => (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="alertdialog">
              <div className="panel max-w-sm p-5 text-[13px]">
                <p className="text-[var(--text-2)]">
                  The trade ticket hit an error. Nothing was signed or sent.
                </p>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="mt-3 text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        >
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
        </ErrorBoundary>
      )}
    </div>
  );
}

const HEADS = {
  portfolio: [
    "Portfolio",
    "Your xStocks valued against the live gaps: P&L, what closing each gap is worth, open limit orders and recent activity.",
  ],
  history: [
    "Gap history",
    "How far each xStock traded from its real share, from real on-chain trades — and whether the gap closed when the market opened.",
  ],
  backtest: [
    "Backtest",
    "Would trading the gap have paid? Set a rule; last week's real trades answer, after costs.",
  ],
} as const;

function PageHead({ view }: { view: keyof typeof HEADS }) {
  const [title, sub] = HEADS[view];
  return (
    <div className="mt-6 mb-6">
      <h1 className="display text-[28px] leading-tight tracking-[-0.02em]">{title}</h1>
      <p className="mt-1.5 max-w-[640px] text-[14px] leading-relaxed text-[var(--text-2)]">{sub}</p>
    </div>
  );
}

/** Modelled prices never feed real history or real holdings; say so, and offer the way back. */
function DemoNote({ what, onLive }: { what: string; onLive: () => void }) {
  return (
    <div className="panel mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-[13px] sm:px-5">
      <p className="text-[var(--text-2)]">{what} run on real trades only, so they are off while the replay runs.</p>
      <button
        type="button"
        onClick={onLive}
        className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--raised)] hover:text-white"
      >
        Back to live prices
      </button>
    </div>
  );
}

const EXPLORE = [
  ["/portfolio", "Portfolio", "Your xStocks against the live gaps, with P&L — or watch any address."],
  ["/history", "History", "A week of real gaps per pair, and whether they closed at the open."],
  ["/backtest", "Backtest", "Would trading the gap have paid? Set a rule, see last week's answer."],
] as const;

/** Where to go from the board: the other three pages, each with the question it answers. */
function Explore() {
  return (
    <nav aria-label="More" className="mt-2 mb-2 grid gap-3 md:grid-cols-3">
      {EXPLORE.map(([href, title, line]) => (
        <Link
          key={href}
          href={href}
          className="panel group block px-4 py-3.5 transition-colors hover:border-[var(--border-strong)] sm:px-5"
        >
          <span className="flex items-center justify-between text-[14px] font-medium text-white">
            {title}
            <span className="text-[var(--text-3)] transition-transform group-hover:translate-x-0.5">→</span>
          </span>
          <span className="mt-1 block text-[13px] leading-relaxed text-[var(--text-3)]">{line}</span>
        </Link>
      ))}
    </nav>
  );
}
