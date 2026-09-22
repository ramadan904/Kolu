"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface Command {
  id: string;
  group: "Pairs" | "Go to" | "Actions";
  label: string;
  /** Right-aligned context: a live gap, a shortcut. */
  hint?: string;
  hintColor?: string;
  /** Extra words that should find this command. */
  keywords?: string;
  run: () => void;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Every word typed must appear somewhere in the label or keywords; earlier matches rank first. */
function rank(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  return commands
    .map((c) => {
      const hay = `${c.label} ${c.keywords ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      return { c, score: hay.indexOf(words[0]) + (c.label.toLowerCase().startsWith(words[0]) ? -100 : 0) };
    })
    .filter((x): x is { c: Command; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.c);
}

/**
 * ⌘K / Ctrl+K, or "/", from anywhere: any pair's ticket or chart, every view,
 * every action, by keyboard. The whole product one search away.
 */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
        setActive(0);
        setOpen((o) => !o);
      } else if (e.key === "/" && !open && !isTyping(e.target)) {
        e.preventDefault();
        setQuery("");
        setActive(0);
        setOpen(true);
      } else if (open && e.target !== inputRef.current && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Typed while the palette was still opening: keep it, rather than
        // losing the first letters of a fast "/backtest".
        e.preventDefault();
        setQuery((q) => q + e.key);
        inputRef.current?.focus();
      }
    };
    const onOpen = () => {
      setQuery("");
      setActive(0);
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("kolu:palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("kolu:palette", onOpen);
    };
  }, [open]);

  const results = useMemo(() => rank(commands, query), [commands, query]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    // After the palette unmounts, so focus and scrolling land on the page.
    requestAnimationFrame(() => c.run());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  let lastGroup: string | null = null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-[560px] overflow-hidden rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface,#0d0d0f)] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[var(--text-3)]">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pairs, views, actions…"
            aria-label="Search commands"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            className="h-12 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-[var(--text-3)]"
          />
          <kbd className="rounded-[4px] border border-[var(--border)] px-1.5 text-[11px] text-[var(--text-3)]">esc</kbd>
        </div>
        <ul id="palette-results" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-[var(--text-3)]">Nothing matches “{query}”.</li>
          )}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id}>
                {header && (
                  <div className="px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-3)]">{header}</div>
                )}
                <button
                  id={`cmd-${c.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={`flex w-full items-center justify-between gap-4 px-4 py-2 text-left text-[13px] ${
                    i === active ? "bg-[var(--raised)] text-white" : "text-[var(--text-2)]"
                  }`}
                >
                  <span className="truncate">{c.label}</span>
                  {c.hint && (
                    <span className="num shrink-0 text-[12px]" style={{ color: c.hintColor ?? "var(--text-3)" }}>
                      {c.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-4 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--text-3)]">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span className="ml-auto">⌘K or / anywhere</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A visible way in, for anyone who does not know the shortcut. */
export function PaletteButton() {
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("kolu:palette"))}
      className="hidden h-7 items-center gap-2 rounded-[6px] border border-[var(--border)] px-2.5 text-[12px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-white sm:flex"
    >
      Search
      <kbd className="text-[11px]">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
