import { Suspense } from "react";
import Link from "next/link";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { ImportWizard } from "@/components/import-wizard";
import { ImportSection } from "@/components/import-section";
import {
  AddAccountForm,
  AddPersonForm,
  EditAccountForm,
} from "@/components/people-forms";
import { link } from "@/components/ui";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Panel, Segmented } from "@/components/app/panel";
import { ConfirmDelete } from "@/components/confirm-delete";
import { deletePersonAction } from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { formatValue, plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "People and companies" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ tab?: string; cursor?: string; q?: string }>;
};

export default function PeoplePage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <People {...props} />
    </Suspense>
  );
}

async function People({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const { tab: rawTab, cursor, q: rawQ } = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const tab = rawTab === "companies" ? "companies" : "people";
  const q = (rawQ ?? "").trim();
  const canEdit = ws.role !== "viewer";
  const isAdmin = ws.role === "admin";
  const client = await api();
  const query = {
    limit: 50,
    ...(cursor ? { cursor } : {}),
    ...(tab === "people" && q ? { q } : {}),
  };

  // Companies are also needed to fill the "add person" picker.
  const [accounts, people] = await Promise.all([
    client
      .GET("/v1/workspaces/{workspaceId}/accounts", {
        params: {
          path: { workspaceId: ws.id },
          query: tab === "companies" ? query : { limit: 200 },
        },
      })
      .then(unwrap),
    tab === "people"
      ? client
          .GET("/v1/workspaces/{workspaceId}/people", {
            params: { path: { workspaceId: ws.id }, query },
          })
          .then(unwrap)
      : Promise.resolve(undefined),
  ]);

  return (
    <section className="space-y-5">
      <PageHeader
        icon={Users}
        hue="blue"
        title="People and companies"
        description="Knowing who asked, and what their company is worth, is what lets requests be ranked by impact instead of by volume."
      />

      {canEdit ? (
        <ImportSection
          initiallyOpen={
            accounts.accounts.length === 0 && tab === "people" && !cursor
          }
        >
          <ImportWizard workspaceId={ws.id} />
        </ImportSection>
      ) : null}

      <Segmented
        label="List"
        items={(["people", "companies"] as const).map((t) => ({
          href: `/w/${ws.id}/people?tab=${t}${
            t === "people" && q ? `&q=${encodeURIComponent(q)}` : ""
          }`,
          label: t === "people" ? "People" : "Companies",
          active: t === tab,
        }))}
      />

      {tab === "people" && people ? (
        <div className="space-y-4">
          <form
            method="get"
            role="search"
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="tab" value="people" />
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor="people-q" className="sr-only">
                Search people by name or email
              </label>
              <Input
                id="people-q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Search name or email"
              />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
            {q ? (
              <Button asChild variant="ghost">
                <Link href={`/w/${ws.id}/people?tab=people`}>Clear</Link>
              </Button>
            ) : null}
          </form>
          {people.people.length === 0 ? (
            <EmptyState
              icon={Users}
              title={q ? "No people match." : "No people yet."}
            >
              {q ? (
                <>
                  No name or email matches “{q}”.{" "}
                  <Link
                    href={`/w/${ws.id}/people?tab=people`}
                    className={link}
                  >
                    Clear the search
                  </Link>
                </>
              ) : (
                "Import a spreadsheet above, or add one below."
              )}
            </EmptyState>
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <div
                role="region"
                aria-label="People, scrolls sideways on small screens"
                tabIndex={0}
                className="overflow-x-auto"
              >
                <Table containerClassName="overflow-visible">
                  <TableCaption className="sr-only">People</TableCaption>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="border-b border-border bg-muted/50 px-4 text-xs font-medium text-muted-foreground">
                        Name
                      </TableHead>
                      <TableHead className="border-b border-border bg-muted/50 px-4 text-xs font-medium text-muted-foreground">
                        Email
                      </TableHead>
                      <TableHead className="border-b border-border bg-muted/50 px-4 text-xs font-medium text-muted-foreground">
                        Company
                      </TableHead>
                      {isAdmin ? (
                        <TableHead className="border-b border-border bg-muted/50 px-4 text-xs font-medium text-muted-foreground">
                          Delete
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {people.people.map((p) => (
                      <TableRow key={p.id}>
                        <TableHead
                          scope="row"
                          className="border-b border-border px-4 py-2 font-medium"
                        >
                          {p.name}
                        </TableHead>
                        <TableCell className="border-b border-border px-4 py-2 text-muted-foreground">
                          {p.email ?? ""}
                        </TableCell>
                        <TableCell className="border-b border-border px-4 py-2 text-muted-foreground">
                          {p.accountName ?? ""}
                        </TableCell>
                        {isAdmin ? (
                          <TableCell className="border-b border-border px-4 py-2 text-muted-foreground">
                            <ConfirmDelete
                              compact
                              label={`Delete ${p.name}`}
                              consequences={`This removes ${p.name}, everything they said (quotes, conversations, recordings and highlights) and any messages written to them. Their opt-out, if they have one, is kept so nobody can write to them again. This can't be undone.`}
                              confirmLabel={`Yes, delete ${p.name}`}
                              action={deletePersonAction.bind(
                                null,
                                ws.id,
                                p.id,
                              )}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
          {people.nextCursor ? (
            <Link
              href={`/w/${ws.id}/people?tab=people&cursor=${encodeURIComponent(
                people.nextCursor,
              )}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={link}
            >
              More people
            </Link>
          ) : null}
          {canEdit ? (
            <Panel title="Add a person">
              <AddPersonForm
                workspaceId={ws.id}
                accounts={accounts.accounts.map((a) => ({
                  id: a.id,
                  name: a.name,
                }))}
              />
            </Panel>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.accounts.length === 0 ? (
            <EmptyState icon={Users} title="No companies yet.">
              Import a spreadsheet above, or add one below.
            </EmptyState>
          ) : (
            <Card asChild className="gap-0 py-0">
              <ul className="divide-y divide-border">
                {accounts.accounts.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {plural(a.peopleCount, "person", "people")}
                        {a.revenue
                          ? ` · ${formatValue(a.revenue)} revenue`
                          : " · no revenue recorded"}
                        {a.plan ? ` · ${a.plan}` : ""}
                        {a.renewalDate ? ` · renews ${a.renewalDate}` : ""}
                      </span>
                    </div>
                    {canEdit ? (
                      <details>
                        <summary className="inline-flex min-h-8 cursor-pointer items-center text-sm text-link underline">
                          Edit
                        </summary>
                        <EditAccountForm
                          workspaceId={ws.id}
                          account={{
                            id: a.id,
                            name: a.name,
                            revenue: a.revenue,
                            plan: a.plan,
                            renewalDate: a.renewalDate,
                            domain: a.domain,
                          }}
                        />
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {accounts.nextCursor && tab === "companies" ? (
            <Link
              href={`/w/${ws.id}/people?tab=companies&cursor=${encodeURIComponent(accounts.nextCursor)}`}
              className={link}
            >
              More companies
            </Link>
          ) : null}
          {canEdit ? (
            <Panel title="Add a company">
              <AddAccountForm workspaceId={ws.id} />
            </Panel>
          ) : null}
        </div>
      )}
    </section>
  );
}
