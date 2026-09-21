/**
 * Server-side client for Jupiter's trigger (limit order) API.
 *
 * Like /api/swap, Kolu only builds unsigned transactions and relays signed
 * ones: it holds no keys and cannot place, change or cancel an order without
 * the user's wallet. Mints are resolved from Kolu's verified registry, never
 * taken from the request, so a client cannot aim an order at an arbitrary token.
 */

export const TRIGGER_BASE = process.env.JUPITER_TRIGGER_ENDPOINT || "https://lite-api.jup.ag/trigger/v1";

/** Base58, 32–44 chars — the same shape check the mint registry uses. */
export const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const BASE_UNITS = /^\d{1,30}$/;

export async function jupiterTrigger(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<{ status: number; body: Record<string, unknown>; timedOut?: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${TRIGGER_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(init?.timeoutMs ?? 15_000),
    });
  } catch (err) {
    // Always an answer, never a thrown 500 with an empty body.
    const timedOut = err instanceof Error && /timeout|abort/i.test(`${err.name} ${err.message}`);
    return {
      status: timedOut ? 504 : 502,
      body: { error: timedOut ? "Jupiter did not answer in time" : "Jupiter could not be reached" },
      timedOut,
    };
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) };
  }
  return { status: res.status, body: body as Record<string, unknown> };
}

/** Jupiter's error payloads vary; this finds the sentence in them. */
export function triggerError(body: Record<string, unknown>, fallback: string): string {
  const e = body.error ?? body.cause ?? body.message;
  return typeof e === "string" && e ? e : fallback;
}
