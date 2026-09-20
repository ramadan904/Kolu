"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] active:bg-[var(--accent-press)] disabled:bg-[var(--raised)] disabled:text-[var(--text-3)]",
  secondary:
    "bg-[var(--raised)] text-white border border-[var(--border-strong)] hover:bg-[var(--hover)] disabled:text-[var(--text-3)]",
  ghost:
    "bg-transparent text-[var(--text-2)] hover:text-white hover:bg-[var(--raised)] disabled:text-[var(--text-3)]",
  danger:
    "bg-[var(--up-soft)] text-[var(--up)] border border-[var(--up)]/30 hover:bg-[var(--up)]/20",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-[var(--radius-sm)]",
  md: "h-10 px-4 text-sm rounded-[var(--radius-sm)]",
  lg: "h-12 px-5 text-[15px] rounded-[var(--radius)]",
};

export function Button({
  variant = "primary",
  size = "md",
  full,
  loading,
  children,
  className = "",
  disabled,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  loading?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${full ? "w-full" : ""} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 animate-spin ${className}`}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
