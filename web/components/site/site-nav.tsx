"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ChevronDown, Layers, Menu, MessagesSquare, Plug, ShieldCheck, Users, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Entry = { href: string; icon: LucideIcon; title: string; body: string };

const PRODUCT: Entry[] = [
  { href: "/features", icon: Layers, title: "Features", body: "The whole loop, from conversation to reply" },
  { href: "/integrations", icon: Plug, title: "Integrations", body: "What connects today, and what is coming" },
  { href: "/security", icon: ShieldCheck, title: "Security", body: "How your customers' words are protected" },
  { href: "/docs/api", icon: BookOpen, title: "API and assistants", body: "Send feedback in, or connect an AI assistant" },
];

const COMPANY: Entry[] = [
  { href: "/about", icon: Users, title: "About", body: "Why this exists and how we build" },
  { href: "/community", icon: MessagesSquare, title: "Community", body: "Ask, request and report" },
  { href: "/contact", icon: Mail, title: "Contact", body: "Talk to a person" },
];

const FLAT = [
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/faq", label: "FAQ" },
];

const link =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors hover:bg-secondary aria-[current=page]:bg-secondary aria-[current=page]:text-link";

function Menu2({ label, items }: { label: string; items: Entry[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(link, "gap-1 data-[state=open]:bg-secondary")}>
          {label}
          <ChevronDown aria-hidden="true" className="size-4 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 rounded-2xl p-2 shadow-raised">
        {items.map((e) => (
          <DropdownMenuItem key={e.href} asChild className="rounded-xl p-0">
            <Link href={e.href} className="flex items-start gap-3 p-3">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-link"
              >
                <e.icon className="size-4.5" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-sm font-semibold">{e.title}</span>
                <span className="block text-xs text-muted-foreground">{e.body}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DesktopNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        <li>
          <Menu2 label="Product" items={PRODUCT} />
        </li>
        {FLAT.map((n) => (
          <li key={n.href}>
            <Link href={n.href} aria-current={path === n.href ? "page" : undefined} className={link}>
              {n.label}
            </Link>
          </li>
        ))}
        <li>
          <Menu2 label="Company" items={COMPANY} />
        </li>
      </ul>
    </nav>
  );
}

export function MobileNav() {
  const path = usePathname();
  const row = (e: Entry) => (
    <li key={e.href}>
      <SheetClose asChild>
        <Link
          href={e.href}
          aria-current={path === e.href ? "page" : undefined}
          className="flex min-h-14 items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-secondary aria-[current=page]:bg-secondary"
        >
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-link">
            <e.icon className="size-5" />
          </span>
          <span>
            <span className="block font-display font-semibold">{e.title}</span>
            <span className="block text-xs text-muted-foreground">{e.body}</span>
          </span>
        </Link>
      </SheetClose>
    </li>
  );
  return (
    <div className="md:hidden">
      <Sheet>
        <SheetTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="rounded-lg">
            <Menu aria-hidden="true" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[22rem] max-w-[90vw] gap-0 overflow-y-auto p-0">
          <div className="border-b border-border p-5">
            <SheetTitle className="font-display text-lg font-bold">Menu</SheetTitle>
            <SheetDescription className="sr-only">Pages on this site</SheetDescription>
          </div>
          <nav aria-label="Mobile" className="space-y-5 p-3">
            <div>
              <p className="px-3 pb-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">Product</p>
              <ul>{PRODUCT.map(row)}</ul>
            </div>
            <ul>
              {FLAT.map((n) => (
                <li key={n.href}>
                  <SheetClose asChild>
                    <Link
                      href={n.href}
                      aria-current={path === n.href ? "page" : undefined}
                      className="flex min-h-12 items-center rounded-2xl px-3 font-display font-semibold transition-colors hover:bg-secondary aria-[current=page]:bg-secondary"
                    >
                      {n.label}
                    </Link>
                  </SheetClose>
                </li>
              ))}
            </ul>
            <div>
              <p className="px-3 pb-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">Company</p>
              <ul>{COMPANY.map(row)}</ul>
            </div>
          </nav>
          <div className="mt-auto space-y-2 border-t border-border p-5">
            <SheetClose asChild>
              <Button asChild size="lg" className="h-12 w-full rounded-xl text-base font-bold">
                <Link href="/signup">Get started</Link>
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button asChild variant="outline" size="lg" className="h-12 w-full rounded-xl text-base">
                <Link href="/login">Sign in</Link>
              </Button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
