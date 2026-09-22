import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "down" | "up" | "warn";

const TONE: Record<Tone, string> = {
  neutral: "text-[var(--text-2)] bg-[var(--raised)] ring-[var(--border)]",
  accent: "text-[var(--accent)] bg-[var(--accent-soft)] ring-[var(--accent)]/25",
  down: "text-[var(--down)] bg-[var(--down-soft)] ring-[var(--down)]/25",
  up: "text-[var(--up)] bg-[var(--up-soft)] ring-[var(--up)]/25",
  warn: "text-[var(--warn)] bg-[var(--warn-soft)] ring-[var(--warn)]/25",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] ring-1 ring-inset ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A status dot that does not rely on colour alone — it always sits beside a label. */
export function Dot({ tone = "neutral", live = false }: { tone?: Tone; live?: boolean }) {
  const color = {
    neutral: "var(--text-3)",
    accent: "var(--accent)",
    down: "var(--down)",
    up: "var(--up)",
    warn: "var(--warn)",
  }[tone];
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${live ? "live-ring" : ""}`}
      style={{ background: color, color, boxShadow: live ? `0 0 8px ${color}` : undefined }}
    />
  );
}
