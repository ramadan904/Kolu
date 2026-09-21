/**
 * Gap limit orders: "buy TSLAX if it trades 0.5% under the real share".
 *
 * Jupiter's trigger orders are plain price limits between two mints, held and
 * filled on-chain by Jupiter's keepers — they execute while nobody is watching.
 * This module turns a gap target into the exact amounts that order needs. The
 * limit price is anchored to the real share's price at placement: if the share
 * moves afterwards, the order does not follow it. The UI says so.
 */

export type LimitSide = "buy" | "sell";

/** Jupiter rejects trigger orders worth less than this. */
export const MIN_ORDER_USD = 5;

export interface LimitInput {
  side: LimitSide;
  /** Order size in USD, at the current token price. */
  sizeUsd: number;
  /** Real share price the gap is measured against. */
  equityPrice: number;
  /** Token price now — used to size a sell in tokens. */
  tokenPrice: number;
  /** Gap target, bps: buy fills at ≥ this discount, sell at ≥ this premium. */
  gapBps: number;
  tokenDecimals: number;
  usdcDecimals: number;
}

export interface LimitAmounts {
  /** Per-token price the order fills at or better. */
  limitPrice: number;
  /** What the maker gives, in base units of the input mint. */
  makingAmount: string;
  /** What the maker receives at the limit, in base units of the output mint. */
  takingAmount: string;
  /** Tokens bought (buy) or sold (sell), human units. */
  tokens: number;
  /** USDC paid (buy) or received at the limit (sell), human units. */
  usdc: number;
}

const units = (amount: number, decimals: number) => BigInt(Math.floor(amount * 10 ** decimals)).toString();

export function limitAmounts(input: LimitInput): LimitAmounts | null {
  const { side, sizeUsd, equityPrice, tokenPrice, gapBps, tokenDecimals, usdcDecimals } = input;
  if (!(sizeUsd > 0) || !(equityPrice > 0) || !(tokenPrice > 0) || !(gapBps >= 0)) return null;

  if (side === "buy") {
    const limitPrice = equityPrice * (1 - gapBps / 10_000);
    if (!(limitPrice > 0)) return null;
    const tokens = sizeUsd / limitPrice;
    return {
      limitPrice,
      makingAmount: units(sizeUsd, usdcDecimals),
      // Floor the receive side: asking for a hair more than the limit implies
      // would make the order stricter than the price shown.
      takingAmount: units(tokens, tokenDecimals),
      tokens,
      usdc: sizeUsd,
    };
  }

  const limitPrice = equityPrice * (1 + gapBps / 10_000);
  const tokens = sizeUsd / tokenPrice;
  const usdc = tokens * limitPrice;
  return {
    limitPrice,
    makingAmount: units(tokens, tokenDecimals),
    takingAmount: units(usdc, usdcDecimals),
    tokens,
    usdc,
  };
}

/** A Jupiter trigger order, as Kolu shows it. */
export interface OpenOrder {
  key: string;
  ticker: string;
  side: LimitSide;
  /** Price per token the order fills at. */
  limitPrice: number;
  /** Tokens (buy: to receive; sell: to give) still outstanding. */
  tokensRemaining: number;
  usdcAmount: number;
  expiresAt: number | null;
  createdAt: number | null;
}

interface RawOrder {
  orderKey?: string;
  inputMint?: string;
  outputMint?: string;
  makingAmount?: string;
  takingAmount?: string;
  rawMakingAmount?: string;
  rawTakingAmount?: string;
  remainingMakingAmount?: string;
  rawRemainingMakingAmount?: string;
  expiredAt?: string | null;
  createdAt?: string | null;
}

/**
 * Reads Jupiter's order listing. Amounts arrive as human-unit strings
 * (`makingAmount`) alongside raw base units; the human ones are used, and an
 * order between mints Kolu does not track is skipped.
 */
export function parseOrder(
  raw: RawOrder,
  tokens: Record<string, string>,
  usdcMint: string,
): OpenOrder | null {
  if (!raw.orderKey || !raw.inputMint || !raw.outputMint) return null;
  const making = Number(raw.makingAmount);
  const taking = Number(raw.takingAmount);
  const remaining = Number(raw.remainingMakingAmount ?? raw.makingAmount);
  if (!(making > 0) || !(taking > 0)) return null;

  const buy = raw.inputMint === usdcMint && raw.outputMint in tokens;
  const sell = raw.outputMint === usdcMint && raw.inputMint in tokens;
  if (!buy && !sell) return null;

  const time = (v: string | null | undefined) => {
    const ms = v ? Date.parse(v) : NaN;
    return Number.isFinite(ms) ? ms : null;
  };

  return buy
    ? {
        key: raw.orderKey,
        ticker: tokens[raw.outputMint],
        side: "buy",
        limitPrice: making / taking,
        tokensRemaining: (remaining / making) * taking,
        usdcAmount: making,
        expiresAt: time(raw.expiredAt),
        createdAt: time(raw.createdAt),
      }
    : {
        key: raw.orderKey,
        ticker: tokens[raw.inputMint],
        side: "sell",
        limitPrice: taking / making,
        tokensRemaining: remaining,
        usdcAmount: taking,
        expiresAt: time(raw.expiredAt),
        createdAt: time(raw.createdAt),
      };
}
