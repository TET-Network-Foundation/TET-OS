import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js v16+: set to `false` to hide the bottom-left dev indicator badge.
  devIndicators: false,

  // Emit .next/standalone — a self-contained server.js plus only the traced
  // node_modules. The Docker runtime stage copies that instead of running an
  // npm install, which is what keeps the UI image small and free of dev deps.
  // No effect on `next dev` or `next start`.
  output: "standalone",
};

export default nextConfig;
