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
      // React's development build evaluates strings for debugging aids (rebuilding call stacks); its production build never does.
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
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

// A preview build (MOCK_UI=true) swaps four files for versions in mock/ that serve sample data, so the real
// screens can be worked on without a backend or a sign-in. This is the only place the switch is read. See
// mock/README.md. It refuses to run as a production deployment.
const preview = process.env.MOCK_UI === "true";
if (preview && process.env.APP_ENV === "production")
  throw new Error(
    "MOCK_UI is for design previews and cannot be used with APP_ENV=production",
  );
const previewAlias = {
  "@/lib/server/transport": "./mock/transport.ts",
  "@/lib/server/auth-transport": "./mock/auth-transport.ts",
  "@/lib/server/preview": "./mock/preview.ts",
  "@/components/preview-badge": "./mock/preview-badge.tsx",
};

const nextConfig: NextConfig = {
  // A preview build keeps its own output, so it can never overwrite or be mistaken for the real build.
  ...(preview ? { distDir: ".next-preview" } : {}),
  /* config options here */
  poweredByHeader: false,
  experimental: {
    agentFeedback: true,
    // CSV imports are sent to the API as text (up to 5 MB plus overhead).
    serverActions: { bodySizeLimit: "7mb" },
    // Every product page reads the signed-in user's data, so it renders per request and, by default, is fetched again
    // on every click. Keeping a visited page for 30 s makes going back to a screen instant; saving something in the
    // app refreshes it at once, and only changes made by someone else can show up to 30 s late.
    staleTimes: { dynamic: 30 },
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(), // the web app is a subfolder of the repo
    ...(preview ? { resolveAlias: previewAlias } : {}),
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
