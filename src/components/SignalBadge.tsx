import type { BasisSignal } from "@/lib/basis/compute";

/**
 * Status is carried by an icon and a word, never by colour alone — the reserved
 * status hues sit below 3:1 on the light surface by design, and a colourblind
 * reader gets the same information either way.
 */
const SPEC: Record<BasisSignal, { label: string; icon: string; color: string }> = {
  actionable: { label: "Actionable", icon: "●", color: "var(--status-good)" },
  stale_reference: { label: "Drift", icon: "◑", color: "var(--status-warning)" },
  noise: { label: "Within noise", icon: "○", color: "var(--text-muted)" },
  degraded_feed: { label: "Feed stalled", icon: "▲", color: "var(--status-critical)" },
  unavailable: { label: "No data", icon: "—", color: "var(--text-muted)" },
};

export function SignalBadge({ signal }: { signal: BasisSignal }) {
  const spec = SPEC[signal];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium"
      style={{ color: spec.color }}
    >
      <span aria-hidden="true">{spec.icon}</span>
      <span>{spec.label}</span>
    </span>
  );
}
