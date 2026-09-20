/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Vercel needs no standalone bundle; Docker does. Opt in with KOLU_STANDALONE=1
  // so the default build stays the one Vercel expects.
  output: process.env.KOLU_STANDALONE ? "standalone" : undefined,
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    },
    {
      // Diagnostics and market data must never be served from a CDN cache.
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
    },
  ],
};

export default nextConfig;
