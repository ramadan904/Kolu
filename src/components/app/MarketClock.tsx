import { Dot } from "@/components/ui/Badge";
import { SESSION_COPY, type MarketSession } from "@/lib/market/session";

function countdown(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Market session, stated as a fact.
 *
 * It used to append "gaps cannot be hedged while it is shut" in warning
 * colour. True, and the wrong place for it: a caveat at the top of the screen
 * scolds the reader before they have read a number, and reads as a product
 * apologising for itself. The same point belongs where a trade is actually
 * decided — the ticket says it, next to the money.
 */
export function MarketClock({ session }: { session: MarketSession }) {
  const open = session.isRegularHours;
  const next = countdown(session.minutesToNextPhase);

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
      <span className="flex items-center gap-2">
        <Dot tone={open ? "down" : "neutral"} live={open} />
        <span className="font-medium">
          {open
            ? "US market open"
            : session.phase === "premarket" || session.phase === "afterhours"
              ? `US market ${SESSION_COPY[session.phase].toLowerCase()}`
              : "US market closed"}
        </span>
      </span>

      <span className="mono text-[12px] text-[var(--text-3)]">
        {session.phase === "weekend" || session.phase === "holiday"
          ? `${session.label ?? SESSION_COPY[session.phase]} · ${session.etTime} ET`
          : `${session.etTime} ET`}
        {next && ` · ${SESSION_COPY[session.nextPhase ?? "closed"].toLowerCase()} in ${next}`}
      </span>
    </div>
  );
}
