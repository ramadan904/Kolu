import { Board } from "@/components/Board";
import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

export default async function Home() {
  const board = await buildBoard({ tier: "core" });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Kolu</h1>
        <p
          className="mt-1.5 max-w-2xl text-sm leading-relaxed sm:text-base"
          style={{ color: "var(--text-secondary)" }}
        >
          Tokenized stocks trade around the clock. The companies they track do not.
          Kolu shows you when one has drifted away from fair value, what the gap is
          worth once costs are paid, and whether it can actually be hedged.
        </p>
      </header>

      <Board initial={board} />
    </main>
  );
}
