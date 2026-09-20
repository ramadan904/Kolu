/**
 * Basis alerts.
 *
 * The whole premise is someone who cannot watch the screen — the interesting
 * dislocations happen while they are asleep. That makes the design question
 * "when must this NOT fire", because an alert that cries wolf at 3am gets muted
 * and then the real one is missed too.
 *
 * So a rule fires only on a reading the board itself considers worth acting on.
 * A gap inside the oracle noise floor never fires. A stalled feed never fires —
 * a reference that has stopped ticking can manufacture an arbitrarily large
 * apparent basis, and waking someone for a data outage dressed up as an
 * opportunity is the single worst thing this feature could do.
 */

import type { BasisReading } from "./basis/compute";

export type AlertDirection = "premium" | "discount" | "either";

export interface AlertRule {
  id: string;
  ticker: string;
  direction: AlertDirection;
  thresholdBps: number;
  /** Epoch ms of the last time this rule fired; null if never. */
  lastFiredAt: number | null;
}

export interface AlertHit {
  rule: AlertRule;
  ticker: string;
  basisBps: number;
  message: string;
}

export interface EvaluateResult {
  hits: AlertHit[];
  /** Rules with `lastFiredAt` advanced for anything that fired. */
  rules: AlertRule[];
}

/** Signals a rule is allowed to fire on. Everything else is silence. */
const FIREABLE = new Set<BasisReading["signal"]>(["actionable", "stale_reference"]);

/** Re-arm delay, so one slow-moving dislocation does not alert every poll. */
export const DEFAULT_COOLDOWN_MS = 15 * 60_000;

export function matchesDirection(direction: AlertDirection, basisBps: number): boolean {
  if (direction === "either") return true;
  return direction === "premium" ? basisBps > 0 : basisBps < 0;
}

export function evaluate(
  rules: AlertRule[],
  readings: BasisReading[],
  now: number,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): EvaluateResult {
  const byTicker = new Map(readings.map((r) => [r.ticker, r]));
  const hits: AlertHit[] = [];

  const updated = rules.map((rule) => {
    const reading = byTicker.get(rule.ticker);
    if (!reading || reading.basisBps === null) return rule;
    if (!FIREABLE.has(reading.signal)) return rule;
    if (Math.abs(reading.basisBps) < rule.thresholdBps) return rule;
    if (!matchesDirection(rule.direction, reading.basisBps)) return rule;
    if (rule.lastFiredAt !== null && now - rule.lastFiredAt < cooldownMs) return rule;

    hits.push({
      rule,
      ticker: reading.ticker,
      basisBps: reading.basisBps,
      message: describe(reading),
    });
    return { ...rule, lastFiredAt: now };
  });

  return { hits, rules: updated };
}

function describe(reading: BasisReading): string {
  const pct = (Math.abs(reading.basisBps ?? 0) / 100).toFixed(2);
  const side = (reading.basisBps ?? 0) > 0 ? "premium" : "discount";
  const kind =
    reading.signal === "stale_reference"
      ? "drift against a closed market — directional, not hedgeable"
      : "against a live reference";
  return `${reading.tokenTicker} at a ${pct}% ${side}, ${kind}.`;
}

let counter = 0;

export function makeRule(
  ticker: string,
  thresholdBps: number,
  direction: AlertDirection = "either",
): AlertRule {
  counter += 1;
  return {
    id: `${ticker}-${Date.now().toString(36)}-${counter}`,
    ticker: ticker.toUpperCase(),
    direction,
    thresholdBps: Math.max(1, Math.round(thresholdBps)),
    lastFiredAt: null,
  };
}

const STORAGE_KEY = "kolu.alerts.v1";

/**
 * Browser storage is best-effort: it throws in some private-window and
 * blocked-storage configurations, and a saved rule is a convenience, never
 * something the app depends on.
 */
export function loadRules(): AlertRule[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRule);
  } catch {
    return [];
  }
}

export function saveRules(rules: AlertRule[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Nothing to do, and nothing worth interrupting the user over.
  }
}

function isRule(value: unknown): value is AlertRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.ticker === "string" &&
    typeof r.thresholdBps === "number" &&
    Number.isFinite(r.thresholdBps) &&
    (r.direction === "premium" || r.direction === "discount" || r.direction === "either") &&
    (r.lastFiredAt === null || typeof r.lastFiredAt === "number")
  );
}
