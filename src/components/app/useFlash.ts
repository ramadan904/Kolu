"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "flash-up" / "flash-down" for a moment after `value` changes, so a price
 * that just ticked is seen ticking. Nothing on first render: a page load is
 * not a move.
 */
export function useFlash(value: number | null | undefined): string {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before == null || value == null || before === value) return;
    setCls(value > before ? "flash-up" : "flash-down");
    const id = setTimeout(() => setCls(""), 1100);
    return () => clearTimeout(id);
  }, [value]);
  return cls;
}

/** Counts up from 0 to `target` once, on first paint; after that it is simply `target`. */
export function useCountUp(target: number, ms = 900): number {
  const [shown, setShown] = useState<number | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const to = target;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      if (k < 1) {
        setShown(to * (1 - Math.pow(1 - k, 3)));
        raf = requestAnimationFrame(tick);
      } else setShown(null);
    };
    setShown(0);
    raf = requestAnimationFrame(tick);
    // Interrupted by a live tick: show the real value, never a frozen frame.
    return () => {
      cancelAnimationFrame(raf);
      setShown(null);
    };
  }, [target, ms]);
  return shown ?? target;
}
