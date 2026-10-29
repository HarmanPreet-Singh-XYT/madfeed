import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { CreateFindingForm } from "@/components/create-finding-form";
import { RestoreFinding } from "@/components/restore-finding";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel, Segmented } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";
import { link } from "@/components/ui";

export const metadata = { title: "Findings" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ q?: string; state?: string }>;
};

export default function FindingsPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Findings {...props} />
    </Suspense>
  );
}

async function Findings({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const isAdmin = ws.role === "admin";
  const q = (sp.q ?? "").trim();
  const filter =
    sp.state === "draft" || sp.state === "published"
      ? sp.state
      : sp.state === "deleted" && isAdmin
        ? "deleted"
        : "all";
  const client = await api();
  const { documents: live } = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/findings", {
      params: {
        path: { workspaceId: ws.id },
        query: { ...(q ? { q } : {}) },
      },
    }),
  );
  const buried =
    filter === "deleted"
      ? unwrap(
          await client.GET("/v1/workspaces/{workspaceId}/findings", {
            params: {
              path: { workspaceId: ws.id },
              query: { ...(q ? { q } : {}), deleted: true },
            },
          }),
        ).documents
      : [];

  const drafts = live.filter((d) => d.state === "draft").length;
  const shared = live.filter((d) => d.state === "published").length;
  const visible =
    filter === "deleted"
      ? buried
      : live.filter((d) => filter === "all" || d.state === filter);

  function hrefFor(next: string, keepQuery = true) {
    const p = new URLSearchParams();
    if (next !== "all") p.set("state", next);
    if (keepQuery && q) p.set("q", q);
    const query = p.toString();
    return `/w/${ws.id}/findings${query ? `?${query}` : ""}`;
  }

  const tabs = [
    { key: "all", label: `All ${live.length}` },
    { key: "draft", label: `Drafts ${drafts}` },
    { key: "published", label: `Shared ${shared}` },
    ...(isAdmin ? [{ key: "deleted", label: "Recently deleted" }] : []),
  ];

  return (
    <section className="space-y-6">
      <PageHeader
        icon={FileText}
        hue="blue"
        title="Findings"
        description="Write up what you learned. Paragraphs of your own, and cards that show the customer's exact words, always as they are stored, so a quote can never drift from what was said."
        actions={
          ws.role !== "viewer" ? (
            <Button asChild>
              <Link href="#new-document">
                <Plus aria-hidden="true" />
                New document
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          method="get"
          role="search"
          className="flex flex-wrap items-end gap-2"
        >
          {filter !== "all" ? (
            <input type="hidden" name="state" value={filter} />
          ) : null}
          <div className="min-w-0 flex-1 sm:w-72">
            <label htmlFor="findings-q" className="sr-only">
              Search findings by title or words in the document
            </label>
            <Input
              id="findings-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search title or words"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
          {q ? (
            <Button asChild variant="ghost">
              <Link href={hrefFor(filter, false)}>Clear</Link>
            </Button>
          ) : null}
        </form>
        <p className="text-xs text-muted-foreground">
          {plural(live.length, "document")} · {drafts} draft
          {drafts === 1 ? "" : "s"} · {shared} shared
        </p>
      </div>

      <Segmented
        label="Filter findings"
        items={tabs.map((t) => ({
          href: hrefFor(t.key),
          label: t.label,
          active: filter === t.key,
        }))}
      />

      {ws.role !== "viewer" ? (
        <div id="new-document" className="scroll-mt-4">
          <Panel title="Start a document">
            <CreateFindingForm workspaceId={ws.id} />
          </Panel>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={
            filter === "deleted"
              ? "Nothing is in recently deleted."
              : q || filter !== "all"
                ? "No documents match."
                : "No documents yet."
          }
        >
          {filter === "deleted" ? (
            "Documents you delete move here, so they can be brought back."
          ) : q || filter !== "all" ? (
            <>
              {q ? <>Nothing matches “{q}”. </> : null}
              <Link href={hrefFor("all", false)} className={link}>
                Show every document
              </Link>
            </>
          ) : (
            "Start one above to write up what you learned."
          )}
        </EmptyState>
      ) : (
        <Card asChild className="[--card-spacing:0px] py-0">
          <ul className="divide-y divide-border">
            {visible.map((d) => (
              <li key={d.id}>
                {d.deletedAt ? (
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <FileText
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {plural(d.blocks, "block")} · deleted{" "}
                        <LocalTime iso={d.deletedAt} />
                      </p>
                    </div>
                    <Badge variant="muted" className="h-6 px-2.5">
                      Deleted
                    </Badge>
                    {isAdmin ? (
                      <RestoreFinding
                        workspaceId={ws.id}
                        docId={d.id}
                        title={d.title}
                      />
                    ) : null}
                  </div>
                ) : (
                  <Link
                    href={`/w/${ws.id}/findings/${d.id}`}
                    className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <FileText
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {plural(d.blocks, "block")} · changed{" "}
                        <LocalTime iso={d.updatedAt} />
                      </p>
                    </div>
                    <Badge
                      variant={d.state === "published" ? "tint-teal" : "muted"}
                      className="h-6 px-2.5"
                    >
                      {d.state === "published" ? "Shared by link" : "Draft"}
                    </Badge>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
