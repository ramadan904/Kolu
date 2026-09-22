/**
 * Where the wallet relay sends JSON-RPC, in order of preference.
 *
 * A demo dies on a rate limit. The keyless public endpoints throttle in bursts
 * and occasionally answer 5xx, so the relay keeps a second one to fall to
 * rather than surfacing "could not read" at the moment someone is watching.
 * A configured SOLANA_RPC_URL always leads; the public ones stay behind it as
 * a safety net, never in front of a provider that was paid for.
 *
 * Only endpoints that answer without a key belong here — one that needs a key
 * returns 401/403 to every call and would waste an attempt each time.
 */
export const PUBLIC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
] as const;

export function rpcUpstreams(configured = process.env.SOLANA_RPC_URL): string[] {
  const first = configured?.trim();
  const list = first ? [first, ...PUBLIC_FALLBACKS] : [...PUBLIC_FALLBACKS];
  // A configured endpoint that is already one of the public ones must not be tried twice.
  return [...new Set(list.map((u) => u.replace(/\/$/, "")))];
}

export function rpcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}
