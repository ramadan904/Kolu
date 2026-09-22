import type { Metadata } from "next";
import { findEntry } from "@/lib/universe";

export const dynamic = "force-dynamic";

/** A shared ticket unfurls as that pair, with its live gap on the card. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const entry = typeof params.trade === "string" ? findEntry(params.trade) : undefined;
  if (!entry) return {};
  const title = `${entry.tokenTicker} vs the real ${entry.name} share · Kolu`;
  const description = `Is ${entry.tokenTicker} trading away from the real ${entry.name} share — and does the gap pay after costs? Live on Kolu.`;
  const image = { url: `/api/og?ticker=${entry.ticker}`, width: 1200, height: 630 };
  return {
    title,
    description,
    openGraph: { title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/** The board renders in the shared layout; this route only picks it. */
export default function BoardPage() {
  return null;
}
