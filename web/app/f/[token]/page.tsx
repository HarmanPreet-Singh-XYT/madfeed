import { Suspense } from "react";
import { notFound } from "next/navigation";
import { publicApi } from "@/lib/server/api";
import { Loading } from "@/components/loading";
import { PrintPageButton } from "@/components/print-page-button";
import { UnlockForm } from "./unlock-form";

export const metadata = {
  title: "Findings",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ grant?: string }>;
};

const TOKEN = /^[A-Za-z0-9._-]{20,200}$/;

function date(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(d);
}

export default function SharedFindingPage({ params, searchParams }: Props) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-10 print:max-w-none print:py-0"
    >
      <Suspense fallback={<Loading />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Body({ params, searchParams }: Props) {
  const { token } = await params;
  const { grant } = await searchParams;
  if (!TOKEN.test(token)) notFound();
  const res = await publicApi().GET("/v1/public/findings/{token}", {
    params: { path: { token }, query: { ...(grant ? { grant } : {}) } },
    cache: "no-store",
  });
  if (res.response.status === 401) {
    return (
      <div className="space-y-6 border-b border-border pb-6">
        <div
          aria-hidden="true"
          className="h-1.5 w-full rounded-full bg-gradient-to-r from-brand-1 via-brand-2 to-brand-3"
        />
        <p className="text-sm font-semibold tracking-wide text-link">
          Findings
        </p>
        <UnlockForm token={token} />
      </div>
    );
  }
  if (res.response.status === 404 || !res.data) notFound();
  const d = res.data;
  const headings = d.blocks
    .map((b, i) => ({ ...b, i }))
    .filter((b) => b.kind === "heading");
  return (
    <article className="space-y-8">
      <div className="space-y-4 border-b border-border pb-6">
        <div
          aria-hidden="true"
          className="h-1.5 w-full rounded-full bg-gradient-to-r from-brand-1 via-brand-2 to-brand-3"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold tracking-wide text-link">
            Findings
          </p>
          <div className="flex items-center gap-3">
            {d.publishedAt ? (
              <p className="text-sm text-muted-foreground">
                Shared {date(d.publishedAt)}
              </p>
            ) : null}
            {d.expiresAt ? (
              <p className="text-sm text-muted-foreground">
                Stops {date(d.expiresAt)}
              </p>
            ) : null}
            <PrintPageButton />
          </div>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          {d.title}
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          What customers told us, with their words exactly as they were said.
        </p>
      </div>

      <div className="space-y-5">
        {headings.length > 1 ? (
          <nav
            aria-label="Contents"
            className="rounded-xl border border-border bg-muted/30 p-4 print:hidden"
          >
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Contents
            </p>
            <ol className="mt-2 space-y-1 text-sm">
              {headings.map((h) => (
                <li key={h.i}>
                  <a
                    href={`#section-${h.i}`}
                    className="text-link underline-offset-4 hover:underline"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {d.blocks.map((b, i) =>
          b.kind === "heading" ? (
            <h2
              key={i}
              id={`section-${i}`}
              className="scroll-mt-6 pt-4 font-display text-2xl font-bold tracking-tight print:break-after-avoid"
            >
              {b.text}
            </h2>
          ) : b.kind === "text" ? (
            <p
              key={i}
              className="whitespace-pre-wrap text-[1.0625rem] leading-8 text-foreground/90"
            >
              {b.text}
            </p>
          ) : (
            <figure
              key={i}
              className="rounded-r-xl border-s-4 border-s-brand-2 bg-muted/40 py-4 pr-4 pl-5 print:break-inside-avoid"
            >
              <blockquote className="text-lg leading-8">“{b.text}”</blockquote>
              {b.note ? (
                <figcaption className="mt-3 text-sm text-muted-foreground">
                  {b.note}
                </figcaption>
              ) : null}
            </figure>
          ),
        )}
      </div>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground print:hidden">
        Shared findings. The quotes above are stored word for word.
      </footer>
    </article>
  );
}
