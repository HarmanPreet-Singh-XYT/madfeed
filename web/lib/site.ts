// What the public pages say about who runs the service. Everything here comes from settings read when the site is
// built, so nothing is invented: a value that is not set shows plainly as "not published yet".
//
// The product has no name yet (an owner decision). SITE_NAME is the one place to put it.
export const SITE = {
  name: process.env.SITE_NAME || "Feedback",
  url: (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, ""),
  contactEmail: process.env.CONTACT_EMAIL || "",
  securityEmail: process.env.SECURITY_EMAIL || process.env.CONTACT_EMAIL || "",
  privacyEmail: process.env.PRIVACY_EMAIL || process.env.CONTACT_EMAIL || "",
  legalName: process.env.COMPANY_LEGAL_NAME || "",
  address: process.env.COMPANY_ADDRESS || "",
  governingLaw: process.env.GOVERNING_LAW || "",
  // The legal pages are drafts until a lawyer has read them; this removes the notice.
  legalReviewed: process.env.LEGAL_REVIEWED === "true",
  updated: "2026-10-24",
};

export const NAV = [
  { href: "/features", label: "Features" },
  { href: "/integrations", label: "Integrations" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/faq", label: "FAQ" },
  { href: "/community", label: "Community" },
  { href: "/about", label: "About" },
];

export const PAGES = [
  "/",
  "/features",
  "/integrations",
  "/pricing",
  "/docs",
  "/faq",
  "/about",
  "/community",
  "/contact",
  "/security",
  "/privacy",
  "/terms",
  "/cookies",
  "/subprocessors",
];
