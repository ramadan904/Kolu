export function fmtUsd(value: number, digits = 2): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Signed basis points, always with an explicit sign so polarity is never colour-only. */
export function fmtBps(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}bps`;
}

export function fmtPct(bps: number, digits = 2): string {
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "";
  return `${sign}${(Math.abs(bps) / 100).toFixed(digits)}%`;
}

/**
 * Always Eastern. The session strip is in ET, so a refresh stamp in the
 * viewer's local zone would invite them to compare two different clocks.
 */
export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
