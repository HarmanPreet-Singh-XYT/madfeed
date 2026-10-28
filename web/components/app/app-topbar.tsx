"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Plus, Search } from "lucide-react";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

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
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="min-w-0">
            <span className="truncate text-muted-foreground">
              {workspace.name}
            </span>
          </BreadcrumbItem>
          {here ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate font-medium">
                  {here.label}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-2">
        {ask ? (
          <Button
            asChild
            variant="secondary"
            className="hidden h-10 w-64 justify-start gap-2 px-3 font-normal text-muted-foreground lg:inline-flex"
          >
            <Link href={ask}>
              <Search aria-hidden="true" className="size-3.5" />
              <span className="flex-1 text-left">Ask your quotes</span>
              <kbd className="rounded border border-border bg-background px-1.5 font-mono text-[10px]">
                ⌘K
              </kbd>
            </Link>
          </Button>
        ) : null}
        <ThemeToggle />
        {canAdd ? (
          <Button
            asChild
            className="h-10 gap-1.5 bg-sun px-4 font-bold text-ink shadow-card hover:bg-sun/90 hover:-translate-y-0.5"
          >
            <Link href={`${base}/add`}>
              <Plus aria-hidden="true" className="size-3.5" />
              Add feedback
            </Link>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
