"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { fmtAmount, SOL_FEE_RESERVE, SOL_MINT, TOKEN_ACCOUNT_RENT_SOL } from "@/lib/tokens";
import { describeTradeError, fromBaseUnits, jupiterOutAmount } from "@/lib/trade";
import { EXAMPLE_WALLET } from "@/lib/known-wallets";
import { pollConfirmation } from "@/lib/confirm";
import { requestBalancesRefresh, useBalances } from "./useBalances";
import { WalletButton } from "./WalletButton";
import { LimitOrder } from "./LimitOrder";
import { PoolDepth } from "./PoolDepth";
import { useDislocations } from "./useDislocations";
import { recordFill } from "./useJournal";
import { convergenceOutlook, untilOpen } from "@/lib/basis/convergence";
import { minutesToNextOpen } from "@/lib/market/session";
import { NARROWED_PCT } from "@/lib/data/market-history";

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
  inAmount?: string;
  inDecimals?: number;
  /** The other leg: USDC, or native SOL. */
  pay?: PayAsset;
  /** USD per unit of the pay asset. */
  payPriceUsd?: number;
  quote?: unknown;
}

type PayAsset = "USDC" | "SOL";
/** Below this much SOL, a swap cannot pay its own network fee. */
const MIN_FEE_SOL = 0.002;

type TxState =
  | { kind: "idle" }
  | { kind: "building" }
  | { kind: "signing" }
  | { kind: "sending"; signature?: string; since?: number }
  | { kind: "done"; signature: string; side: Side; spent: number; received: number | null; asset: PayAsset }
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
  pay: PayAsset;
}): Promise<Quote> {
  const params = new URLSearchParams({
    ticker: p.ticker,
    notional: String(p.notional),
    side: p.side,
    price: String(p.price),
    slippageBps: String(p.slippageBps),
    pay: p.pay,
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
  replayKind = "modelled",
  typical,
  children,
}: {
  reading: BasisReading;
  hedgeable: boolean;
  mints: MintMap | null;
  /** Set when the ticket is opened from a holding with an explicit Buy or Sell. */
  initialSide?: Side;
  /** A replayed, modelled scenario: the ticket explains, but nothing can be sent or simulated. */
  demo?: boolean;
  /** Which kind of frozen board this is: a real past moment, or the modelled shape. */
  replayKind?: "real" | "modelled";
  /** This pair's median |gap| over 48h of real history, open vs shut. */
  typical?: { openBps: number; shutBps: number };
  /**
   * Context rendered below the controls (chart, alerts). Passed in rather than
   * placed after the panel so the action bar stays pinned while it scrolls.
   */
  children?: ReactNode;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { balances, loading: loadingBalances, error: balanceError } = useBalances();
  // This pair's record at the open, last week: what a closed-market trade is betting on.
  const { rows: dislocations } = useDislocations();
  const opens = dislocations?.find((d) => d.ticker === reading.ticker)?.opens ?? [];

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
  // Now = a swap at today's price. Limit = an on-chain order that waits for a gap.
  const [mode, setMode] = useState<"now" | "limit">("now");

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
  const solHeld = balances.get(SOL_MINT)?.amount ?? 0;
  // A first buy of a token also opens its account, which parks rent in it.
  const needsAccount = !!tokenMint && !balances.has(tokenMint);
  // SOL is spendable above the swap's own costs, and no further: holding back
  // more than the fees need would put part of a small wallet out of reach.
  const solReserve = SOL_FEE_RESERVE + (side === "buy" && needsAccount ? TOKEN_ACCOUNT_RENT_SOL : 0);
  const solSpendable = Math.max(0, solHeld - solReserve);

  // Pay (or receive) in USDC or native SOL. Chosen for the wallet once its
  // balances are known — a wallet with SOL and no USDC should not have to find
  // the switch — and never changed again after the person picks one.
  const [payAsset, setPayAsset] = useState<PayAsset>("USDC");
  const payPicked = useRef(false);
  const [solPrice, setSolPrice] = useState<number | null>(null);

  // What this trade would actually cost, in the asset being spent.
  const needed =
    side === "sell" ? tokens : payAsset === "SOL" ? (solPrice ? notional / solPrice : 0) : notional;
  const held = side === "sell" ? tokenHeld : payAsset === "SOL" ? solSpendable : usdcHeld;
  const payUnit = side === "sell" ? reading.tokenTicker : payAsset;
  const balancesKnown = connected && !loadingBalances && !balanceError;
  // The largest trade this wallet can actually place right now, in USD.
  const maxUsd =
    side === "sell" ? tokenHeld * tokenPrice : payAsset === "SOL" ? solSpendable * (solPrice ?? 0) : usdcHeld;
  // Only claim a shortfall once balances have actually been read.
  const shortfall = balancesKnown && sizeValid && held < needed * 0.9999;
  // Every swap pays its network fee in SOL, whatever it trades.
  const feeShortfall = balancesKnown && solHeld < MIN_FEE_SOL;


  const busy = tx.kind === "building" || tx.kind === "signing" || tx.kind === "sending";

  useEffect(() => {
    if (payPicked.current || !balancesKnown) return;
    if (usdcHeld < MIN_NOTIONAL_USD && solSpendable > 0) setPayAsset("SOL");
  }, [balancesKnown, usdcHeld, solSpendable]);
  const pickPay = (next: PayAsset) => {
    payPicked.current = true;
    setPayAsset(next);
  };

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
  }, [side, payAsset]);

  // SOL's price rides along with every SOL quote.
  useEffect(() => {
    if (quote?.available && quote.pay === "SOL" && quote.payPriceUsd) setSolPrice(quote.payPriceUsd);
  }, [quote]);

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
            pay: payAsset,
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
  }, [reading.ticker, tokenPrice, notional, side, slippageBps, sizeValid, tick, payAsset]);

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
              await fetchQuote({ ticker: reading.ticker, notional: size, side, price: tokenPrice, slippageBps, pay: payAsset }),
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
  }, [reading.ticker, side, slippageBps, tick, tokenPrice > 0, payAsset]);

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
  // What this pair's own opens say about the gap on screen. Only meaningful
  // while the share cannot trade — that is the bet the clock is about.
  const outlook = useMemo(
    () =>
      !hedgeable && gapIsSignal && opens.length > 0 && reading.basisBps !== null
        ? convergenceOutlook(opens, reading.basisBps, edge?.costBps ?? DEFAULT_COSTS.priceImpactBps * 2)
        : null,
    [hedgeable, gapIsSignal, opens, reading.basisBps, edge?.costBps],
  );

  const received = quote?.available ? fromBaseUnits(quote.outAmount, quote.outDecimals) : null;
  const minReceived = quote?.available
    ? fromBaseUnits(quote.minOutAmount ?? undefined, quote.outDecimals)
    : null;
  const receiveUnit = side === "buy" ? reading.tokenTicker : payAsset;

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
    const live = await fetchQuote({ ticker: reading.ticker, notional, side, price: tokenPrice, slippageBps, pay: payAsset });
    setQuote(live);
    setQuotedAt(Date.now());
    if (!live.available || !live.quote) throw new Error("No route");
    return live;
  }, [quote, quotedAt, reading.ticker, notional, side, tokenPrice, slippageBps, payAsset]);

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
      setTx({ kind: "sending", signature, since: Date.now() });

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
        asset: payAsset,
        // What left the wallet, in its own unit: the quote's exact input.
        ...(side === "buy" && live.inAmount ? { spent: fromBaseUnits(live.inAmount, live.inDecimals) ?? spent } : {}),
      });
      requestBalancesRefresh();
      // The entry price for P&L, read back from what actually moved.
      if (tokenMint && quoteMint) {
        void recordFill(connection, signature, publicKey.toBase58(), reading.ticker, tokenMint,
          payAsset === "SOL"
            ? { mint: SOL_MINT, priceUsd: live.payPriceUsd ?? solPrice ?? 0 }
            : { mint: quoteMint, priceUsd: 1 });
      }
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
    tokenMint,
    quoteMint,
    reading.ticker,
    payAsset,
    solPrice,
  ]);

  const canSwap =
    connected && sizeValid && quote?.available === true && !busy && !shortfall && !feeShortfall;
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
      : feeShortfall
        ? "Needs a little SOL for fees"
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
              body: `The ${gapPct} gap is inside the noise floor. Trading it only pays fees.`,
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
        {outlook && <ConvergenceClock outlook={outlook} reading={reading} sizeUsd={notional} />}

        <Verdict
          {...verdict}
          body={
            demo
              ? `${verdict.body} ${
                  replayKind === "real"
                    ? "Replay: this gap really happened; the costs and quotes are live."
                    : "Replay: the gap is modelled, the costs are live."
                }`.trim()
              : [
                  verdict.body,
                  [
                    typical
                      ? `Typical for ${reading.tokenTicker} over 48h: ~${Math.round(typical.openBps)}bps while the share trades, ~${Math.round(typical.shutBps)}bps while it is shut`
                      : "",
                    // The convergence clock below says how that bet has gone.
                    "",
                  ]
                    .filter(Boolean)
                    .join("; ")
                    .replace(/.$/, (c) => `${c}.`),
                  // Nothing pays now: point at the tool that waits for it.
                  mode === "now" && (verdict.tone === "bad" || verdict.tone === "neutral")
                    ? "Or set a limit at a gap and let it fill when one opens."
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")
          }
        />

        {!demo && (
          <div className="flex rounded-[var(--radius-sm)] bg-[var(--raised)] p-0.5 text-[12px]" role="tablist">
            {([
              ["now", "Trade now"],
              ["limit", "Limit at a gap"],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                disabled={busy}
                className={`flex-1 rounded-[5px] py-1.5 font-medium transition-colors ${
                  mode === m ? "bg-[var(--hover)] text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
                onClick={() =>
                  setSize(
                    side === "sell"
                      ? tokenHeld * tokenPrice
                      : payAsset === "SOL"
                        ? solSpendable * (solPrice ?? 0)
                        : usdcHeld,
                    true,
                  )
                }
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

          {/* The other leg of the swap. Limit orders stay in USDC. */}
          {mode === "now" && !demo && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)]">
                {side === "sell" ? "Receive in" : "Pay with"}
              </span>
              <div className="flex rounded-[8px] border border-white/10 bg-black/30 p-0.5" role="group" aria-label={side === "sell" ? "Receive in" : "Pay with"}>
                {(["USDC", "SOL"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => pickPay(a)}
                    aria-pressed={payAsset === a}
                    disabled={busy}
                    className={`flex items-center gap-1.5 rounded-[6px] px-3 py-1 text-[12px] font-medium transition-colors ${
                      payAsset === a ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                    }`}
                  >
                    {a}
                    {balancesKnown && (
                      <span className="num font-normal text-[var(--text-3)]">{fmtAmount(a === "SOL" ? solHeld : usdcHeld)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "now" && (
          <>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
              Net edge by size
            </span>
            <span className="text-[11px] text-[var(--text-3)]">live Jupiter quotes</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
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
          </>
          )}
        </section>

        {mode === "now" && (
        <>
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
            <span className="num hidden text-[var(--text-3)] sm:inline">
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
          {/* What the measured impact is actually measuring against. */}
          <PoolDepth ticker={reading.ticker} notionalUsd={notional} />
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
        </>
        )}
        {balanceError && (
          <p className="text-[12px] leading-relaxed text-[var(--text-3)]">{balanceError}</p>
        )}
      </div>

      {mode === "limit" && !demo ? (
        <LimitOrder
          reading={reading}
          side={side}
          sizeUsd={notional}
          sizeValid={sizeValid}
          mints={mints}
          shortfall={shortfall}
          payUnit={payUnit}
        >
          {children}
        </LimitOrder>
      ) : (
        <>
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
                wallet {payUnit === "SOL" ? "can spend" : "holds"} <span className="num">{fmtAmount(held)}</span>
                {payUnit === "SOL" && (
                  <>
                    {" "}
                    of its <span className="num">{fmtAmount(solHeld)}</span>, keeping{" "}
                    <span className="num">{solReserve.toFixed(4)}</span> back for the fee
                    {needsAccount ? " and this token's account rent" : ""}
                  </>
                )}
                .{" "}
                {maxUsd >= MIN_NOTIONAL_USD && (
                  <button
                    type="button"
                    onClick={() => setSize(maxUsd, true)}
                    className="text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    Trade {fmtUsd(maxUsd, maxUsd >= 1000 ? 0 : 2)} instead
                  </button>
                )}
              </p>
            )}
            {feeShortfall && (
              <p className="mb-3 text-[12px] leading-relaxed text-[var(--warn)]">
                Every Solana transaction pays its fee in SOL, and this wallet has{" "}
                <span className="num">{fmtAmount(solHeld)}</span>. Add about 0.01 SOL to trade.
              </p>
            )}
            {balancesKnown && needsAccount && side === "buy" && !shortfall && !feeShortfall && sizeValid && (
              <p className="mb-3 text-[12px] leading-relaxed text-[var(--text-3)]">
                First {reading.tokenTicker} in this wallet: the swap also opens its token account, which holds
                about {TOKEN_ACCOUNT_RENT_SOL} SOL of rent (refundable if the account is closed). It is not
                counted in your entry price.
              </p>
            )}

            {!demo && <Steps steps={steps} />}

            <div className="mb-3 flex items-end justify-between gap-4">
              <div className="num min-w-0 text-[13px] leading-snug text-[var(--text-2)]">
                {sizeValid ? (
                  <>
                    <div className="sm:truncate">
                      Pay <span className="text-white">{fmtAmount(needed)} {payUnit}</span>
                      {" → "}receive{" "}
                      {received !== null ? (
                        <span className="text-white">≈ {fmtAmount(received)} {receiveUnit}</span>
                      ) : (
                        <span className="skeleton inline-block h-3 w-16 align-middle" />
                      )}
                    </div>
                    <div className="text-[12px] text-[var(--text-3)] sm:truncate">
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
                <span className="font-medium text-[var(--warn)]">Replay · trading is off.</span>{" "}
                {replayKind === "real"
                  ? "These are real trades from a past moment; quotes and costs are live."
                  : "The gap here is modelled; quotes and costs are live."}{" "}
                Go back to live prices to trade or dry-run.
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
                  <Confirming signature={tx.signature} since={tx.since ?? Date.now()} />
                ) : (
                  "Routed by Jupiter · only your wallet can sign"
                )}
              </span>
              {quote?.available && !busy && <QuoteAge at={quotedAt} />}
            </div>
          </>
        )}
      </div>
        </>
      )}
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
            {fmtAmount(tx.spent)} {tx.asset}.
          </>
        ) : (
          <>
            Sold {fmtAmount(tx.spent)} {tokenTicker} for{" "}
            {tx.received !== null ? `≈ ${fmtAmount(tx.received)}` : ""} {tx.asset}.
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
      className="relative overflow-hidden rounded-[var(--radius)] border py-3.5 pr-4 pl-4"
      style={{
        borderColor: tone === "neutral" ? "rgba(255,255,255,0.09)" : `color-mix(in srgb, ${VERDICT_COLOR[tone]} 35%, transparent)`,
        background: `linear-gradient(135deg, color-mix(in srgb, ${VERDICT_COLOR[tone]} ${tone === "neutral" ? 4 : 12}%, transparent), rgba(255,255,255,0.015) 60%)`,
        boxShadow: `inset 3px 0 0 ${VERDICT_COLOR[tone]}${tone === "neutral" ? "" : `, 0 12px 40px -18px ${VERDICT_COLOR[tone]}`}`,
      }}
      role="status"
    >
      <div className="text-[16px] font-semibold tracking-[-0.015em]" style={{ color: tone === "neutral" ? "var(--text)" : VERDICT_COLOR[tone] }}>
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
    <ol className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]" aria-label="Trade steps">
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

/**
 * The minute between submit and verdict, made legible. Most swaps confirm in a
 * few seconds; one that has not by 20s is either congested or will never land,
 * and the honest thing is to say which outcomes are possible and when.
 */
function Confirming({ signature, since }: { signature: string; since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return (
    <>
      Submitted · <span className="num">{seconds}s</span> ·{" "}
      <a
        className="underline hover:text-white"
        href={`https://solscan.io/tx/${signature}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        track on Solscan
      </a>
      {seconds >= 20 && (
        <span className="text-[var(--warn)]">
          {" "}
          · slower than usual — it will land or expire within ~90s; nothing fills twice
        </span>
      )}
    </>
  );
}

/**
 * The bet a closed-market trade is actually making, with a clock on it.
 *
 * "It converges by the open" is the claim; this is the pair's own record of
 * doing that, applied to the gap on screen, after costs. The worst open stays
 * in view because a median is not a promise, and five opens is a base rate,
 * not a forecast.
 */
function ConvergenceClock({
  outlook,
  reading,
  sizeUsd,
}: {
  outlook: NonNullable<ReturnType<typeof convergenceOutlook>>;
  reading: BasisReading;
  sizeUsd: number;
}) {
  const [minutes, setMinutes] = useState<number | null>(() => minutesToNextOpen());
  useEffect(() => {
    const id = setInterval(() => setMinutes(minutesToNextOpen()), 30_000);
    return () => clearInterval(id);
  }, []);
  const countdown = untilOpen(minutes);
  const gap = Math.abs(reading.basisBps ?? 0);
  const pays = (outlook.netBps ?? 0) > 0;
  // A median that went the other way is the point, not an edge case: say so.
  const widens = (outlook.medianClosedPct ?? 0) < 0;
  const usd = outlook.netBps === null ? null : (outlook.netBps / 10_000) * sizeUsd;

  return (
    <section
      className="rounded-[var(--radius)] border border-white/[0.08] bg-white/[0.02] px-4 py-3.5"
      aria-label="Convergence clock"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)]">
          Does it close at the open?
        </span>
        <span className="mono text-[11px] text-[var(--text-2)]">
          {countdown ? <>next open in <span className="text-white">{countdown}</span></> : "at the next open"}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="display num text-[30px] leading-none"
          style={{ color: widens ? "var(--up)" : "var(--down)" }}
        >
          {outlook.medianClosedPct === null ? "—" : `${Math.abs(Math.round(outlook.medianClosedPct))}%`}
        </span>
        <span className="text-[12px] leading-snug text-[var(--text-2)]">
          of the gap {widens ? "added" : "closed"} at this pair&rsquo;s median open ·{" "}
          <span className="num text-white">
            {outlook.narrowed} of {outlook.total}
          </span>{" "}
          narrowed
        </span>
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-3)]">
        Behave like that median and today&rsquo;s {Math.round(gap)}bps gap{" "}
        {widens ? "widens by" : "closes by"}{" "}
        <span className="num text-[var(--text-2)]">{Math.abs(Math.round(outlook.expectedBps ?? 0))}bps</span> —{" "}
        <span className="num" style={{ color: pays ? "var(--down)" : "var(--up)" }}>
          {pays ? "+" : "−"}
          {Math.abs(Math.round(outlook.netBps ?? 0))}bps
        </span>{" "}
        after costs
        {usd !== null && sizeUsd > 0 && (
          <>
            , {usd >= 0 ? "+" : "−"}
            {fmtUsd(Math.abs(usd))} at {fmtUsd(sizeUsd, sizeUsd >= 1000 ? 0 : 2)}
          </>
        )}
        .{" "}
        {outlook.worstClosedPct !== null && outlook.worstClosedPct < 0 && (
          <>Its worst open widened the gap by {Math.abs(Math.round(outlook.worstClosedPct))}%. </>
        )}
        {outlook.total} opens is a base rate, not a forecast.
      </p>
    </section>
  );
}
