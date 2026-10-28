"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { ThemeToggle } from "@/components/site/theme-toggle";

type Item = { path: string; label: string };

/**
 * The bar across the top of the work surface: where you are, a shortcut to ask your quotes (⌘K or Ctrl K), the
 * light and dark switch, and the most common action. It is hidden on phones, which have their own top bar.
 */
export function AppTopbar({
  workspace,
  items,
  canAdd,
}: {
  workspace: { id: string; name: string };
  items: Item[];
  canAdd: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const base = `/w/${workspace.id}`;
  const here = items.find(
    (i) =>
      path === `${base}/${i.path}` || path.startsWith(`${base}/${i.path}/`),
  );
  const ask = items.some((i) => i.path === "ask") ? `${base}/ask` : null;

  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push(ask);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, router]);

  return (
    <header className="hidden h-16 shrink-0 items-center justify-between gap-4 bg-card px-6 shadow-xs md:flex">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5 text-sm"
      >
        <span className="truncate text-muted-foreground">{workspace.name}</span>
        {here ? (
          <>
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate font-medium">{here.label}</span>
          </>
        ) : null}
      </nav>
      <div className="flex items-center gap-2">
        {ask ? (
          <Link
            href={ask}
            className="hidden h-10 w-64 items-center gap-2 rounded-xl bg-secondary px-3 text-sm text-muted-foreground transition-colors hover:bg-accent lg:flex"
          >
            <Search aria-hidden="true" className="size-3.5" />
            <span className="flex-1 text-left">Ask your quotes</span>
            <kbd className="rounded border border-border bg-background px-1.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </Link>
        ) : null}
        <ThemeToggle />
        {canAdd ? (
          <Link
            href={`${base}/add`}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-sun px-4 text-sm font-bold text-ink shadow-card transition-[translate] hover:-translate-y-0.5"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Add feedback
          </Link>
        ) : null}
      </div>
    </header>
  );
}
