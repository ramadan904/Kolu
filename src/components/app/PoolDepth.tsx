"use client";

import { useEffect, useState } from "react";
import { fmtUsd } from "@/lib/format";

interface Depth {
  available: boolean;
  pool?: string;
  tvlUsd?: number;
  volume24hUsd?: number;
  url?: string;
}

const compact = (usd: number) =>
  usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(usd >= 10_000_000 ? 0 : 1)}M` : fmtUsd(usd, 0);

/**
 * Where the price impact comes from. The ticket measures impact from a live
 * route quote; this says what is behind that number — the size of the pool the
 * order has to move, and how much actually trades through it in a day. A trade
 * worth a tenth of daily volume is a different proposition from one worth a
 * hundredth, and nothing else on the ticket says which one you are about to be.
 *
 * Silent when the answer is unavailable: an empty line is better than a spinner
 * that never resolves.
 */
export function PoolDepth({ ticker, notionalUsd }: { ticker: string; notionalUsd: number }) {
  const [depth, setDepth] = useState<Depth | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDepth(null);
    fetch(`/api/liquidity?ticker=${ticker}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Depth | null) => !cancelled && setDepth(body))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (!depth?.available || !depth.tvlUsd) return null;

  const share = notionalUsd > 0 ? (notionalUsd / depth.tvlUsd) * 100 : 0;
  return (
    <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-3)]">
      Deepest pool holds <span className="num text-[var(--text-2)]">{compact(depth.tvlUsd)}</span>
      {depth.volume24hUsd ? (
        <>
          {" "}
          and traded <span className="num text-[var(--text-2)]">{compact(depth.volume24hUsd)}</span> in 24h
        </>
      ) : null}
      {share > 0 && (
        <>
          {" "}
          — this trade is <span className="num text-[var(--text-2)]">{share < 0.01 ? "<0.01" : share.toFixed(2)}%</span> of
          it, which is what the measured impact above is pricing
        </>
      )}
      .{" "}
      {depth.url && (
        <a
          href={depth.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Pool ↗
        </a>
      )}
    </p>
  );
}
