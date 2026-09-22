"use client";

import { useState } from "react";
import type { AlertDirection, AlertRule } from "@/lib/alerts";
import { Button } from "@/components/ui/Button";
import { Dot } from "@/components/ui/Badge";

/**
 * Arming an alert happens on the asset you are already looking at, rather than
 * in a form with a ticker dropdown. You decide a gap is worth watching while
 * reading that gap — making the user re-select the thing they just selected is
 * how a two-second action becomes a five-step one.
 */
export function AlertControl({
  ticker,
  tokenTicker,
  currentBps,
  rules,
  permission,
  onAdd,
  onRemove,
  onRequestPermission,
}: {
  ticker: string;
  tokenTicker: string;
  currentBps: number | null;
  rules: AlertRule[];
  permission: NotificationPermission | "unsupported";
  onAdd: (ticker: string, thresholdBps: number, direction: AlertDirection) => void;
  onRemove: (id: string) => void;
  onRequestPermission: () => void;
}) {
  // Default just beyond where it sits now, so the suggested alert is one that
  // would mean something rather than one that fires immediately.
  const suggested = currentBps === null ? 150 : Math.max(25, Math.round(Math.abs(currentBps) * 1.25));
  const [threshold, setThreshold] = useState(suggested);
  const mine = rules.filter((r) => r.ticker === ticker);

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
        Alert me
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--bg)] focus-within:border-[var(--accent)]">
          <span className="pl-3 text-[13px] text-[var(--text-3)]">gap over</span>
          <input
            type="number"
            min={1}
            step={5}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))}
            aria-label={`Alert threshold for ${tokenTicker} in basis points`}
            className="num w-20 bg-transparent px-2 py-2 text-[14px] outline-none"
          />
          <span className="pr-3 text-[13px] text-[var(--text-3)]">bps</span>
        </div>
        <Button variant="secondary" onClick={() => onAdd(ticker, threshold, "either")}>
          Arm
        </Button>
      </div>

      {mine.length > 0 && (
        <ul className="mt-3 space-y-1">
          {mine.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--raised)] px-3 py-2 text-[13px]"
            >
              <span className="flex items-center gap-2">
                <Dot tone="accent" live />
                <span className="num">Watching {r.thresholdBps}bps</span>
                {r.lastFiredAt && (
                  <span className="text-[12px] text-[var(--text-3)]">
                    fired{" "}
                    {new Date(r.lastFiredAt).toLocaleTimeString("en-US", {
                      timeZone: "America/New_York",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}{" "}
                    ET
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                className="text-[12px] text-[var(--text-3)] transition-colors hover:text-white"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {permission === "default" && (
        <button
          type="button"
          onClick={onRequestPermission}
          className="mt-3 text-[12px] text-[var(--accent)] hover:underline"
        >
          Allow notifications so alerts reach you with the tab closed
        </button>
      )}
      {permission === "denied" && (
        <p className="mt-3 text-[12px] text-[var(--text-3)]">
          Notifications are blocked, so alerts only appear here while this tab is open.
        </p>
      )}

      <p className="mt-3 max-w-md text-[12px] leading-relaxed text-[var(--text-3)]">
        Alerts never fire on a gap inside the noise floor, or on one
        measured against a feed that has stopped ticking. A false alarm at 3am costs
        more than a missed one.
      </p>
    </div>
  );
}

/**
 * Everything armed, including assets not currently on the board.
 *
 * A rule for a ticker outside the visible tier is never evaluated, so it goes
 * quiet without ever saying so. Silence the user did not ask for is the one
 * failure an alerting feature cannot have.
 */
export function ArmedStrip({
  rules,
  visibleTickers,
  onRemove,
}: {
  rules: AlertRule[];
  visibleTickers: string[];
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (rules.length === 0) return null;

  const dark = rules.filter((r) => !visibleTickers.includes(r.ticker));

  return (
    <div className="panel mb-5 px-4 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-[13px]">
          <Dot tone="accent" live />
          {rules.length} alert{rules.length === 1 ? "" : "s"} armed
          {dark.length > 0 && (
            <span className="text-[var(--warn)]">
              · {dark.length} not being watched on this board
            </span>
          )}
        </span>
        <span className="text-[12px] text-[var(--text-3)]">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <ul className="mt-2.5 space-y-1">
          {rules.map((r) => {
            const watched = visibleTickers.includes(r.ticker);
            return (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--raised)] px-3 py-2 text-[13px]"
              >
                <span className="num">
                  {r.ticker}X · over {r.thresholdBps}bps
                  {!watched && (
                    <span className="ml-2 text-[12px] text-[var(--warn)]">
                      switch to All to watch it
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(r.id)}
                  className="text-[12px] text-[var(--text-3)] transition-colors hover:text-white"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
