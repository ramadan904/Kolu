import { ImageResponse } from "next/og";
import { buildBoard } from "@/lib/board";
import type { BasisReading } from "@/lib/basis/compute";
import { findEntry } from "@/lib/universe";

export const dynamic = "force-dynamic";

/**
 * The card a Kolu link unfurls into — in X, Discord, Slack, Telegram.
 *
 * Drawn from the live board at request time, so a shared ticket shows the gap
 * as it stands, not a stock screenshot. Held to the same rules as the page: a
 * gap inside the noise floor is grey and says so, and a card rendered from
 * demo data says DEMO DATA on its face.
 */

const C = {
  bg: "#08080a",
  surface: "#0e0e11",
  border: "rgba(255,255,255,0.10)",
  text: "#ffffff",
  text2: "#90909a",
  text3: "#5c5c66",
  down: "#1aa179",
  up: "#ef4444",
  warn: "#e8a33d",
};

function usd(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(bps: number) {
  return `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${(Math.abs(bps) / 100).toFixed(2)}%`;
}

function status(r: BasisReading): { text: string; color: string } {
  const signal = r.signal === "actionable" || r.signal === "stale_reference";
  if (r.signal === "degraded_feed") return { text: "Feed stalled", color: C.warn };
  if (!signal) return { text: r.signal === "noise" ? "Within noise" : "No data", color: C.text3 };
  return (r.basisBps ?? 0) < 0 ? { text: "Trading cheap", color: C.down } : { text: "Trading rich", color: C.up };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const entry = findEntry(params.get("ticker") ?? "");

  let reading: BasisReading | undefined;
  let demo = false;
  let summary = "";
  try {
    const board = await buildBoard({ tier: entry && entry.tier !== "core" ? "all" : "core" });
    demo = board.source === "fixture";
    // A specific pair when one was shared; otherwise only a pair with a real
    // gap earns the headline — a quiet board is summarised, not dressed up.
    const live = board.readings.filter((r) => r.signal === "actionable" || r.signal === "stale_reference");
    reading = entry ? board.readings.find((r) => r.ticker === entry.ticker) : live[0];
    summary =
      live.length === 0
        ? `All ${board.readings.length} pairs inside the noise floor right now`
        : `${live.length} of ${board.readings.length} pairs outside the noise floor right now`;
  } catch {
    reading = undefined;
  }

  const s = reading ? status(reading) : null;
  const gapColor = s && s.color !== C.text3 && s.color !== C.warn ? s.color : C.text2;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: C.bg,
          padding: "64px 72px",
          color: C.text,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", width: 40, height: 40, borderRadius: 10, background: "#16161a", position: "relative" }}>
              <div style={{ position: "absolute", left: 18, top: 7, width: 3, height: 26, borderRadius: 2, background: C.text3 }} />
              <div style={{ position: "absolute", left: 21, top: 11, width: 12, height: 6, borderRadius: 3, background: C.up }} />
              <div style={{ position: "absolute", left: 7, top: 23, width: 12, height: 6, borderRadius: 3, background: C.down }} />
            </div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>Kolu</div>
          </div>
          {demo && (
            <div style={{ display: "flex", fontSize: 22, color: C.warn, border: `2px solid ${C.warn}`, borderRadius: 999, padding: "6px 18px" }}>
              DEMO DATA
            </div>
          )}
        </div>

        {reading && reading.basisBps !== null && reading.token && reading.equity ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ fontSize: 30, color: C.text2 }}>{reading.name}</div>
              <div style={{ display: "flex", fontSize: 24, color: s!.color, border: `2px solid ${C.border}`, borderRadius: 999, padding: "4px 16px" }}>
                {s!.text}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 32, marginTop: 8 }}>
              <div style={{ fontSize: 132, fontWeight: 700, letterSpacing: -4 }}>{reading.tokenTicker}</div>
              <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -3, color: gapColor }}>{pct(reading.basisBps)}</div>
            </div>
            <div style={{ display: "flex", gap: 40, fontSize: 32, color: C.text2, marginTop: 8 }}>
              <div style={{ display: "flex" }}>
                Token&nbsp;<span style={{ color: C.text }}>{usd(reading.token.price)}</span>
              </div>
              <div style={{ display: "flex" }}>
                Real share&nbsp;<span style={{ color: C.text }}>{usd(reading.equity.price)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>Fair value for</div>
            <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>tokenized stocks</div>
            {summary && <div style={{ display: "flex", fontSize: 32, color: C.text2, marginTop: 20 }}>{summary}</div>}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: C.text3 }}>
          <div>Is the token trading away from the real share — and does the gap pay after costs?</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "cache-control": "public, max-age=60, s-maxage=60" },
    },
  );
}
