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
