import { Radar } from "@/components/app/Radar";
import { Shell } from "@/components/app/Shell";
import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

export default async function Home() {
  const board = await buildBoard({ tier: "core" });
  return (
    <Shell>
      <Radar initial={board} />
    </Shell>
  );
}
