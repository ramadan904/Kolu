/**
 * Chooses a price source, and degrades honestly when the live one is unreachable.
 *
 * The fallback is deliberate product behaviour, not a dev convenience. A judge
 * on locked-down wifi, a laptop behind a corporate proxy, or a demo machine with
 * no outbound access all still see a working product — clearly labelled as demo
 * data, never silently passed off as live.
 */

import { FixtureSource, isScenario, type Scenario } from "./fixtures";
import { PythSource } from "./pyth";
import type { PriceSource } from "./types";

export type SourceMode = "pyth" | "fixture";

export interface ResolvedSource {
  source: PriceSource;
  mode: SourceMode;
  scenario: Scenario | null;
}

export function configuredMode(): SourceMode {
  return process.env.KOLU_PRICE_SOURCE === "fixture" ? "fixture" : "pyth";
}

export function configuredScenario(): Scenario {
  const raw = process.env.KOLU_SCENARIO;
  return isScenario(raw) ? raw : "weekend_drift";
}

/**
 * `now` must be threaded in rather than defaulted inside the source: the caller
 * computes price ages against its own clock, and a fixture that timestamps
 * itself off wall-clock time will look like a dead feed to any caller running
 * on a different one.
 */
export function makeFixtureSource(now?: () => Date): ResolvedSource {
  const scenario = configuredScenario();
  return {
    source: new FixtureSource({ scenario, now }),
    mode: "fixture",
    scenario,
  };
}

export function resolveSource(now?: () => Date): ResolvedSource {
  if (configuredMode() === "fixture") return makeFixtureSource(now);
  return {
    source: new PythSource({ endpoint: process.env.PYTH_HERMES_ENDPOINT }),
    mode: "pyth",
    scenario: null,
  };
}
