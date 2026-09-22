import type { ReactNode } from "react";
import { Radar } from "@/components/app/Radar";
import { Shell } from "@/components/app/Shell";
import { TopNav } from "@/components/app/TopNav";
import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

/**
 * One live board behind all four pages. The layout survives navigation, so
 * prices keep polling, an open ticket, the replay, alerts and a watched
 * address all carry from Board to Portfolio to History to Backtest; each page
 * only chooses which sections the board renders.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const board = await buildBoard({ tier: "core" });
  return (
    <Shell nav={<TopNav />}>
      <Radar initial={board} />
      {children}
    </Shell>
  );
}
