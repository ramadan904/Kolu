"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import type { BasisReading } from "@/lib/basis/compute";
import {
  computeEdge,
  DEFAULT_COSTS,
  DEFAULT_SLIPPAGE_BPS,
  SLIPPAGE_OPTIONS,
  sideForGap,
  worstCase,
  type EdgeResult,
} from "@/lib/basis/edge";
import { Button } from "@/components/ui/Button";
import { Badge, Dot } from "@/components/ui/Badge";
import { fmtBps, fmtUsd } from "@/lib/format";
import { fmtAmount } from "@/lib/tokens";
import { describeTradeError, fromBaseUnits } from "@/lib/trade";
import { pollConfirmation } from "@/lib/confirm";
import { requestBalancesRefresh, useBalances } from "./useBalances";
import { WalletButton } from "./WalletButton";

export type Side = "buy" | "sell";
type Unit = "usd" | "token";

/** Presets double as the size ladder: each shows what survives costs at that size. */
const SIZES = [500, 2_000, 10_000, 50_000];
/** Jupiter quotes drift within seconds; anything older is re-fetched before signing. */
const QUOTE_TTL_MS = 10_000;
/** Background re-quote cadence while the ticket is open. */
const REQUOTE_MS = 15_000;
const MIN_NOTIONAL_USD = 1;

interface Quote {
  available: boolean;
  reason?: string;
  detail?: string;
  side?: Side;
  slippageBps?: number;
  priceImpactBps?: number;
  route?: string[];
  outAmount?: string;
  minOutAmount?: string | null;
  outDecimals?: number;
  quote?: unknown;
}

type TxState =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "signing" }
  | { kind: "sending"; signature?: string }
  | { kind: "done"; signature: string; side: Side; spent: number; received: number | null }
  /** Sent, but the chain has not said either way. Must not be retried blindly. */
  | { kind: "unconfirmed"; signature: string }
  | { kind: "error"; message: string; signature?: string };

export interface MintMap {
  quote: { mint: string; decimals: number } | null;
  tokens: Record<string, { mint: string; decimals: number }>;
}

async function fetchQuote(p: {
  ticker: string;
  notional: number;
  side: Side;
  price: number;
  slippageBps: number;
}): Promise<Quote> {
  const params = new URLSearchParams({
    ticker: p.ticker,
    notional: String(p.notional),
    side: p.side,
    price: String(p.price),
    slippageBps: String(p.slippageBps),
  });
  const res = await fetch(`/api/quote?${params}`, { cache: "no-store" });
  return (await res.json()) as Quote;
}

/**
 * Keeps a converted input readable: no float tails, sensible precision per unit.
 * `floor` is for full-balance sizes, where rounding up by a hair asks the
 * wallet to spend more than it holds.
 */
function toInput(value: number, unit: Unit, floor = false): string {
  if (!(value > 0)) return "";
  const scale = unit === "usd" ? 100 : 1_000_000;
  const rounded = floor ? Math.floor(value * scale) / scale : Math.round(value * scale) / scale;
  return String(rounded);
}

export function TradePanel({
  reading,
  hedgeable,
  mints,
  initialSide,
  children,
}: {
  reading: BasisReading;
  hedgeable: boolean;
  mints: MintMap | null;
  /** Set when the ticket is opened from a holding with an explicit Buy or Sell. */
  initialSide?: Side;
  /**
   * Context rendered below the controls (chart, alerts). Passed in rather than
   * placed after the panel so the action bar stays pinned while it scrolls.
   */
  children?: ReactNode;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { balances, loading: loadingBalances, error: balanceError } = useBalances();

  const gapSide = sideForGap(reading.basisBps);
  const hasGap = reading.basisBps !== null && reading.basisBps !== 0;
  // Whether the board calls this gap a signal. A gap inside the noise floor,
  // or one measured against a stalled feed, has a sign but no meaning — the
  // ticket must not tell anyone they are "capturing" it.
  const gapIsSignal = reading.signal === "actionable" || reading.signal === "stale_reference";

  const [side, setSide] = useState<Side>(initialSide ?? gapSide);
  const [unit, setUnit] = useState<Unit>("usd");
  const [input, setInput] = useState("2000");
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [ladder, setLadder] = useState<Record<number, Quote>>({});
  const [tick, setTick] = useState(0);
  const [tx, setTx] = useState<TxState>({ kind: "idle" });

  // Taking the wrong side of a gap only means something when the gap does.
  const against = gapIsSignal && hasGap && side !== gapSide;
  const tokenPrice = reading.token?.price ?? 0;
  const parsed = Number(input);
  const notional =
    !Number.isFinite(parsed) || parsed <= 0 ? 0 : unit === "usd" ? parsed : parsed * tokenPrice;
  const sizeValid = notional >= MIN_NOTIONAL_USD;
  const tokens = tokenPrice > 0 ? notional / tokenPrice : 0;

  const tokenMint = mints?.tokens[reading.ticker]?.mint;
  const quoteMint = mints?.quote?.mint;
  const tokenHeld = tokenMint ? (balances.get(tokenMint)?.amount ?? 0) : 0;
  const usdcHeld = quoteMint ? (balances.get(quoteMint)?.amount ?? 0) : 0;

  // What this trade would actually cost, in the asset being spent.
  const needed = side === "sell" ? tokens : notional;
  const held = side === "sell" ? tokenHeld : usdcHeld;
  const payUnit = side === "sell" ? reading.tokenTicker : "USDC";
  const balancesKnown = connected && !loadingBalances && !balanceError;
  // Only claim a shortfall once balances have actually been read.
  const shortfall = balancesKnown && sizeValid && held < needed * 0.9999;

  const busy = tx.kind === "building" || tx.kind === "signing" || tx.kind === "sending";

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REQUOTE_MS);
    return () => clearInterval(id);
  }, []);

  // A finished or failed trade belongs to the inputs that produced it. Change
  // the inputs and the ticket is a new trade. Keyed on what was typed, not on
  // the USD notional, which moves with every price poll in token mode.
  useEffect(() => {
    setTx((t) => (t.kind === "done" || t.kind === "error" ? { kind: "idle" } : t));
  }, [side, input, unit, slippageBps]);

  // Quotes are directional. Showing a buy quote's output under a sell ticket
  // for the 300ms before the re-quote lands would put the wrong unit on screen.
  useEffect(() => {
    setQuote(null);
    setLadder({});
  }, [side]);

  // The live quote for the exact size entered.
  useEffect(() => {
    if (!sizeValid) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    if (busy) return;
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const body = await fetchQuote({
            ticker: reading.ticker,
            notional,
            side,
            price: tokenPrice,
            slippageBps,
          });
          if (!cancelled) {
            setQuote(body);
            setQuotedAt(Date.now());
          }
        } catch {
          if (!cancelled) setQuote({ available: false, detail: "Quote service unreachable." });
        } finally {
          if (!cancelled) setQuoting(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `busy` is deliberately absent: a re-quote landing mid-signature would
    // change the numbers on screen under a transaction already built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.ticker, tokenPrice, notional, side, slippageBps, sizeValid, tick]);

  // Measured impact at each preset size, so the ladder shows where the trade
  // stops paying rather than asking someone to discover it one size at a time.
  useEffect(() => {
    if (!(tokenPrice > 0)) return;
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(
        SIZES.map(async (size) => {
          try {
            return [
              size,
              await fetchQuote({ ticker: reading.ticker, notional: size, side, price: tokenPrice, slippageBps }),
            ] as const;
          } catch {
            return [size, { available: false } as Quote] as const;
          }
        }),
      );
      if (!cancelled) setLadder(Object.fromEntries(results));
    })();
    return () => {
      cancelled = true;
    };
    // Re-quoted on the slow tick, not every oracle poll: four quotes per price
    // update would be most of the Jupiter budget for one open ticket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.ticker, side, slippageBps, tick, tokenPrice > 0]);

  const edgeAt = useCallback(
    (size: number, impactBps: number): EdgeResult | null =>
      reading.basisBps === null
        ? null
        : computeEdge({
            basisBps: reading.basisBps,
            notionalUsd: size,
            hedgeable,
            against,
            costs: { priceImpactBps: impactBps },
          }),
    [reading.basisBps, hedgeable, against],
  );

  const impactBps = quote?.available
    ? (quote.priceImpactBps ?? 0)
    : DEFAULT_COSTS.priceImpactBps;
  const edge = useMemo(
    () => (sizeValid ? edgeAt(notional, impactBps) : null),
    [edgeAt, notional, impactBps, sizeValid],
  );
  const risk = edge ? worstCase(edge.netBps, slippageBps) : null;

  const received = quote?.available ? fromBaseUnits(quote.outAmount, quote.outDecimals) : null;
  const minReceived = quote?.available
    ? fromBaseUnits(quote.minOutAmount ?? undefined, quote.outDecimals)
    : null;
  const receiveUnit = side === "buy" ? reading.tokenTicker : "USDC";

  const setSize = (usd: number, floor = false) =>
    setInput(toInput(unit === "usd" ? usd : usd / tokenPrice, unit, floor));

  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    if (tokenPrice > 0 && notional > 0) {
      setInput(toInput(next === "usd" ? notional : notional / tokenPrice, next));
    }
    setUnit(next);
  };

  const swap = useCallback(async () => {
    if (!publicKey || !signTransaction || !sizeValid) return;
    let signature: string | undefined;
    const spent = side === "buy" ? notional : tokens;
    try {
      setTx({ kind: "building" });

      // Never sign against a quote the market has moved away from.
      let live = quote;
      if (!live?.available || !live.quote || Date.now() - quotedAt > QUOTE_TTL_MS) {
        live = await fetchQuote({
          ticker: reading.ticker,
          notional,
          side,
          price: tokenPrice,
          slippageBps,
        });
        setQuote(live);
        setQuotedAt(Date.now());
        if (!live.available || !live.quote) throw new Error("No route");
      }

      const res = await fetch("/api/swap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote: live.quote, userPublicKey: publicKey.toBase58() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Swap build failed (${res.status})`);

      const transaction = VersionedTransaction.deserialize(
        Buffer.from(body.swapTransaction as string, "base64"),
      );
      // Taken before signing: the expiry that matters is the one of the
      // blockhash baked into this transaction, not one fetched after sending.
      const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

      setTx({ kind: "signing" });
      const signed = await signTransaction(transaction);

      setTx({ kind: "sending" });
      signature = await connection.sendRawTransaction(signed.serialize(), {
        maxRetries: 3,
        skipPreflight: false,
      });
      setTx({ kind: "sending", signature });

      const outcome = await pollConfirmation(connection, signature, lastValidBlockHeight);
      // A landed transaction can still have failed — slippage reverts on-chain.
      // Reporting that as "Filled" would be the worst lie this screen could tell.
      if (outcome.status === "failed") {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(outcome.err)}`);
      }
      if (outcome.status === "expired") {
        throw new Error("Transaction expired: block height exceeded");
      }
      // The second-worst lie is "nothing was filled" about a swap that may yet
      // land. Retrying it could buy twice, so this state has no retry button.
      if (outcome.status === "unknown") {
        setTx({ kind: "unconfirmed", signature });
        requestBalancesRefresh();
        return;
      }

      setTx({
        kind: "done",
        signature,
        side,
        spent,
        received: fromBaseUnits(live.outAmount, live.outDecimals),
      });
      requestBalancesRefresh();
    } catch (err) {
      setTx({ kind: "error", message: describeTradeError(err, { slippageBps, payUnit }), signature });
      // A failed swap still spends a fee; balances should say so.
      if (signature) requestBalancesRefresh();
    }
  }, [
    publicKey,
    signTransaction,
    sizeValid,
    side,
    notional,
    tokens,
    quote,
    quotedAt,
    reading.ticker,
    tokenPrice,
    slippageBps,
    connection,
    payUnit,
  ]);

  const canSwap = connected && sizeValid && quote?.available === true && !busy && !shortfall;
  const netColor = !edge
    ? "var(--text-3)"
    : edge.tone === "good"
      ? "var(--down)"
      : edge.tone === "caution"
        ? "var(--warn)"
        : "var(--up)";
  const gapPct =
    reading.basisBps === null ? "" : `${(Math.abs(reading.basisBps) / 100).toFixed(2)}%`;
  const gapWord = (reading.basisBps ?? 0) > 0 ? "premium" : "discount";

  const primaryLabel = !sizeValid
    ? "Enter a size"
    : shortfall
      ? `Not enough ${payUnit}`
      : tx.kind === "building"
        ? "Preparing swap"
        : tx.kind === "signing"
          ? "Approve in your wallet"
          : tx.kind === "sending"
            ? "Confirming on Solana"
            : quote?.available
              ? `${side === "sell" ? "Sell" : "Buy"} ${reading.tokenTicker} · ${fmtUsd(notional, notional >= 1000 ? 0 : 2)}`
              : quoting
                ? "Getting a quote"
                : "Route unavailable";

  return (
    <div>
      <div className="space-y-6">
        {/* Side. The one that captures the gap is marked only when the board
            calls the gap a signal; the other side stays available for exits. */}
        <section>
          <div className="flex rounded-[var(--radius-sm)] border border-[var(--border)] p-0.5">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                aria-pressed={side === s}
                disabled={busy}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] py-2 text-[13px] font-medium transition-colors ${
                  side === s
                    ? "bg-[var(--raised)] text-white"
                    : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {s === "buy" ? "Buy" : "Sell"} {reading.tokenTicker}
                {gapIsSignal && s === gapSide && <Dot tone="down" />}
              </button>
            ))}
          </div>
          {hasGap && reading.basisBps !== null && (
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-3)]">
              {!gapIsSignal ? (
                reading.signal === "degraded_feed" ? (
                  "The real-share price has stopped updating, so this gap is not a reliable signal either way."
                ) : (
                  "Inside the noise floor — there is no gap to capture here, only costs to pay."
                )
              ) : against ? (
                <>
                  {side === "buy" ? "Buying" : "Selling"} here{" "}
                  <span className="text-[var(--up)]">pays</span> the{" "}
                  <span className="num">{gapPct}</span> {gapWord}. Worth it to exit, not to trade the gap.
                </>
              ) : (
                <>
                  {side === "buy" ? "Buying" : "Selling"}{" "}
                  <span className="text-[var(--down)]">captures</span> the{" "}
                  <span className="num">{gapPct}</span> {gapWord}.
                </>
              )}
            </p>
          )}
        </section>

        <section>
          <div className="flex items-baseline justify-between">
            <label
              htmlFor={`size-${reading.ticker}`}
              className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]"
            >
              Size
            </label>
            {balancesKnown && (
              <button
                type="button"
                onClick={() => setSize(side === "sell" ? tokenHeld * tokenPrice : usdcHeld, true)}
                className="text-[12px] text-[var(--text-3)] transition-colors hover:text-white"
                title="Use the full balance"
              >
                <span className="num">{fmtAmount(held)}</span> {payUnit} available ·{" "}
                <span className="text-[var(--accent)]">Max</span>
              </button>
            )}
          </div>

          <div className="mt-2 flex items-center rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--bg)] focus-within:border-[var(--accent)]">
            {unit === "usd" && <span className="pl-3 text-[15px] text-[var(--text-3)]">$</span>}
            <input
              id={`size-${reading.ticker}`}
              type="number"
              inputMode="decimal"
              min={0}
              step={unit === "usd" ? 100 : 0.01}
              value={input}
              disabled={busy}
              placeholder="0"
              onChange={(e) => setInput(e.target.value)}
              className="num w-full min-w-0 bg-transparent px-2 py-2.5 text-[16px] outline-none"
            />
            <span className="num mr-3 hidden shrink-0 text-[12px] text-[var(--text-3)] sm:inline">
              {sizeValid
                ? unit === "usd"
                  ? `≈ ${fmtAmount(tokens)} ${reading.tokenTicker}`
                  : `≈ ${fmtUsd(notional)}`
                : ""}
            </span>
            <div className="mr-1.5 flex shrink-0 rounded-[5px] bg-[var(--raised)] p-0.5 text-[11px]">
              {(["usd", "token"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => switchUnit(u)}
                  aria-pressed={unit === u}
                  className={`rounded-[4px] px-1.5 py-0.5 transition-colors ${
                    unit === u ? "bg-[var(--hover)] text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                  }`}
                >
                  {u === "usd" ? "USD" : reading.tokenTicker}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
              Net edge by size
            </span>
            <span className="text-[11px] text-[var(--text-3)]">live Jupiter quotes</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {SIZES.map((size) => {
              const active = Math.abs(notional - size) < 0.5;
              // Jupiter routes each request independently, so two quotes for
              // the same size can differ by tens of bps. The selected cell
              // uses the ticket's own quote — the one a swap would execute —
              // so the ladder and the Net edge line never disagree on screen.
              const q = active && quote?.available ? quote : ladder[size];
              const cellEdge = q?.available ? edgeAt(size, q.priceImpactBps ?? 0) : null;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSize(size)}
                  aria-pressed={active}
                  disabled={busy}
                  className={`rounded-[var(--radius-sm)] border px-2.5 py-2 text-left transition-colors ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  <span className={`num block text-[12px] ${active ? "text-[var(--accent)]" : "text-[var(--text-2)]"}`}>
                    ${size >= 1000 ? `${size / 1000}k` : size}
                  </span>
                  {!q ? (
                    <span className="skeleton mt-1.5 block h-3.5 w-12" aria-label="Quoting" />
                  ) : cellEdge ? (
                    <span
                      className="num mt-1 block text-[13px] font-medium"
                      style={{ color: cellEdge.netBps > 0 ? "var(--down)" : "var(--text-3)" }}
                    >
                      {fmtBps(cellEdge.netBps, 0)}
                    </span>
                  ) : (
                    <span className="mt-1 block text-[12px] text-[var(--text-3)]">no route</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
            Max slippage
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SLIPPAGE_OPTIONS.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => setSlippageBps(bps)}
                aria-pressed={slippageBps === bps}
                disabled={busy}
                className={`num rounded-[var(--radius-sm)] border px-2.5 py-1 text-[12px] transition-colors ${
                  slippageBps === bps
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-white"
                }`}
              >
                {(bps / 100).toFixed(bps < 100 ? 1 : 0)}%
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--radius)] bg-[var(--raised)] p-4">
          <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
            What survives at this size
          </div>
          <dl className="mt-3 space-y-2 text-[13px]">
            <Line label={against ? "Gap (paid)" : "Gross gap"} value={edge ? fmtBps(edge.grossBps, 1) : "—"} />
            <Line label="Swap fees" value={edge ? `−${edge.breakdown[0].bps.toFixed(1)}bps` : "—"} muted />
            <Line
              label="Price impact"
              value={quoting && !quote ? "…" : edge ? `−${edge.breakdown[1].bps.toFixed(1)}bps` : "—"}
              muted
              hint={quote?.available ? "measured" : "assumed"}
            />
            <Line label="Network fee" value={edge ? `−${edge.breakdown[2].bps.toFixed(1)}bps` : "—"} muted />
          </dl>
          <div className="hairline mt-3 flex items-baseline justify-between pt-3">
            <span className="whitespace-nowrap text-[13px] font-medium">Net edge</span>
            <span className="whitespace-nowrap text-right">
              <span className="num text-[22px] font-semibold" style={{ color: netColor }}>
                {edge ? fmtBps(edge.netBps, 1) : "—"}
              </span>
              <span className="num ml-2 text-[13px] text-[var(--text-2)]">
                {edge ? signedUsd(edge.netUsd) : ""}
              </span>
            </span>
          </div>
          {risk && edge && edge.netBps > 0 && (
            <div className="mt-1 flex items-baseline justify-between text-[12px]">
              <span className="text-[var(--text-3)]">
                At the {(slippageBps / 100).toFixed(slippageBps < 100 ? 1 : 0)}% slippage limit
              </span>
              <span
                className="num"
                style={{ color: risk.toleranceExceedsEdge ? "var(--up)" : "var(--text-3)" }}
              >
                {fmtBps(risk.worstNetBps, 1)}
              </span>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={hedgeable ? "accent" : "warn"}>{hedgeable ? "Hedgeable" : "Directional"}</Badge>
            {quote?.available && quote.route?.length ? (
              <span className="min-w-0 truncate text-[12px] text-[var(--text-3)]">
                via {quote.route.join(" → ")}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-2)]">
            {edge?.caveat ?? "Enter a size to price this trade."}
          </p>
        </section>

        {sizeValid && !quote?.available && !quoting && quote && (
          <p className="text-[12px] leading-relaxed text-[var(--text-3)]">{unquotedCopy(quote.reason)}</p>
        )}
        {risk?.toleranceExceedsEdge && !against && (
          <p className="text-[12px] leading-relaxed text-[var(--up)]">
            A fill at this slippage limit wipes out the edge. Tighten the tolerance or trade
            smaller — the gap is not wide enough to absorb {(slippageBps / 100).toFixed(1)}%.
          </p>
        )}
        {balanceError && (
          <p className="text-[12px] leading-relaxed text-[var(--text-3)]">{balanceError}</p>
        )}
      </div>

      {children && <div className="mt-8">{children}</div>}

      {/* The decision, pinned. Whatever is scrolled into view above — the
          chart, the alerts — what you pay, what you get, what survives and the
          button stay in one place. */}
      <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-8 border-t border-[var(--border)] bg-[var(--surface)] px-5 pt-4 pb-5 sm:-mx-6 sm:px-6">
        {tx.kind === "done" ? (
          <FilledCard tx={tx} tokenTicker={reading.tokenTicker} onReset={() => setTx({ kind: "idle" })} />
        ) : tx.kind === "unconfirmed" ? (
          <div
            className="rounded-[var(--radius)] border border-[var(--warn)]/25 bg-[var(--warn-soft)] px-4 py-3.5"
            role="status"
          >
            <div className="text-[14px] font-medium text-[var(--warn)]">Sent — not confirmed yet</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">
              The swap was submitted but the network has not confirmed it either way. It may
              still land. Check Solscan before trading again, or you could fill twice.
            </p>
            <div className="mt-2.5 flex gap-4 text-[12px]">
              <a
                className="text-white underline-offset-2 hover:underline"
                href={`https://solscan.io/tx/${tx.signature}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Check on Solscan
              </a>
              <button
                type="button"
                onClick={() => setTx({ kind: "idle" })}
                className="text-[var(--text-2)] underline-offset-2 hover:text-white hover:underline"
              >
                I&rsquo;ve checked · new trade
              </button>
            </div>
          </div>
        ) : (
          <>
            {tx.kind === "error" && (
              <div
                className="mb-3 rounded-[var(--radius-sm)] border border-[var(--up)]/25 bg-[var(--up-soft)] px-3.5 py-2.5"
                role="alert"
              >
                <p className="text-[13px] leading-relaxed">{tx.message}</p>
                {tx.signature && (
                  <a
                    className="mt-1 inline-block text-[12px] text-[var(--text-2)] underline-offset-2 hover:text-white hover:underline"
                    href={`https://solscan.io/tx/${tx.signature}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    View on Solscan
                  </a>
                )}
              </div>
            )}
            {shortfall && (
              <p className="mb-3 text-[12px] leading-relaxed text-[var(--warn)]">
                This trade needs <span className="num">{fmtAmount(needed)}</span> {payUnit}; the
                wallet holds <span className="num">{fmtAmount(held)}</span>.
              </p>
            )}

            <div className="mb-3 flex items-end justify-between gap-4">
              <div className="num min-w-0 text-[13px] leading-snug text-[var(--text-2)]">
                {sizeValid ? (
                  <>
                    <div className="truncate">
                      Pay <span className="text-white">{fmtAmount(needed)} {payUnit}</span>
                      {" → "}receive{" "}
                      {received !== null ? (
                        <span className="text-white">≈ {fmtAmount(received)} {receiveUnit}</span>
                      ) : (
                        <span className="skeleton inline-block h-3 w-16 align-middle" />
                      )}
                    </div>
                    <div className="truncate text-[12px] text-[var(--text-3)]">
                      {minReceived !== null
                        ? `At worst ${fmtAmount(minReceived)} ${receiveUnit} at your ${(slippageBps / 100).toFixed(1)}% limit`
                        : " "}
                    </div>
                  </>
                ) : (
                  "Enter a size to get a quote"
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-[15px] font-semibold" style={{ color: netColor }}>
                  {edge ? fmtBps(edge.netBps, 1) : "—"}
                </div>
                <div className="num text-[11px] text-[var(--text-3)]">
                  {edge ? `${signedUsd(edge.netUsd)} after round trip` : ""}
                </div>
              </div>
            </div>

            {!connected ? (
              <WalletButton size="lg" full dropUp label="Connect wallet to trade" />
            ) : (
              <Button full size="lg" disabled={!canSwap} loading={busy} onClick={() => void swap()}>
                {primaryLabel}
              </Button>
            )}

            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--text-3)]">
              <span>
                {tx.kind === "sending" && tx.signature ? (
                  <>
                    Submitted ·{" "}
                    <a
                      className="underline hover:text-white"
                      href={`https://solscan.io/tx/${tx.signature}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      track on Solscan
                    </a>
                  </>
                ) : (
                  "Routed by Jupiter · only your wallet can sign"
                )}
              </span>
              {quote?.available && !busy && <QuoteAge at={quotedAt} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Signed dollars with a true minus, matching the bps figures beside them. */
function signedUsd(value: number): string {
  if (Math.abs(value) < 0.005) return fmtUsd(0);
  return `${value > 0 ? "+" : "−"}${fmtUsd(Math.abs(value))}`;
}


function FilledCard({
  tx,
  tokenTicker,
  onReset,
}: {
  tx: Extract<TxState, { kind: "done" }>;
  tokenTicker: string;
  onReset: () => void;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--down)]/25 bg-[var(--down-soft)] px-4 py-3.5" role="status">
      <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--down)]">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Filled
      </div>
      <p className="num mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">
        {tx.side === "buy" ? (
          <>
            Bought {tx.received !== null ? `≈ ${fmtAmount(tx.received)}` : ""} {tokenTicker} for{" "}
            {fmtAmount(tx.spent)} USDC.
          </>
        ) : (
          <>
            Sold {fmtAmount(tx.spent)} {tokenTicker} for{" "}
            {tx.received !== null ? `≈ ${fmtAmount(tx.received)}` : ""} USDC.
          </>
        )}{" "}
        <span className="text-[var(--text-3)]">Exact fill on Solscan.</span>
      </p>
      <div className="mt-2.5 flex gap-4 text-[12px]">
        <a
          className="text-white underline-offset-2 hover:underline"
          href={`https://solscan.io/tx/${tx.signature}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          View on Solscan
        </a>
        <button
          type="button"
          onClick={onReset}
          className="text-[var(--text-2)] underline-offset-2 hover:text-white hover:underline"
        >
          New trade
        </button>
      </div>
    </div>
  );
}

/** How old the numbers above the button are — they refresh on their own. */
function QuoteAge({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return (
    <span className="num shrink-0" title="Quotes refresh every 15s and again before you sign">
      Quote {seconds < 2 ? "just now" : `${seconds}s old`}
    </span>
  );
}

/**
 * What to tell someone when there is no live route.
 *
 * The server's `detail` is written for whoever is debugging the deployment —
 * endpoint names, status codes, environment variables. None of that belongs on
 * a screen someone is about to trade from; it reads as broken rather than as
 * degraded. The diagnostics stay available at /api/health.
 */
function unquotedCopy(reason: string | undefined): string {
  const assumption = "The price impact above is an assumption rather than a measured quote.";
  switch (reason) {
    case "mints_not_configured":
      return `Routing is not enabled for this pair yet. ${assumption}`;
    case "unknown_ticker":
      return `This pair is not routable. ${assumption}`;
    default:
      return `No route available right now. ${assumption}`;
  }
}

function Line({
  label,
  value,
  muted,
  hint,
}: {
  label: string;
  value: string;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="flex items-baseline gap-1.5 text-[var(--text-2)]">
        {label}
        {hint && <span className="text-[11px] text-[var(--text-3)]">{hint}</span>}
      </dt>
      <dd className={`num ${muted ? "text-[var(--text-2)]" : "text-white"}`}>{value}</dd>
    </div>
  );
}
