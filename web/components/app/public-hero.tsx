import type { ReactNode } from "react";

/**
 * The top of a public page (roadmap, release notes): the brand's gradient with the same wave edge as the landing
 * page, so a visitor sees one product from the website to the roadmap. The page sits under it in `PublicBody`.
 */
export function PublicHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 text-on-brand">
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-12 pb-16">
        {eyebrow ? (
          <p className="inline-flex rounded-full bg-on-brand/15 px-3 py-1 text-xs font-semibold tracking-widest uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          {title}
        </h1>
        {children ? <div className="text-on-brand">{children}</div> : null}
      </div>
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 48"
        preserveAspectRatio="none"
        className="-mb-px block h-8 w-full fill-background sm:h-12"
      >
        <path d="M0 48V28C240 4 480 0 720 14s480 26 720 8V48z" />
      </svg>
    </header>
  );
}

/** The column under a public hero. */
export function PublicBody({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 pt-4 pb-16">
      {children}
    </div>
  );
}
