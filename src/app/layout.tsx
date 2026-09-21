import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SolanaProviders } from "@/components/app/WalletProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const DESCRIPTION =
  "Tokenized stocks trade 24/7. The companies behind them do not. Kolu shows you when one is trading away from the real share price, what the gap is worth after costs, and lets you act on it.";

// Link previews need absolute image URLs. The branch alias is stable across
// redeploys, so a card shared yesterday still resolves today.
const host = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;

export const metadata: Metadata = {
  metadataBase: new URL(host ? `https://${host}` : "http://localhost:3000"),
  title: "Kolu — fair value for tokenized stocks",
  description: DESCRIPTION,
  openGraph: {
    title: "Kolu — fair value for tokenized stocks",
    description: DESCRIPTION,
    images: [{ url: "/api/og", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/api/og"] },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        <SolanaProviders>{children}</SolanaProviders>
      </body>
    </html>
  );
}
