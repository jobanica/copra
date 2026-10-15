import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    // Lint is run separately in CI; don't block production builds on it.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Server Actions are enabled by default in Next 15; keep body limit generous
    // for receipt-photo uploads.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
