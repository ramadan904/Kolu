/**
 * Entry prices, for P&L on a connected wallet.
 *
 * Chain history cannot give a cost basis honestly here: the public RPC reads a
 * handful of recent transactions, and an average over a partial history is a
 * confident wrong number. So entry prices come from two places Kolu can vouch
 * for — swaps it executed itself, read back from the confirmed transaction's
 * actual balance changes — and a price the owner typed in, labelled as theirs.
 *
 * Stored in this browser, per wallet. Nothing leaves the device.
 */

export interface Fill {
  signature: string;
  /**
   * How the dollar value was established. "kolu": the wallet's own USDC moved,
   * so it is exact. "chain": the swap was paid in something else and routed
   * through USDC — that leg is the trade's value at execution, read from the
   * transaction but one step removed from the wallet.
   */
  priced?: "kolu" | "chain";
  /** Unix ms. */
  t: number;
  /** Underlying ticker, e.g. "TSLA". */
  ticker: string;
  side: "buy" | "sell";
  tokenAmount: number;
  usdcAmount: number;
}

export interface ManualEntry {
  /** USD per token, as the owner entered it. */
  price: number;
  /** Unix ms. */
  at: number;
}

export interface Journal {
  fills: Fill[];
  manual: Record<string, ManualEntry>;
}

export interface Basis {
  /** Average cost per token of the units the basis covers. */
  entry: number;
  /** Units covered: every unit held for a manual entry, else what Kolu fills account for. */
  coveredQty: number;
  source: "kolu" | "manual" | "chain";
}

const EMPTY: Journal = { fills: [], manual: {} };
const key = (owner: string) => `kolu.journal.v1.${owner}`;
/** Holdings smaller than this are rounding, not a position. */
const DUST = 1e-9;

export function loadJournal(owner: string): Journal {
  try {
    const raw = localStorage.getItem(key(owner));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Journal>;
    return {
      fills: Array.isArray(parsed.fills) ? parsed.fills.filter(isFill) : [],
      manual: parsed.manual && typeof parsed.manual === "object" ? parsed.manual : {},
    };
  } catch {
    return EMPTY;
  }
}

export function saveJournal(owner: string, journal: Journal): void {
  try {
    localStorage.setItem(key(owner), JSON.stringify(journal));
  } catch {
    /* private mode or full storage: P&L simply stays unavailable */
  }
}

function isFill(f: unknown): f is Fill {
  const x = f as Fill;
  return (
    !!x &&
    typeof x.signature === "string" &&
    typeof x.ticker === "string" &&
    (x.side === "buy" || x.side === "sell") &&
    x.tokenAmount > 0 &&
    x.usdcAmount > 0
  );
}

/** Adds a fill once; a signature already recorded is left alone. */
export function withFill(journal: Journal, fill: Fill): Journal {
  if (!isFill(fill) || journal.fills.some((f) => f.signature === fill.signature)) return journal;
  return { ...journal, fills: [...journal.fills, fill].sort((a, b) => a.t - b.t) };
}

export function withManual(journal: Journal, ticker: string, price: number | null): Journal {
  const manual = { ...journal.manual };
  if (price === null) delete manual[ticker];
  else if (price > 0 && Number.isFinite(price)) manual[ticker] = { price, at: Date.now() };
  return { ...journal, manual };
}

/**
 * Average cost of the units Kolu's own fills account for, oldest first: a buy
 * adds units at its price, a sell removes units at the running average (so
 * selling does not move the entry of what remains). Units that arrived some
 * other way are not covered, and the caller says so rather than guessing.
 */
export function averageCost(fills: Fill[]): { qty: number; entry: number } | null {
  let qty = 0;
  let cost = 0;
  for (const f of [...fills].sort((a, b) => a.t - b.t)) {
    if (f.side === "buy") {
      qty += f.tokenAmount;
      cost += f.usdcAmount;
    } else if (qty > DUST) {
      const sold = Math.min(f.tokenAmount, qty);
      cost -= (cost / qty) * sold;
      qty -= sold;
    }
  }
  return qty > DUST ? { qty, entry: cost / qty } : null;
}

/**
 * The basis for a holding. A manual entry wins — the owner knows where the
 * rest came from — and covers the whole position. Otherwise Kolu's fills
 * cover at most what is actually held.
 */
export function basisFor(journal: Journal, ticker: string, heldQty: number): Basis | null {
  if (heldQty <= DUST) return null;
  const manual = journal.manual[ticker];
  if (manual) return { entry: manual.price, coveredQty: heldQty, source: "manual" };
  const mine = journal.fills.filter((f) => f.ticker === ticker);
  const avg = averageCost(mine);
  if (!avg) return null;
  // If any covering fill was priced from the route rather than the wallet's
  // own USDC, say so rather than implying an exact figure.
  const source = mine.some((f) => f.priced === "chain") ? "chain" : "kolu";
  return { entry: avg.entry, coveredQty: Math.min(avg.qty, heldQty), source };
}

/** Unrealised P&L on the covered units at `price`, in USD and percent of cost. */
export function unrealised(basis: Basis, price: number): { usd: number; pct: number } {
  const usd = (price - basis.entry) * basis.coveredQty;
  return { usd, pct: basis.entry > 0 ? ((price - basis.entry) / basis.entry) * 100 : 0 };
}
