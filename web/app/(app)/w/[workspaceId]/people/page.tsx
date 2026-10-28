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

export const metadata = { title: "People and companies" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ tab?: string; cursor?: string }>;
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
  const { tab: rawTab, cursor } = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const tab = rawTab === "companies" ? "companies" : "people";
  const canEdit = ws.role !== "viewer";
  const isAdmin = ws.role === "admin";
  const client = await api();
  const query = { limit: 50, ...(cursor ? { cursor } : {}) };

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
          href: `/w/${ws.id}/people?tab=${t}`,
          label: t === "people" ? "People" : "Companies",
          active: t === tab,
        }))}
      />

      {tab === "people" && people ? (
        <div className="space-y-4">
          {people.people.length === 0 ? (
            <EmptyState icon={Users} title="No people yet.">
              Import a spreadsheet above, or add one below.
            </EmptyState>
          ) : (
            <div
              role="region"
              aria-label="People, scrolls sideways on small screens"
              tabIndex={0}
              className="overflow-x-auto rounded-2xl bg-card shadow-card"
            >
              <table className="w-full text-left text-sm">
                <caption className="sr-only">People</caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
                    >
                      Email
                    </th>
                    <th
                      scope="col"
                      className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
                    >
                      Company
                    </th>
                    {isAdmin ? (
                      <th
                        scope="col"
                        className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground"
                      >
                        Delete
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {people.people.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/40">
                      <th
                        scope="row"
                        className="border-b border-border px-4 py-2 font-medium"
                      >
                        {p.name}
                      </th>
                      <td className="border-b border-border px-4 py-2 text-muted-foreground">
                        {p.email ?? ""}
                      </td>
                      <td className="border-b border-border px-4 py-2 text-muted-foreground">
                        {p.accountName ?? ""}
                      </td>
                      {isAdmin ? (
                        <td className="border-b border-border px-4 py-2 text-muted-foreground">
                          <ConfirmDelete
                            compact
                            label={`Delete ${p.name}`}
                            consequences={`This removes ${p.name}, everything they said (quotes, conversations, recordings and highlights) and any messages written to them. Their opt-out, if they have one, is kept so nobody can write to them again. This can't be undone.`}
                            confirmLabel={`Yes, delete ${p.name}`}
                            action={deletePersonAction.bind(null, ws.id, p.id)}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {people.nextCursor ? (
            <Link
              href={`/w/${ws.id}/people?tab=people&cursor=${encodeURIComponent(people.nextCursor)}`}
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
            <ul className="divide-y divide-border rounded-2xl bg-card shadow-card">
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
