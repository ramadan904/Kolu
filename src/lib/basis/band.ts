import { NOISE_MULTIPLE } from "./compute";
import { ASSUMED_CONFIDENCE_FRACTION } from "../data/jupiter-prices";

/** The assumed band per leg when the serving source publishes none, in bps. */
export const ASSUMED_BAND_BPS = Math.round(ASSUMED_CONFIDENCE_FRACTION * 10_000);

export type PriceSourceKind = "pyth" | "jupiter" | "fixture";

/**
 * What the noise floor actually is, said accurately for whichever source is
 * serving. Pyth publishes a confidence interval per price; Jupiter does not,
 * so those bands are Kolu's own assumption — and a product that calls an
 * assumption "the oracle's confidence" has lost the argument it is making.
 */
export function bandCopy(source: PriceSourceKind): { short: string; long: string } {
  if (source === "pyth") {
    return {
      short: "the feeds’ own confidence",
      long: `Both legs publish a confidence interval with every price. A gap inside ${NOISE_MULTIPLE}× their combined width is two error bars overlapping, not a dislocation.`,
    };
  }
  return {
    short: `an assumed ±${ASSUMED_BAND_BPS}bps a leg`,
    long: `Neither leg publishes a confidence interval on this deployment, so Kolu assumes ±${ASSUMED_BAND_BPS}bps a side and treats ${NOISE_MULTIPLE}× their combined width as the floor. Set PYTH_API_KEY and the real published bands are used instead.`,
  };
}
