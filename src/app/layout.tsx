import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kolu — fair value for tokenized stocks",
  description:
    "See when a tokenized stock is trading away from its underlying, what that gap is worth after costs, and whether it can be hedged.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
