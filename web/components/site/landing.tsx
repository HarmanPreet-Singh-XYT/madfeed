import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared width and rhythm for every landing section. */
export function Band({
  id,
  tone = "plain",
  children,
}: {
  id: string;
  tone?: "plain" | "muted" | "ink";
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className={cn(
        "px-4 py-16 sm:py-24",
        tone === "muted" && "bg-muted",
        tone === "ink" && "bg-ink text-on-brand",
      )}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHead({
  id,
  eyebrow,
  title,
  lead,
  onInk = false,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  onInk?: boolean;
}) {
  return (
    <div className="reveal mx-auto mb-12 max-w-3xl space-y-4 text-center">
      <p
        className={cn(
          "inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-wider uppercase",
          onInk ? "bg-on-brand/10 text-on-brand" : "bg-secondary text-link",
        )}
      >
        {eyebrow}
      </p>
      <h2
        id={`${id}-h`}
        className="font-display text-3xl leading-tight font-bold tracking-tight text-balance sm:text-5xl"
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={cn(
            "text-lg text-pretty",
            onInk ? "text-on-brand/75" : "text-muted-foreground",
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}

const HUE = {
  blue: "bg-hue-blue",
  teal: "bg-hue-teal",
  amber: "bg-hue-amber",
  coral: "bg-hue-coral",
  sky: "bg-hue-sky",
} as const;
export type Hue = keyof typeof HUE;

export const TINT: Record<Hue, string> = {
  blue: "bg-tint-blue",
  teal: "bg-tint-teal",
  amber: "bg-tint-amber",
  coral: "bg-tint-coral",
  sky: "bg-tint-sky",
};

/** A coloured rounded square with a white icon: the marker for every feature. */
export function IconTile({
  icon: Icon,
  hue,
  className,
}: {
  icon: LucideIcon;
  hue: Hue;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-2xl text-on-brand shadow-card transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110",
        HUE[hue],
        className,
      )}
    >
      <Icon className="size-6" />
    </span>
  );
}

/** A card that lifts a little on hover and eases in as it scrolls into view. */
export function LiftCard({
  index = 0,
  className,
  children,
}: {
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li
      style={{ "--i": index } as CSSProperties}
      className={cn(
        "reveal group rounded-3xl bg-card p-7 shadow-card transition-[translate,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-raised",
        className,
      )}
    >
      {children}
    </li>
  );
}

/** The signature gradient: deep navy to ocean to teal. Same in light and dark, so white text on it always passes. */
export const GRADIENT = "bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3";

/** The wave that ends a gradient band and hands over to the page. */
export function Wave({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 120"
      preserveAspectRatio="none"
      className={cn(
        "absolute inset-x-0 h-16 w-full fill-background sm:h-28",
        flip ? "top-0 rotate-180" : "bottom-0",
      )}
    >
      <path d="M0 120V70C240 10 480 0 720 40s480 60 720-10v90H0Z" />
    </svg>
  );
}

/** A thin bar at the top of the window that fills as the page scrolls. Pure CSS; absent where unsupported. */
export function ScrollProgress() {
  return (
    <div
      aria-hidden="true"
      className="scroll-progress fixed inset-x-0 top-0 z-50 h-1 bg-gradient-to-r from-brand-3 via-hue-sky to-sun"
    />
  );
}

/** A row of chips that drifts sideways; it pauses on hover and stands still for reduced motion. */
export function Marquee({ items }: { items: string[] }) {
  const chips = (hidden: boolean) =>
    items.map((s) => (
      <li
        key={s}
        aria-hidden={hidden || undefined}
        className="shrink-0 rounded-full bg-secondary px-5 py-2 text-sm font-medium"
      >
        {s}
      </li>
    ));
  return (
    <div className="marquee overflow-hidden">
      <ul className="marquee-track flex w-max gap-3">
        {chips(false)}
        {chips(true)}
      </ul>
    </div>
  );
}

/** A window frame for the product pictures. They are drawn here, with sample text, not screenshots. */
export function Frame({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-raised",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-hue-coral" />
          <span className="size-2.5 rounded-full bg-hue-amber" />
          <span className="size-2.5 rounded-full bg-hue-teal" />
        </span>
        <span className="mx-auto text-xs font-medium text-muted-foreground">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Quote chips that float around the hero. Decorative: the real content is in the page text. */
export function FloatingQuotes() {
  const chip =
    "float absolute hidden rounded-2xl bg-card px-4 py-3 text-left text-sm font-medium text-card-foreground shadow-raised lg:block";
  const at = (r: string, d: string) =>
    ({ "--r": r, "--d": d }) as CSSProperties;
  return (
    <div aria-hidden="true">
      <p
        className={cn(chip, "top-4 left-0 xl:-left-8")}
        style={at("-3deg", "0s")}
      >
        <span className="rounded-sm bg-mark px-0.5 text-ink">
          “two hours back”
        </span>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Priya · Call
        </span>
      </p>
      <p
        className={cn(chip, "top-40 right-0 xl:-right-8")}
        style={at("3deg", "-2s")}
      >
        <span className="rounded-sm bg-mark px-0.5 text-ink">
          “can we export this?”
        </span>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Marcus · Email
        </span>
      </p>
      <p
        className={cn(chip, "top-72 left-6 xl:left-2")}
        style={at("2deg", "-4s")}
      >
        <span className="rounded-sm bg-mark px-0.5 text-ink">
          “still waiting on SSO”
        </span>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Elena · Chat
        </span>
      </p>
    </div>
  );
}

/** A big rounded panel that gives one idea its own colour. Sticks and stacks over the one before it on wide screens. */
export function StackPanel({
  tint,
  index,
  className,
  children,
}: {
  tint: Hue;
  index: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="lg:sticky lg:top-(--top)"
      style={{ "--top": `${5.5 + index * 1.25}rem` } as CSSProperties}
    >
      <div
        className={cn(
          "reveal rounded-[2rem] p-6 shadow-card sm:p-12",
          TINT[tint],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A big rounded pastel panel that gives one idea its own colour. */
export function Panel({
  tint,
  className,
  children,
}: {
  tint: Hue;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-[2rem] p-6 sm:p-12", TINT[tint], className)}>
      {children}
    </div>
  );
}

/** Steps joined by a line that fills as you scroll; each number lights up when you reach it. */
export function Timeline({
  steps,
}: {
  steps: { title: string; body: string }[];
}) {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="absolute top-2 bottom-2 left-5 w-0.5 bg-border"
      />
      <div
        aria-hidden="true"
        className="grow-y absolute top-2 bottom-2 left-5 w-0.5 bg-primary"
      />
      <ol className="space-y-8">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-5">
            <span
              aria-hidden="true"
              className="step-node relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground shadow-glow"
            >
              {i + 1}
            </span>
            <div className="reveal -mt-0.5 flex-1 rounded-2xl bg-card p-5 shadow-card">
              <h3 className="font-display text-lg font-semibold tracking-tight">
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </h3>
              <p className="mt-1 text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TextLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "font-semibold text-link underline underline-offset-4 hover:no-underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}
