/**
 * Axis scaling helpers. Kept out of the component so they are testable — the
 * component is .tsx, which the test runner cannot parse under Next's
 * `jsx: "preserve"`.
 */

/** Round axis bounds, so ticks read 200/100/0 rather than 201/101/0. */
const NICE_STEPS = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600];

export function niceDomain(maxAbs: number): number {
  return NICE_STEPS.find((step) => step >= maxAbs) ?? Math.ceil(maxAbs / 100) * 100;
}

export interface Domain {
  min: number;
  max: number;
}

/**
 * Vertical extent for a basis series.
 *
 * A symmetric domain around zero is correct when the series crosses it and
 * wasteful when it does not — an overnight drift that only ever goes one way
 * spends half the chart on empty space, which reads as a rendering fault. Zero
 * always stays on the axis, because a basis chart without its baseline is
 * meaningless.
 */
export function basisDomain(values: number[], pad = 1.08): Domain {
  if (values.length === 0) return { min: -25, max: 25 };

  const max = Math.max(...values);
  const min = Math.min(...values);

  // Each side is scaled from its own extreme. Forcing symmetry around zero
  // whenever the series so much as dips negative spends most of the plot on
  // empty space — a drift that runs -25 to +180 does not need a -200 floor.
  return {
    min: min >= 0 ? 0 : -niceDomain(Math.max(Math.abs(min), 1) * pad),
    max: max <= 0 ? 0 : niceDomain(Math.max(max, 1) * pad),
  };
}
