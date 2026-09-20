/**
 * Jupiter quote adapter — turns an assumed price impact into a measured one.
 *
 * The edge panel's default is a slider you set yourself, which is honest but
 * soft: the number that actually decides a trade is what the router says it
 * will cost to move your size right now. This asks.
 *
 * It is deliberately quote-only. Kolu does not build, sign or send a
 * transaction, and holds no key material.
 */

import { fetchJsonWithRetry } from "./http";
import { PriceSourceError } from "./types";

const DEFAULT_ENDPOINT = "https://lite-api.jup.ag";

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  /** Integer base units of the input mint. */
  amount: bigint;
  slippageBps?: number;
}

export interface RouteQuote {
  inAmount: bigint;
  outAmount: bigint;
  /** Price impact in bps, converted from Jupiter's decimal fraction. */
  priceImpactBps: number;
  /** AMMs the route passes through, for display. */
  route: string[];
  /**
   * Jupiter's own quote object, passed back verbatim when building the swap.
   * It is opaque on purpose: re-deriving or editing any of it is how routes
   * end up executing at a price the user never saw.
   */
  raw: unknown;
}

export interface QuoteSource {
  getQuote(request: QuoteRequest): Promise<RouteQuote>;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new PriceSourceError(`${context}: expected an object`);
  }
  return value as Record<string, unknown>;
}

/** Jupiter returns amounts as decimal strings that can exceed Number.MAX_SAFE_INTEGER. */
function asBigInt(value: unknown, context: string): bigint {
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new PriceSourceError(`${context}: expected an integer amount, got ${String(value)}`);
}

export class JupiterSource implements QuoteSource {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  private readonly attempts: number;
  private readonly sleep?: (ms: number) => Promise<void>;

  constructor(
    options: {
      endpoint?: string;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
      attempts?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.attempts = options.attempts ?? 3;
    this.sleep = options.sleep;
  }

  async getQuote(request: QuoteRequest): Promise<RouteQuote> {
    if (request.amount <= 0n) {
      throw new PriceSourceError("Quote amount must be positive");
    }

    const params = new URLSearchParams({
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amount: request.amount.toString(),
      slippageBps: String(request.slippageBps ?? 50),
    });

    const body = await fetchJsonWithRetry(
      `${this.endpoint}/swap/v1/quote?${params}`,
      "Jupiter quote",
      {
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        attempts: this.attempts,
        sleep: this.sleep,
      },
    );

    const rec = asRecord(body, "Jupiter quote");

    // priceImpactPct is a decimal fraction ("0.0023" = 23bps), not a percentage.
    // Reading it as a percentage understates impact by 100x, which would turn
    // every unprofitable trade on the board into a profitable-looking one.
    const rawImpact = rec.priceImpactPct;
    const impact =
      typeof rawImpact === "string" ? Number(rawImpact) : typeof rawImpact === "number" ? rawImpact : NaN;
    if (!Number.isFinite(impact)) {
      throw new PriceSourceError("Jupiter quote: priceImpactPct was not a number");
    }

    const routePlan = Array.isArray(rec.routePlan) ? rec.routePlan : [];
    const route = routePlan
      .map((leg) => {
        const info = asRecord(leg, "route leg").swapInfo;
        const label = typeof info === "object" && info !== null
          ? (info as Record<string, unknown>).label
          : null;
        return typeof label === "string" ? label : null;
      })
      .filter((label): label is string => label !== null);

    return {
      inAmount: asBigInt(rec.inAmount, "Jupiter quote inAmount"),
      outAmount: asBigInt(rec.outAmount, "Jupiter quote outAmount"),
      priceImpactBps: Math.abs(impact) * 10_000,
      route,
      raw: rec,
    };
  }

  /**
   * Exchanges a quote for an unsigned transaction.
   *
   * The quote goes back exactly as Jupiter returned it. Kolu never signs, never
   * holds a key, and never sees one — the returned base64 is handed to the
   * user's wallet, which is the only thing that can authorise it.
   */
  async buildSwap(quote: unknown, userPublicKey: string): Promise<string> {
    const res = await this.fetchImpl(`${this.endpoint}/swap/v1/swap`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { priorityLevel: "medium", maxLamports: 4_000_000 } },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new PriceSourceError(
        `Jupiter swap build returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }

    const body = asRecord(await res.json(), "Jupiter swap");
    const tx = body.swapTransaction;
    if (typeof tx !== "string" || tx.length === 0) {
      throw new PriceSourceError("Jupiter swap: swapTransaction was missing");
    }
    return tx;
  }
}

/** Converts a USD notional into integer base units of the quote mint. */
export function toBaseUnits(notionalUsd: number, decimals: number): bigint {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    throw new PriceSourceError(`Invalid notional: ${notionalUsd}`);
  }
  // Via string to avoid float error creeping into the integer amount.
  const scaled = (notionalUsd * 10 ** decimals).toFixed(0);
  return BigInt(scaled);
}
