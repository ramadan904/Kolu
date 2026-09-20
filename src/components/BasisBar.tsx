import { fmtBps } from "@/lib/format";

/**
 * Diverging bar around a zero baseline: premium extends right and warm,
 * discount left and cool. The neutral midpoint is grey so "no gap" reads as
 * nothing rather than as a third category.
 *
 * The confidence band is drawn as a recessive grey span around zero, so a bar
 * that fails to escape it is visibly inside the noise floor rather than merely
 * labelled as such.
 */
export function BasisBar({
  basisBps,
  confidenceBps,
  domainBps,
  muted = false,
}: {
  basisBps: number;
  confidenceBps: number | null;
  domainBps: number;
  muted?: boolean;
}) {
  const domain = Math.max(domainBps, 25);
  const half = 50; // percent of track from centre to either end
  const pct = Math.min(Math.abs(basisBps) / domain, 1) * half;
  const confPct = confidenceBps
    ? Math.min(confidenceBps / domain, 1) * half
    : 0;
  const isPremium = basisBps > 0;
  const color = muted
    ? "var(--text-muted)"
    : isPremium
      ? "var(--premium)"
      : "var(--discount)";

  return (
    <div
      className="relative h-6 w-full"
      role="img"
      aria-label={`${fmtBps(basisBps, 1)} ${isPremium ? "premium" : "discount"}`}
    >
      {/* Confidence band: the region where a gap is indistinguishable from noise. */}
      {confPct > 0 && (
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-sm"
          style={{
            left: `${half - confPct}%`,
            width: `${confPct * 2}%`,
            height: 14,
            background: "var(--neutral-mid)",
          }}
        />
      )}

      {/* Zero baseline. */}
      <div
        className="absolute top-1/2 -translate-y-1/2"
        style={{ left: "50%", width: 1, height: 16, background: "var(--baseline)" }}
      />

      <div
        className="absolute top-1/2 -translate-y-1/2"
        style={{
          left: isPremium ? "50%" : `${half - pct}%`,
          width: `${Math.max(pct, 0.4)}%`,
          height: 10,
          background: color,
          // 4px rounded data-end, square against the baseline.
          borderRadius: isPremium ? "0 4px 4px 0" : "4px 0 0 4px",
          // 2px gap so the fill never touches the baseline rule.
          marginLeft: isPremium ? 2 : 0,
          marginRight: isPremium ? 0 : 2,
        }}
      />
    </div>
  );
}
