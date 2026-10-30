import type { Metadata } from "next";
import { Geist, Geist_Mono, Lexend } from "next/font/google";
import { SITE } from "@/lib/site";
import { Toaster } from "@/components/ui/sonner";
import { PreviewBadge } from "@/components/preview-badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Headings and display type. Body text and app tables stay in Geist.
const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
});

// Runs before first paint so a saved dark choice never flashes light. Light is the default.
const THEME_SCRIPT =
  "try{if(localStorage.getItem('theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}";

export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: "Turn customer conversations into cited, prioritised requests.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${lexend.variable} h-full antialiased`}
    >
      <head>
        <script>{THEME_SCRIPT}</script>
      </head>
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
        <PreviewBadge />
      </body>
    </html>
  );
}
