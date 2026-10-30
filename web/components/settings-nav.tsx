import Link from "next/link";
import { cn } from "@/lib/utils";

export type SettingsNavItem = {
  href: string;
  label: string;
  active: boolean;
  group: string;
  /** The cards inside this tab, for jumping straight to one. */
  sections?: { id: string; label: string }[];
};

/**
 * Where you are in Settings. A rail on a desktop so the whole shape of the
 * screen is visible at once, and a scrollable row of pills on a phone, where a
 * wrapped block of six pushed the first setting below the fold.
 */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <>
      <nav
        aria-label="Settings sections"
        className="-mx-4 overflow-x-auto px-4 pb-1 lg:hidden"
      >
        <ul className="flex w-max gap-1 rounded-xl bg-secondary p-1">
          {items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={i.active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors",
                  i.active
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav
        aria-label="Settings sections"
        className="hidden lg:sticky lg:top-6 lg:block"
      >
        {groups.map((g) => (
          <div key={g} className="mb-5">
            <p className="px-2.5 pb-1.5 text-xs font-semibold text-muted-foreground">
              {g}
            </p>
            <ul className="space-y-0.5">
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={i.active ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-2.5 py-2 text-sm transition-colors",
                        i.active
                          ? "bg-card font-medium shadow-xs"
                          : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
                      )}
                    >
                      {i.label}
                    </Link>
                    {i.active && i.sections && i.sections.length > 1 ? (
                      <ul className="mt-0.5 mb-1 ml-3 space-y-0.5 border-l border-border pl-2">
                        {i.sections.map((sec) => (
                          <li key={sec.id}>
                            <a
                              href={`#${sec.id}`}
                              className="block rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              {sec.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
