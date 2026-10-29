import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, Lightbulb } from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { getShell, getWorkspace } from "@/lib/server/queries";
import { formatValue } from "@/lib/format";
import { MODULE_NAMES, visibleNav } from "@/lib/modules";
import { Loading } from "@/components/loading";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { StatusPill } from "@/components/app/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Overview" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function WorkspaceHome(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Overview {...props} />
    </Suspense>
  );
}

async function Overview({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const shell = await getShell(ws.id);
  const base = `/w/${ws.id}`;

  // A plan without the feedback tool still gets a way in: the pages it does have.
  if (!shell.modules.includes("feedback")) {
    const items = visibleNav(shell.modules).filter(
      (n) => n.path !== "settings",
    );
    return (
      <section className="space-y-4">
        <PageHeader title="Overview" description={`Welcome to ${ws.name}.`} />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((n) => (
            <li key={n.path}>
              <Card asChild className="[--card-spacing:0px] p-0">
                <Link
                  href={`${base}/${n.path}`}
                  className="flex flex-row items-center justify-between p-4 font-medium transition-colors hover:bg-muted"
                >
                  <span>
                    {n.label}
                    {n.module ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {MODULE_NAMES[n.module]}
                      </span>
                    ) : null}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const { requests } = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/requests", {
      params: {
        path: { workspaceId: ws.id },
        query: { limit: 25, sort: "value" },
      },
    }),
  );
  const waiting = shell.waitingProposals;
  const drafts = shell.openOutreach;
  const top = requests.slice(0, 6);
  const shipped = requests.some((r) => r.status.bucket === "done");

  const steps = [
    {
      done: requests.length > 0 || waiting > 0,
      title: "Add a customer conversation",
      body: "Paste a call, an email or a chat. Anything with customers talking.",
      href: `${base}/add`,
      cta: "Add feedback",
    },
    {
      done: requests.length > 0,
      title: "Review what we found",
      body: "Each suggestion shows the customer's exact words. Accept the real ones.",
      href: `${base}/review`,
      cta: "Open review",
    },
    {
      done: shipped,
      title: "Ship a request and tell the people who asked",
      body: "Move a request to a shipped status. You approve each message before it goes.",
      href: `${base}/requests`,
      cta: "Open requests",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  const attention = [
    {
      n: waiting,
      label: waiting === 1 ? "suggestion to review" : "suggestions to review",
      href: `${base}/review`,
    },
    {
      n: drafts,
      label:
        drafts === 1
          ? "message waiting for approval"
          : "messages waiting for approval",
      href: `${base}/outreach`,
    },
  ].filter((a) => a.n > 0);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Overview"
        description="What needs you, and what customers are asking for most."
      />

      {attention.length > 0 ? (
        <ul
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Needs your attention"
        >
          {attention.map((a) => (
            <li key={a.href}>
              <Card asChild className="[--card-spacing:0px] p-0">
                <Link
                  href={a.href}
                  className="group flex flex-row items-center gap-4 p-4 transition-colors hover:bg-muted"
                >
                  <span className="text-3xl font-semibold tracking-tight text-primary tabular-nums">
                    {a.n}
                  </span>
                  <span className="flex-1 text-sm font-medium">{a.label}</span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      ) : requests.length > 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-tint-teal px-4 py-3 text-sm">
          <Check aria-hidden="true" className="size-4 text-hue-teal" />
          You&apos;re all caught up. Nothing is waiting for you.
        </p>
      ) : null}

      <div
        className={`grid items-start gap-5 ${doneCount < steps.length ? "lg:grid-cols-[minmax(0,1fr)_20rem]" : ""}`}
      >
        {top.length > 0 ? (
          <Panel
            title="Most asked for"
            description="Weighed by the accounts behind each request, every account counted once."
            actions={
              <Link
                href={`${base}/requests`}
                className="text-sm text-link underline-offset-2 hover:underline"
              >
                View all requests
              </Link>
            }
            className="[&_[data-slot=card-content]]:p-0"
          >
            <ul className="divide-y divide-border">
              {top.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`${base}/requests/${r.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {r.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {r.impact.peopleCount}{" "}
                        {r.impact.peopleCount === 1 ? "person" : "people"} ·{" "}
                        {r.impact.evidenceCount}{" "}
                        {r.impact.evidenceCount === 1 ? "quote" : "quotes"}
                      </span>
                    </span>
                    <span className="w-20 text-right text-sm font-medium tabular-nums">
                      {r.impact.accountsWithValue > 0
                        ? formatValue(r.impact.totalValue)
                        : "—"}
                    </span>
                    <StatusPill name={r.status.name} bucket={r.status.bucket} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <EmptyState icon={Lightbulb} title="No requests yet.">
            Add a conversation and accept what we find to create your first one.
          </EmptyState>
        )}

        {doneCount < steps.length ? (
          <Panel
            title="Get started"
            description={`${doneCount} of ${steps.length} done`}
          >
            <div
              role="progressbar"
              aria-label="Getting started"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={doneCount}
              className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
            <ol className="space-y-3">
              {steps.map((s) => (
                <li key={s.title} className="flex gap-3">
                  {s.done ? (
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-hue-teal"
                    />
                  ) : (
                    <Circle
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                  )}
                  <div className="min-w-0 text-sm">
                    <p
                      className={
                        s.done
                          ? "text-muted-foreground line-through"
                          : "font-medium"
                      }
                    >
                      {s.title}
                      {s.done ? <span className="sr-only"> (done)</span> : null}
                    </p>
                    {s === next ? (
                      <>
                        <p className="mt-0.5 text-muted-foreground">{s.body}</p>
                        <Button asChild size="sm" className="mt-2">
                          <Link href={s.href}>{s.cta}</Link>
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}
      </div>
    </section>
  );
}
