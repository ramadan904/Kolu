import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolio · Kolu",
  description: "Your xStocks valued against the live gaps: P&L, what closing each gap is worth, open limit orders and recent activity.",
};

/** Rendered by the shared board in the layout; this route only picks the view. */
export default function PortfolioPage() {
  return null;
}
