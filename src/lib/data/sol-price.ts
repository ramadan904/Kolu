import { SOL_MINT } from "../tokens";

const ENDPOINT = (process.env.JUPITER_ENDPOINT ?? "https://lite-api.jup.ag").replace(/\/$/, "");
const TTL_MS = 20_000;
let cached: { price: number; at: number } | null = null;

/**
 * SOL in USD, from the same Jupiter price service the board reads. Cached for
 * a few seconds: a ticket re-quotes four sizes at once, and SOL does not need
 * to be priced four times for it.
 */
export async function solUsdPrice(fetchImpl: typeof fetch = fetch): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.price;
  const res = await fetchImpl(`${ENDPOINT}/price/v3?ids=${SOL_MINT}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error(`Jupiter prices ${res.status}`);
  const body = (await res.json()) as Record<string, { usdPrice?: unknown }>;
  const price = Number(body?.[SOL_MINT]?.usdPrice);
  if (!(price > 0) || !Number.isFinite(price)) throw new Error("No SOL price");
  cached = { price, at: Date.now() };
  return price;
}
