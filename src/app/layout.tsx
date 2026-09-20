import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SolanaProviders } from "@/components/app/WalletProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Kolu — fair value for tokenized stocks",
  description:
    "Tokenized stocks trade 24/7. The companies behind them do not. Kolu shows you when one is trading away from the real share price, what the gap is worth after costs, and lets you act on it.",
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
