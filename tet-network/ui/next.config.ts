import type { NextConfig } from "next";

/**
 * Page integrity for the public pages (docs/THREAT_MODEL.md rule 6). Guarded by
 * scripts/page_integrity_guard.mjs.
 *
 * - Scripts only from this origin: no third-party script can load. `'unsafe-inline'` stays because
 *   Next.js puts its bootstrap in inline scripts on statically built pages (per-request nonces need
 *   dynamic rendering); `'wasm-unsafe-eval'` runs TET's own ML-DSA WASM.
 * - Connections only to this origin (the node is proxied under /tet-node-api) and the visitor's own
 *   local prover. No framing, no plugins, no <base>, forms only to this origin.
 * - SRI: every script Next emits carries an integrity hash (experimental.sri).
 * What this doesn't stop: a compromised server serving different HTML, scripts and hashes together.
 */
const PROVER = (process.env.NEXT_PUBLIC_TET_PROVER_URL || "http://127.0.0.1:9945").replace(/\/+$/, "");
export const PUBLIC_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${PROVER} http://localhost:9945`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: PUBLIC_PAGE_CSP },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
];
export const PUBLIC_PAGES = ["/", "/try", "/try/:path*", "/whitepaper", "/whitepaper/:path*", "/verify/:path*", "/paper/:path*"];

const nextConfig: NextConfig = {
  // Next.js v16+: set to `false` to hide the bottom-left dev indicator badge.
  devIndicators: false,

  // Emit .next/standalone — a self-contained server.js plus only the traced
  // node_modules. The Docker runtime stage copies that instead of running an
  // npm install, which is what keeps the UI image small and free of dev deps.
  // No effect on `next dev` or `next start`.
  output: "standalone",

  experimental: {
    sri: { algorithm: "sha256" },
  },

  async headers() {
    return PUBLIC_PAGES.map((source) => ({ source, headers: SECURITY_HEADERS }));
  },
};

export default nextConfig;
