/**
 * Public, institutionally labelled wallets.
 *
 * Used for two things that must work without anyone connecting a wallet: a
 * one-click example portfolio, and the payer for a no-wallet dry run. Both
 * need an address that really holds xStocks and USDC on mainnet, and both say
 * on screen whose address it is. Only exchange/custody wallets that Solscan
 * labels publicly belong here — never a private individual's.
 */
export const EXAMPLE_WALLET = {
  address: "6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF",
  label: "Kraken hot wallet",
} as const;

const LABELS: Record<string, string> = {
  [EXAMPLE_WALLET.address]: EXAMPLE_WALLET.label,
};

/** A public label for a well-known address, or null. */
export function knownLabel(address: string | null): string | null {
  return address ? (LABELS[address] ?? null) : null;
}
