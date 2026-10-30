import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Circle,
  FileText,
  Inbox,
  Lightbulb,
  ListChecks,
  Mic,
  Quote,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { getShell, getWorkspace } from "@/lib/server/queries";
import { formatValue, plural } from "@/lib/format";
import { Loading } from "@/components/loading";
import { EmptyState } from "@/components/app/empty-state";
import { IconBadge, PageHeader, Stat } from "@/components/app/page-header";
import { Panel, Segmented } from "@/components/app/panel";
import { ActivityChart } from "@/components/app/activity-chart";
import { StatusPill } from "@/components/app/status-pill";
import { ActivityRow, type ActivityItem } from "@/components/app/activity-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Overview" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ days?: string }>;
};

export default function WorkspaceHome(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Overview {...props} />
    </Suspense>
  );
}

async function Overview({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const days = sp.days === "7" ? 7 : sp.days === "90" ? 90 : 30;
  const ws = await getWorkspace(workspaceId);
  const shell = await getShell(ws.id);
  const base = `/w/${ws.id}`;
  const client = await api();
  const overview = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/overview", {
      params: { path: { workspaceId: ws.id }, query: { days } },
    }),
  );
  const counts = overview.counts;
  const hasFeedback = shell.modules.includes("feedback");
  const hasResearch = shell.modules.includes("research");
  const hasSurveys = shell.modules.includes("surveys");
  const hasSupport = shell.modules.includes("support");
  const activity = overview.activity.filter((a) => {
    switch (a.kind) {
      case "request":
      case "message":
      case "release":
        return hasFeedback;
      case "finding":
        return hasResearch;
      case "survey":
        return hasSurveys;
      case "conversation":
        return hasSupport;
      case "quote":
        return a.parentKind === "source" ? hasResearch : hasFeedback;
      default:
        return false;
    }
  });
  const isEmpty =
    counts.people === 0 &&
    counts.accounts === 0 &&
    counts.quotes === 0 &&
    counts.openRequests === 0 &&
    counts.shippedRequests === 0;

  // A plan without the feedback tool still gets the same home: totals, activity and the tools it has.
  if (!hasFeedback) {
    const tools = [
      {
        show: hasSupport,
        href: `${base}/inbox`,
        label: "Inbox",
        hint: `${shell.unreadConversations} unread`,
        icon: Inbox,
        hue: "teal" as const,
      },
      {
        show: hasResearch,
        href: `${base}/quotes`,
        label: "Quotes",
        hint: `${counts.quotes} stored`,
        icon: Quote,
        hue: "amber" as const,
      },
      {
        show: hasResearch,
        href: `${base}/findings`,
        label: "Findings",
        hint: `${counts.findings} documents`,
        icon: FileText,
        hue: "coral" as const,
      },
      {
        show: hasResearch,
        href: `${base}/ask`,
        label: "Ask",
        hint: "Questions across your research",
        icon: Sparkles,
        hue: "blue" as const,
      },
      {
        show: hasResearch,
        href: `${base}/recordings`,
        label: "Recordings",
        hint: "Calls and transcripts",
        icon: Mic,
        hue: "sky" as const,
      },
      {
        show: hasSurveys,
        href: `${base}/surveys`,
        label: "Surveys",
        hint: `${counts.surveysOpen} open`,
        icon: ListChecks,
        hue: "sky" as const,
      },
    ].filter((t) => t.show);
    const start = hasResearch
      ? { href: `${base}/recordings`, label: "Open recordings" }
      : hasSurveys
        ? { href: `${base}/surveys`, label: "Open surveys" }
        : { href: `${base}/inbox`, label: "Open inbox" };

    return (
      <section className="space-y-6">
        <PageHeader
          title="Overview"
          description={
            isEmpty
              ? `Welcome to ${ws.name}. Start with the first customer conversation.`
              : `What is happening in ${ws.name}, and the tools switched on for this plan.`
          }
          actions={
            hasResearch ? (
              <Button asChild>
                <Link href={`${base}/ask`}>
                  <Sparkles aria-hidden="true" />
                  Ask
                </Link>
              </Button>
            ) : undefined
          }
        />

        {!isEmpty ? (
          <section aria-label="At a glance">
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <li>
                <Stat
                  label="People"
                  value={counts.people}
                  hint={`${counts.accounts} companies`}
                  icon={Users}
                  hue="sky"
                />
              </li>
              <li>
                <Stat
                  label="Quotes"
                  value={counts.quotes}
                  hint="Stored word for word"
                  icon={Quote}
                  hue="amber"
                />
              </li>
              <li>
                <Stat
                  label="Findings"
                  value={counts.findings}
                  hint="Documents written"
                  icon={FileText}
                  hue="coral"
                />
              </li>
              <li>
                <Stat
                  label="Open surveys"
                  value={counts.surveysOpen}
                  hint="Collecting answers"
                  icon={ListChecks}
                  hue="teal"
                />
              </li>
            </ul>
          </section>
        ) : (
          <EmptyState icon={Sparkles} title="Nothing here yet.">
            Add a recording or a survey, then the research and support tools
            fill this page.{" "}
            <Link href={start.href} className="underline underline-offset-4">
              {start.label}
            </Link>
          </EmptyState>
        )}

        <ActivityPanel base={base} activity={activity} />

        {tools.length > 0 ? (
          <Panel
            title="Your workspace"
            description="The tools switched on for this plan."
            className="[&_[data-slot=card-content]]:p-3"
          >
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((t) => (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
                  >
                    <IconBadge
                      icon={t.icon}
                      hue={t.hue}
                      className="size-8 rounded-lg shadow-none [&_svg]:size-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {t.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t.hint}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </section>
    );
  }

  const top = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/requests", {
      params: {
        path: { workspaceId: ws.id },
        query: { limit: 6, sort: "value" },
      },
    }),
  ).requests;
  const attention = [
    hasFeedback && counts.suggestionsWaiting > 0
      ? {
          n: counts.suggestionsWaiting,
          label: plural(counts.suggestionsWaiting, "suggestion") + " to review",
          hint: "Accept what customers really asked for.",
          href: `${base}/review`,
          icon: Sparkles,
          tint: "bg-tint-amber text-hue-amber",
        }
      : null,
    hasFeedback && counts.messagesWaiting > 0
      ? {
          n: counts.messagesWaiting,
          label: plural(counts.messagesWaiting, "message") + " waiting",
          hint: "Read each draft before it goes out.",
          href: `${base}/outreach`,
          icon: Send,
          tint: "bg-tint-blue text-hue-blue",
        }
      : null,
    hasSupport && shell.unreadConversations > 0
      ? {
          n: shell.unreadConversations,
          label:
            plural(shell.unreadConversations, "unread conversation") +
            (shell.unreadConversations === 1 ? "" : "s"),
          hint: "Reply from the shared inbox.",
          href: `${base}/inbox`,
          icon: Inbox,
          tint: "bg-tint-teal text-hue-teal",
        }
      : null,
  ].filter((a) => a !== null);

  const steps = [
    {
      done: counts.people > 0 || counts.quotes > 0,
      title: "Add a customer conversation",
      body: "Paste a call, an email or a chat. Anything with customers talking.",
      href: `${base}/add`,
      cta: "Add feedback",
    },
    {
      done: counts.openRequests > 0 || counts.shippedRequests > 0,
      title: "Review what we found",
      body: "Each suggestion shows the customer's exact words. Accept the real ones.",
      href: `${base}/review`,
      cta: "Open review",
    },
    {
      done: counts.shippedRequests > 0,
      title: "Ship a request and tell the people who asked",
      body: "Move a request to a shipped status. You approve each message before it goes.",
      href: `${base}/requests`,
      cta: "Open requests",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  const tools = [
    {
      show: hasFeedback,
      href: `${base}/requests`,
      label: "Requests",
      hint: `${counts.openRequests} open`,
      icon: Lightbulb,
      hue: "blue" as const,
    },
    {
      show: hasFeedback,
      href: `${base}/review`,
      label: "Review",
      hint: `${counts.suggestionsWaiting} waiting`,
      icon: ListChecks,
      hue: "amber" as const,
    },
    {
      show: hasFeedback,
      href: `${base}/outreach`,
      label: "Messages",
      hint: `${counts.messagesWaiting} to approve`,
      icon: Send,
      hue: "sky" as const,
    },
    {
      show: hasSupport,
      href: `${base}/inbox`,
      label: "Inbox",
      hint: `${shell.unreadConversations} unread`,
      icon: Inbox,
      hue: "teal" as const,
    },
    {
      show: hasFeedback,
      href: `${base}/findings`,
      label: "Findings",
      hint: `${counts.findings} documents`,
      icon: FileText,
      hue: "coral" as const,
    },
    {
      show: hasResearch,
      href: `${base}/quotes`,
      label: "Quotes",
      hint: `${counts.quotes} stored`,
      icon: Quote,
      hue: "amber" as const,
    },
    {
      show: hasSurveys,
      href: `${base}/surveys`,
      label: "Surveys",
      hint: `${counts.surveysOpen} open`,
      icon: Users,
      hue: "sky" as const,
    },
    {
      show: hasFeedback,
      href: `${base}/releases`,
      label: "Release notes",
      hint: `${counts.releasesPublished} published`,
      icon: BookOpen,
      hue: "teal" as const,
    },
  ].filter((t) => t.show);

  return (
    <section className="space-y-6">
      <PageHeader
        title="Overview"
        description={
          isEmpty
            ? `Welcome to ${ws.name}. Start with one customer conversation.`
            : `What needs you in ${ws.name}, and what customers are asking for most.`
        }
        actions={
          <>
            {shell.role !== "viewer" ? (
              <Button asChild>
                <Link href={`${base}/add`}>
                  <Lightbulb aria-hidden="true" />
                  Add feedback
                </Link>
              </Button>
            ) : null}
            {hasResearch ? (
              <Button asChild variant="outline">
                <Link href={`${base}/ask`}>
                  <Sparkles aria-hidden="true" />
                  Ask
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {attention.length > 0 ? (
        <section aria-labelledby="attention-h" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="attention-h"
              className="font-heading text-lg font-semibold tracking-tight"
            >
              Needs you
            </h2>
            <p className="text-sm text-muted-foreground">
              The few things only a person can decide.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {attention.map((a) => (
              <li key={a.href}>
                <Card asChild className="[--card-spacing:0px] p-0">
                  <Link
                    href={a.href}
                    className="group flex flex-row items-start gap-3 p-4 transition-colors hover:bg-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${a.tint}`}
                    >
                      <a.icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-2xl font-semibold tracking-tight tabular-nums">
                        {a.n}
                      </span>
                      <span className="block text-sm font-medium">
                        {a.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {a.hint}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : counts.people > 0 || counts.quotes > 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-tint-teal px-4 py-3 text-sm">
          <Check aria-hidden="true" className="size-4 text-hue-teal" />
          You&apos;re all caught up. Nothing is waiting for you.
        </p>
      ) : null}

      {!isEmpty ? (
        <section aria-label="At a glance">
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <li>
              <Stat
                label="Open requests"
                value={counts.openRequests}
                hint={
                  counts.requestsLast7d > 0
                    ? `${counts.requestsLast7d} new in the last 7 days`
                    : "No new requests this week"
                }
                icon={Lightbulb}
                hue="blue"
              />
            </li>
            <li>
              <Stat
                label="Shipped"
                value={counts.shippedRequests}
                hint="Requests marked done"
                icon={Check}
                hue="teal"
              />
            </li>
            <li>
              <Stat
                label="Quotes"
                value={counts.quotes}
                hint={
                  counts.quotesLast7d > 0
                    ? `${counts.quotesLast7d} new in the last 7 days`
                    : "Stored word for word"
                }
                icon={Quote}
                hue="amber"
              />
            </li>
            <li>
              <Stat
                label="People"
                value={counts.people}
                hint={
                  counts.peopleLast7d > 0
                    ? `${counts.peopleLast7d} new in the last 7 days`
                    : `${counts.accounts} companies`
                }
                icon={Users}
                hue="sky"
              />
            </li>
          </ul>
        </section>
      ) : null}

      {!isEmpty ? (
        <Panel
          title="Momentum"
          description="New requests, quotes and sent messages per day."
          actions={
            <Segmented
              label="Chart range"
              items={[7, 30, 90].map((n) => ({
                href: `${base}?days=${n}`,
                label: `${n} days`,
                active: days === n,
              }))}
            />
          }
          className="[&_[data-slot=card-content]]:px-0 pb-0"
        >
          <ActivityChart series={overview.series} days={days} />
        </Panel>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
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
              <ol className="divide-y divide-border">
                {top.map((r, i) => (
                  <li key={r.id}>
                    <Link
                      href={`${base}/requests/${r.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
                    >
                      <span className="w-5 shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {r.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {plural(r.impact.peopleCount, "person", "people")} ·{" "}
                          {plural(r.impact.evidenceCount, "quote")}
                        </span>
                      </span>
                      <span className="w-20 text-right text-sm font-medium tabular-nums">
                        {r.impact.accountsWithValue > 0
                          ? formatValue(r.impact.totalValue)
                          : "—"}
                      </span>
                      <StatusPill
                        name={r.status.name}
                        bucket={r.status.bucket}
                      />
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    </Link>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : (
            <EmptyState icon={Lightbulb} title="No requests yet.">
              Add a conversation and accept what we find to create your first
              one.
              <span className="mt-3 flex justify-center">
                <Button asChild>
                  <Link href={`${base}/add`}>Add your first feedback</Link>
                </Button>
              </span>
            </EmptyState>
          )}

          <ActivityPanel base={base} activity={activity} />
        </div>

        <div className="space-y-5">
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
                        {s.done ? (
                          <span className="sr-only"> (done)</span>
                        ) : null}
                      </p>
                      {s === next ? (
                        <>
                          <p className="mt-0.5 text-muted-foreground">
                            {s.body}
                          </p>
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

          {tools.length > 0 ? (
            <Panel
              title="Your workspace"
              description="The tools switched on for this plan."
              className="[&_[data-slot=card-content]]:p-3"
            >
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {tools.map((t) => (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
                    >
                      <IconBadge
                        icon={t.icon}
                        hue={t.hue}
                        className="size-8 rounded-lg shadow-none [&_svg]:size-4"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {t.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t.hint}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ActivityPanel({
  base,
  activity,
}: {
  base: string;
  activity: ActivityItem[];
}) {
  if (activity.length === 0) return null;
  return (
    <Panel
      title="Recent activity"
      description="What changed across the workspace, newest first."
      actions={
        <Link
          href={`${base}/activity`}
          className="text-sm text-link underline-offset-2 hover:underline"
        >
          View all activity
        </Link>
      }
      className="[&_[data-slot=card-content]]:p-0"
    >
      <ul className="divide-y divide-border">
        {activity.map((a) => (
          <li key={`${a.kind}-${a.id}-${a.at}`}>
            <ActivityRow base={base} item={a} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
