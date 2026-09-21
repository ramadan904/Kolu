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
import { describeTradeError, fromBaseUnits, jupiterOutAmount } from "@/lib/trade";
import { EXAMPLE_WALLET } from "@/lib/known-wallets";
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
  | { kind: "error"; message: string; signature?: string; stage: Stage };

/** Where a trade is in its life. Drives the step tracker and says where a failure happened. */
type Stage = "quote" | "build" | "simulate" | "sign" | "confirm";

/**
 * A no-wallet dry run: the exact Jupiter transaction, built for a public funded
 * wallet and simulated on mainnet. Nothing is signed or sent.
 */
type DryRun =
  | { kind: "idle" }
  | { kind: "running"; stage: "build" | "simulate" }
  | { kind: "ok"; out: number | null; units: number | null }
  | { kind: "failed"; message: string; stage: "quote" | "build" | "simulate" };

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
  demo = false,
  children,
}: {
  reading: BasisReading;
  hedgeable: boolean;
  mints: MintMap | null;
  /** Set when the ticket is opened from a holding with an explicit Buy or Sell. */
  initialSide?: Side;
  /** A replayed, modelled scenario: the ticket explains, but nothing can be sent or simulated. */
  demo?: boolean;
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
  const [dry, setDry] = useState<DryRun>({ kind: "idle" });

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
    setDry({ kind: "idle" });
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

  // Never build against a quote the market has moved away from. Shared by the
  // real swap and the dry run, so the dry run proves the path a trade takes.
  const freshQuote = useCallback(async (): Promise<Quote> => {
    if (quote?.available && quote.quote && Date.now() - quotedAt <= QUOTE_TTL_MS) return quote;
    const live = await fetchQuote({ ticker: reading.ticker, notional, side, price: tokenPrice, slippageBps });
    setQuote(live);
    setQuotedAt(Date.now());
    if (!live.available || !live.quote) throw new Error("No route");
    return live;
  }, [quote, quotedAt, reading.ticker, notional, side, tokenPrice, slippageBps]);

  const buildSwap = useCallback(async (live: Quote, owner: string) => {
    const res = await fetch("/api/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote: live.quote, userPublicKey: owner }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Swap build failed (${res.status})`);
    return VersionedTransaction.deserialize(Buffer.from(body.swapTransaction as string, "base64"));
  }, []);

  /**
   * Everything a trade does short of the signature, for real: fresh quote,
   * the exact Jupiter transaction, simulated on mainnet. Built for a public
   * funded wallet because simulation needs a payer that holds the input; it
   * is never signed or sent, and the screen says whose wallet it simulated.
   */
  const dryRun = useCallback(async () => {
    if (!sizeValid) return;
    let stage: "quote" | "build" | "simulate" = "quote";
    try {
      setDry({ kind: "running", stage: "build" });
      const live = await freshQuote();
      stage = "build";
      const transaction = await buildSwap(live, EXAMPLE_WALLET.address);
      stage = "simulate";
      setDry({ kind: "running", stage: "simulate" });
      const sim = await connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
      });
      if (sim.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).slice(-3).join(" ")}`);
      }
      const raw = jupiterOutAmount(sim.value.logs, sim.value.returnData ?? null);
      setDry({
        kind: "ok",
        out: raw !== null && live.outDecimals !== undefined ? Number(raw) / 10 ** live.outDecimals : null,
        units: sim.value.unitsConsumed ?? null,
      });
    } catch (err) {
      setDry({ kind: "failed", stage, message: describeTradeError(err, { slippageBps, payUnit }) });
    }
  }, [sizeValid, freshQuote, buildSwap, connection, slippageBps, payUnit]);

  const swap = useCallback(async () => {
    if (!publicKey || !signTransaction || !sizeValid) return;
    let signature: string | undefined;
    let stage: Stage = "quote";
    const spent = side === "buy" ? notional : tokens;
    try {
      setTx({ kind: "building" });
      const live = await freshQuote();
      stage = "build";
      const transaction = await buildSwap(live, publicKey.toBase58());
      // Taken before signing: the expiry that matters is the one of the
      // blockhash baked into this transaction, not one fetched after sending.
      const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

      stage = "sign";
      setTx({ kind: "signing" });
      const signed = await signTransaction(transaction);

      stage = "confirm";
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
      setTx({ kind: "error", message: describeTradeError(err, { slippageBps, payUnit }), signature, stage });
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
    freshQuote,
    buildSwap,
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

  const quoteStep: StepState = quote?.available
    ? "done"
    : quoting
      ? "active"
      : sizeValid && quote
        ? "failed"
        : "todo";
  const walletOrder: Stage[] = ["quote", "build", "sign", "confirm"];
  const txStage: Stage | null =
    tx.kind === "building"
      ? "build"
      : tx.kind === "signing"
        ? "sign"
        : tx.kind === "sending" || tx.kind === "unconfirmed"
          ? "confirm"
          : tx.kind === "error"
            ? tx.stage
            : null;
  const walletStep = (stage: Stage): StepState => {
    if (tx.kind === "done") return "done";
    if (!txStage) return stage === "quote" ? quoteStep : "todo";
    const at = walletOrder.indexOf(txStage);
    const here = walletOrder.indexOf(stage);
    if (here < at) return "done";
    if (here === at) return tx.kind === "error" ? "failed" : "active";
    return "todo";
  };
  const dryStep = (stage: "build" | "simulate"): StepState => {
    if (dry.kind === "ok") return "done";
    if (dry.kind === "running") {
      if (dry.stage === stage) return "active";
      return stage === "build" ? "done" : "todo";
    }
    if (dry.kind === "failed") {
      if (dry.stage === stage || (stage === "build" && dry.stage === "quote")) return "failed";
      return stage === "build" && dry.stage === "simulate" ? "done" : "todo";
    }
    return "todo";
  };
  const steps: { label: string; state: StepState; hint?: string }[] = connected
    ? [
        { label: "Quote", state: walletStep("quote") },
        { label: "Build", state: walletStep("build") },
        { label: "Approve in wallet", state: walletStep("sign") },
        { label: "Confirm", state: walletStep("confirm") },
      ]
    : [
        { label: "Quote", state: quoteStep },
        { label: "Build", state: dryStep("build") },
        { label: "Simulate", state: dryStep("simulate") },
        { label: "Sign", state: "locked", hint: "needs a wallet" },
      ];

  // The recommendation, stated first. Everything below it is the working.
  const sizeLabel = fmtUsd(notional, notional >= 1000 ? 0 : 2);
  const bestSize = SIZES.map((size) => {
    const q = ladder[size];
    const e = q?.available ? edgeAt(size, q.priceImpactBps ?? 0) : null;
    return { size, net: e?.netBps ?? null };
  })
    .filter((c): c is { size: number; net: number } => c.net !== null && c.net > 0)
    .sort((a, b) => b.net - a.net)[0];
  const verdict: { tone: "good" | "caution" | "bad" | "neutral"; title: string; body: string } =
    reading.basisBps === null || !reading.token || !reading.equity
      ? { tone: "neutral", title: "No price to trade against", body: "One of the two feeds is missing." }
      : !gapIsSignal
        ? reading.signal === "degraded_feed"
          ? {
              tone: "neutral",
              title: "Hold · the real-share feed has stalled",
              body: "Kolu will not call a gap against a reference that stopped updating.",
            }
          : {
              tone: "neutral",
              title: "Hold · priced in line",
              body: `The ${gapPct} gap is inside the oracles’ noise floor. Trading it only pays fees.`,
            }
        : against
          ? {
              tone: "caution",
              title: `Exit only · ${side === "buy" ? "buying" : "selling"} pays the ${gapWord}`,
              body: edge ? `Costs ${Math.round(-edge.netBps)}bps (${signedUsd(edge.netUsd)}) at ${sizeLabel}. Use it to close a position, not to trade the gap.` : "",
            }
          : edge && edge.netBps > 0
            ? {
                tone: edge.tone === "good" ? "good" : "caution",
                title: `${side === "sell" ? "Sell" : "Buy"} ${reading.tokenTicker} · ${fmtBps(edge.netBps, 0)} survives at ${sizeLabel}`,
                body: `≈ ${signedUsd(edge.netUsd)} after fees and measured impact.${hedgeable ? "" : " Directional: it pays only if the gap closes by the open."}`,
              }
            : {
                tone: "bad",
                title: `No trade at ${sizeLabel}`,
                body: bestSize
                  ? `Costs exceed the gap at this size, but ${bestSize.size >= 1000 ? `${bestSize.size / 1000}k` : bestSize.size} clears ${fmtBps(bestSize.net, 0)}.`
                  : edge
                    ? `Fees and impact outweigh the ${gapPct} ${gapWord} by ${Math.round(-edge.netBps)}bps at every size quoted.`
                    : "Waiting for a quote.",
              };

  return (
    <div>
      <div className="space-y-6">
        <Verdict
          {...verdict}
          body={demo ? `${verdict.body} Replay: the gap is modelled, the costs are live.`.trim() : verdict.body}
        />

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
          {hasGap && reading.basisBps !== null && gapIsSignal && (
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

        <section className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
            Max slippage
          </div>
          <div className="flex flex-wrap gap-1.5">
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

        {/* The working behind the verdict. Folded: the verdict and the pinned
            bar carry the numbers that decide; this is for checking them. */}
        <details className="group rounded-[var(--radius)] bg-[var(--raised)] px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2 text-[var(--text-2)]">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="transition-transform group-open:rotate-90">
                <path d="M3 1.5L6.5 5 3 8.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              How the net edge is worked out
            </span>
            <span className="num text-[var(--text-3)]">
              {edge
                ? `${fmtBps(edge.grossBps, 0)} gap − ${Math.round(edge.costBps)}bps costs`
                : "—"}
            </span>
          </summary>
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
        </details>

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

            {!demo && <Steps steps={steps} />}

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

            {demo ? (
              <p className="rounded-[var(--radius-sm)] border border-[var(--warn)]/25 bg-[var(--warn-soft)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--text-2)]">
                <span className="font-medium text-[var(--warn)]">Replay · trading is off.</span> The gap
                here is modelled; quotes and costs are live. Go back to live prices to trade or
                dry-run.
              </p>
            ) : !connected ? (
              <>
                {dry.kind === "ok" && (
                  <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--down)]/25 bg-[var(--down-soft)] px-3.5 py-2.5" role="status">
                    <div className="text-[13px] font-medium text-[var(--down)]">Dry run passed on mainnet</div>
                    <p className="num mt-0.5 text-[12px] leading-relaxed text-[var(--text-2)]">
                      This exact Jupiter transaction executes right now
                      {dry.out !== null ? (
                        <>
                          {" "}and delivers{" "}
                          <span className="text-white">
                            {fmtAmount(dry.out)} {receiveUnit}
                          </span>
                        </>
                      ) : null}
                      {dry.units ? ` · ${Math.round(dry.units / 1000)}k compute units` : ""}. Simulated
                      from the {EXAMPLE_WALLET.label} (a public wallet) — nothing was signed or sent.
                    </p>
                  </div>
                )}
                {dry.kind === "failed" && (
                  <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--up)]/25 bg-[var(--up-soft)] px-3.5 py-2.5" role="alert">
                    <p className="text-[13px] leading-relaxed">Dry run stopped at {dry.stage}: {dry.message}</p>
                  </div>
                )}
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <WalletButton size="lg" full dropUp label="Connect wallet to trade" />
                  <Button
                    size="lg"
                    variant="secondary"
                    loading={dry.kind === "running"}
                    disabled={!sizeValid || dry.kind === "running"}
                    onClick={() => void dryRun()}
                    title="Build the real transaction and simulate it on mainnet — nothing is signed or sent"
                  >
                    {dry.kind === "running" ? "Simulating" : dry.kind === "ok" ? "Run again" : "Dry run"}
                  </Button>
                </div>
              </>
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

const VERDICT_COLOR = {
  good: "var(--down)",
  caution: "var(--warn)",
  bad: "var(--up)",
  neutral: "var(--text-3)",
} as const;

/** The answer first: what to do, in one line, and why in the next. */
function Verdict({
  tone,
  title,
  body,
}: {
  tone: keyof typeof VERDICT_COLOR;
  title: string;
  body: string;
}) {
  return (
    <div
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--raised)] py-3 pr-4 pl-3.5"
      style={{ boxShadow: `inset 3px 0 0 ${VERDICT_COLOR[tone]}` }}
      role="status"
    >
      <div className="text-[15px] font-semibold tracking-[-0.01em]" style={{ color: tone === "neutral" ? "var(--text)" : VERDICT_COLOR[tone] }}>
        {title}
      </div>
      {body && <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-2)]">{body}</p>}
    </div>
  );
}

type StepState = "done" | "active" | "todo" | "locked" | "failed";

/**
 * The whole path a trade takes, visible before anyone commits to it — so the
 * ticket never looks like it ends at a button. A locked step says what it needs.
 */
function Steps({ steps }: { steps: { label: string; state: StepState; hint?: string }[] }) {
  const dot: Record<StepState, string> = {
    done: "var(--down)",
    active: "var(--accent)",
    todo: "var(--border-strong)",
    locked: "var(--border-strong)",
    failed: "var(--up)",
  };
  return (
    <ol className="mb-3 flex items-center gap-1.5 text-[11px]" aria-label="Trade steps">
      {steps.map((step, i) => (
        <li key={step.label} className="flex min-w-0 items-center gap-1.5" title={step.hint}>
          {i > 0 && <span className="h-px w-3 shrink-0 bg-[var(--border-strong)]" aria-hidden="true" />}
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${step.state === "active" ? "live-dot" : ""}`}
            style={{ background: dot[step.state] }}
            aria-hidden="true"
          />
          <span
            className="whitespace-nowrap"
            style={{
              color:
                step.state === "done"
                  ? "var(--text-2)"
                  : step.state === "active"
                    ? "var(--text)"
                    : step.state === "failed"
                      ? "var(--up)"
                      : "var(--text-3)",
            }}
          >
            {step.label}
            {step.state === "locked" && step.hint ? (
              <span className="text-[var(--text-3)]"> · {step.hint}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
