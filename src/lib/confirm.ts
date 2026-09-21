/**
 * Transaction confirmation by polling, not subscription.
 *
 * web3.js's `confirmTransaction` waits on a websocket. Kolu's RPC relay is a
 * serverless route and cannot hold one open, and the public cluster refuses
 * browser sockets — so a subscription would never fire, and the call would
 * only return once the blockhash expired, reporting a swap that actually
 * landed as expired. Polling over plain HTTP has no such failure mode.
 *
 * The outcomes are chosen so the UI never has to guess: "expired" is only
 * returned once the blockhash is past its last valid height AND a full history
 * search cannot find the signature — the one case where "nothing was filled"
 * is certain. Anything less certain is "unknown", which the UI must present as
 * "check before retrying", because retrying a swap that did land buys twice.
 */

import type { Connection, TransactionError } from "@solana/web3.js";

export type ConfirmOutcome =
  | { status: "confirmed" }
  | { status: "failed"; err: TransactionError }
  | { status: "expired" }
  | { status: "unknown" };

/** The narrow slice of Connection this needs — keeps it testable without a chain. */
export type StatusReader = Pick<Connection, "getSignatureStatuses" | "getBlockHeight">;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pollConfirmation(
  connection: StatusReader,
  signature: string,
  lastValidBlockHeight: number,
  { intervalMs = 1_500, timeoutMs = 90_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<ConfirmOutcome> {
  const started = Date.now();

  const read = async (searchTransactionHistory: boolean): Promise<ConfirmOutcome | null> => {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory });
    const status = value[0];
    if (!status) return null;
    if (status.err) return { status: "failed", err: status.err };
    if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
      return { status: "confirmed" };
    }
    return null;
  };

  for (;;) {
    try {
      const outcome = await read(false);
      if (outcome) return outcome;

      const height = await connection.getBlockHeight("confirmed");
      if (height > lastValidBlockHeight) {
        // It may have landed in the last valid block; look once through history.
        const final = await read(true);
        return final ?? { status: "expired" };
      }
    } catch {
      // A failed poll says nothing about the transaction. Keep polling until
      // the deadline rather than turning a network blip into a verdict.
    }

    if (Date.now() - started > timeoutMs) return { status: "unknown" };
    await sleep(intervalMs);
  }
}
