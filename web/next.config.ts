import type { NextConfig } from "next";

// Static security headers for every route. A strict per-request nonce CSP
// (script-src) needs dynamic rendering via proxy.ts and is added with the
// first authenticated screens; see docs/engineering-principles.md.
const headersFor = (framing: boolean) => [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(framing ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  {
    key: "Content-Security-Policy",
    // Everything may come only from this site: no code from elsewhere, no
    // sending data to other origins (connect-src, img-src and form-action),
    // no framing, no <base> or plugin tricks. Inline scripts are allowed
    // because the pages' shells are prerendered at build time and cannot
    // carry a per-request nonce; the app never writes raw HTML (a test
    // enforces that), which is what keeps inline injection out.
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      framing ? "frame-ancestors *" : "frame-ancestors 'none'",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  /* config options here */
  poweredByHeader: false,
  experimental: {
    agentFeedback: true,
    // CSV imports are sent to the API as text (up to 5 MB plus overhead).
    serverActions: { bodySizeLimit: "7mb" },
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(), // the web app is a subfolder of the repo
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    // Everything refuses to be framed, except the survey and chat pages made for showing inside another site's page.
    return [
      { source: "/((?!embed/|chat/).*)", headers: headersFor(false) },
      { source: "/embed/:path*", headers: headersFor(true) },
      { source: "/chat/:path*", headers: headersFor(true) },
    ];
  },
};

export default nextConfig;
