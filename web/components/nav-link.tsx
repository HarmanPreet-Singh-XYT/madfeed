"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const active = path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-muted ${active ? "bg-muted underline underline-offset-4" : "text-muted-foreground"}`}
    >
      {children}
    </Link>
  );
}
