"use client";

import { useState } from "react";
import type { AlertDirection, AlertHit, AlertRule } from "@/lib/alerts";
import { fmtBps } from "@/lib/format";

const DIRECTIONS: { value: AlertDirection; label: string }[] = [
  { value: "either", label: "Either" },
  { value: "premium", label: "Premium" },
  { value: "discount", label: "Discount" },
];

/**
 * Arm an alert, see what is armed, see what has fired.
 *
 * Deliberately plain: the value is in what the rule engine refuses to fire on,
 * not in the chrome around it.
 */
export function AlertPanel({
  rules,
  tickers,
  recent,
  permission,
  onAdd,
  onRemove,
  onRequestPermission,
}: {
  rules: AlertRule[];
  tickers: string[];
  recent: AlertHit[];
  permission: NotificationPermission | "unsupported";
  onAdd: (ticker: string, thresholdBps: number, direction: AlertDirection) => void;
  onRemove: (id: string) => void;
  onRequestPermission: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState(tickers[0] ?? "");
  const [threshold, setThreshold] = useState(150);
  const [direction, setDirection] = useState<AlertDirection>("either");

  return (
    <div className="card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm font-medium"
          aria-expanded={open}
        >
          Alerts{" "}
          <span style={{ color: "var(--text-muted)" }}>
            ({rules.length} armed){open ? " ▾" : " ▸"}
          </span>
        </button>

        {recent.length > 0 && (
          <span className="text-xs" style={{ color: "var(--status-warning)" }}>
            ● {recent.length} fired this session
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Ticker
              <select
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                {tickers.map((t) => (
                  <option key={t} value={t} style={{ background: "var(--surface-1)" }}>
                    {t}X
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Gap exceeds (bps)
              <input
                type="number"
                min={1}
                step={5}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-28 rounded-md border bg-transparent px-2 py-1.5 text-sm tnum"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Direction
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as AlertDirection)}
                className="rounded-md border bg-transparent px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                {DIRECTIONS.map((d) => (
                  <option key={d.value} value={d.value} style={{ background: "var(--surface-1)" }}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => ticker && onAdd(ticker, threshold, direction)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: "var(--discount)", color: "var(--discount)" }}
            >
              Arm
            </button>
          </div>

          {permission === "default" && (
            <button
              type="button"
              onClick={onRequestPermission}
              className="text-xs underline"
              style={{ color: "var(--text-secondary)" }}
            >
              Enable browser notifications so alerts reach you with the tab in the background
            </button>
          )}
          {permission === "denied" && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Notifications are blocked, so alerts appear here only while this tab is open.
            </p>
          )}

          {rules.length > 0 && (
            <ul className="space-y-1 text-sm">
              {rules.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-md px-2 py-1.5"
                  style={{ background: "var(--surface-2)" }}
                >
                  <span className="tnum">
                    {r.ticker}X · {r.direction === "either" ? "gap" : r.direction} over{" "}
                    {r.thresholdBps}bps
                    {r.lastFiredAt && (
                      <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        last fired{" "}
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
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                    aria-label={`Remove alert for ${r.ticker}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Alerts fire only on readings the board considers actionable. A gap inside
            the oracle noise floor, or one measured against a feed that has stopped
            ticking, never fires — a false alarm at 3am costs more than a missed one.
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <ul className="mt-3 space-y-1" aria-live="polite">
          {recent.slice(0, 3).map((hit, i) => (
            <li
              key={`${hit.rule.id}-${i}`}
              className="rounded-md px-2 py-1.5 text-sm"
              style={{ background: "var(--surface-2)" }}
            >
              <span style={{ color: "var(--status-warning)" }} aria-hidden="true">
                ●{" "}
              </span>
              <span className="tnum">{fmtBps(hit.basisBps, 0)}</span> — {hit.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
