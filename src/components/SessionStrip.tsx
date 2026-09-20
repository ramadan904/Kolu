import { SESSION_COPY, type MarketSession } from "@/lib/market/session";

function countdown(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const DOT: Record<MarketSession["phase"], string> = {
  regular: "var(--status-good)",
  premarket: "var(--status-warning)",
  afterhours: "var(--status-warning)",
  closed: "var(--text-muted)",
  weekend: "var(--text-muted)",
  holiday: "var(--text-muted)",
};

/**
 * The session is stated before any number, because every number below it means
 * something different depending on what this strip says.
 */
export function SessionStrip({ session }: { session: MarketSession }) {
  const next = countdown(session.minutesToNextPhase);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-2 font-medium">
        <span aria-hidden="true" style={{ color: DOT[session.phase] }}>
          {"●"}
        </span>
        US equities: {SESSION_COPY[session.phase]}
      </span>

      <span style={{ color: "var(--text-muted)" }}>
        {session.etTime} ET
        {session.label && session.phase !== "weekend" ? ` · ${session.label}` : ""}
        {next ? ` · ${SESSION_COPY[session.nextPhase ?? "closed"].toLowerCase()} in ${next}` : ""}
      </span>

      {session.calendarStale && (
        <span style={{ color: "var(--status-warning)" }}>
          {"▲"} Trading calendar needs updating for {session.etDate.slice(0, 4)}
        </span>
      )}
    </div>
  );
}
