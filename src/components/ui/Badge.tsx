import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "down" | "up" | "warn";

const TONE: Record<Tone, string> = {
  neutral: "text-[var(--text-2)] bg-[var(--raised)]",
  accent: "text-[var(--accent)] bg-[var(--accent-soft)]",
  down: "text-[var(--down)] bg-[var(--down-soft)]",
  up: "text-[var(--up)] bg-[var(--up-soft)]",
  warn: "text-[var(--warn)] bg-[var(--warn-soft)]",
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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide ${TONE[tone]} ${className}`}
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
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${live ? "live-dot" : ""}`}
      style={{ background: color }}
    />
  );
}
