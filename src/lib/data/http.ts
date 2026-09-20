/**
 * Shared HTTP behaviour for the oracle and router adapters.
 *
 * Both talk to public endpoints with rate limits, and both are on the path of a
 * page a judge might refresh repeatedly. A single 429 should not collapse the
 * board to demo data, so transient failures are retried with backoff — and
 * permanent ones are not, because retrying a 404 just makes the user wait
 * longer for the same answer.
 */

import { PriceSourceError } from "./types";

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injectable for tests; real sleeps make a suite slow for no benefit. */
  sleep?: (ms: number) => Promise<void>;
}

/** 429 and 5xx are worth another go. Everything else is the server's final word. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchJsonWithRetry(
  url: string,
  context: string,
  options: RetryOptions = {},
): Promise<unknown> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelay = options.baseDelayMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 8000;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });

      if (res.ok) return await res.json();

      if (!isRetryableStatus(res.status)) {
        throw new PriceSourceError(`${context}: ${res.status}`);
      }
      lastError = new PriceSourceError(`${context}: ${res.status}`);
    } catch (err) {
      // A non-retryable status was already thrown as PriceSourceError above;
      // rethrow it rather than burning the remaining attempts on it.
      if (err instanceof PriceSourceError && !/\b(429|408|5\d\d)\b/.test(err.message)) {
        clearTimeout(timer);
        throw err;
      }
      lastError = err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts - 1) {
      // Exponential, so a rate limit gets a meaningfully longer pause than a
      // one-off blip rather than three requests inside a second.
      await sleep(baseDelay * 2 ** attempt);
    }
  }

  throw lastError instanceof PriceSourceError
    ? lastError
    : new PriceSourceError(`${context} failed after ${attempts} attempts`, lastError);
}
