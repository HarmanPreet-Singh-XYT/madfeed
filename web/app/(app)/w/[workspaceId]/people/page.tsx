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
import { card, link } from "@/components/ui";
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
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">People and companies</h1>
        <p className="text-muted">
          Knowing who asked, and what their company is worth, is what lets
          requests be ranked by impact instead of by volume.
        </p>
      </div>

      {canEdit ? (
        <ImportSection
          initiallyOpen={
            accounts.accounts.length === 0 && tab === "people" && !cursor
          }
        >
          <ImportWizard workspaceId={ws.id} />
        </ImportSection>
      ) : null}

      <nav aria-label="List" className="flex gap-2">
        {(["people", "companies"] as const).map((t) => (
          <Link
            key={t}
            href={`/w/${ws.id}/people?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${t === tab ? "border-foreground" : "border-border text-muted hover:bg-surface"}`}
          >
            {t === "people" ? "People" : "Companies"}
          </Link>
        ))}
      </nav>

      {tab === "people" && people ? (
        <div className="space-y-4">
          {people.people.length === 0 ? (
            <p className="text-muted">
              No people yet. Import a spreadsheet above, or add one below.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">People</caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="border-b border-border px-2 py-2 font-medium"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="border-b border-border px-2 py-2 font-medium"
                    >
                      Email
                    </th>
                    <th
                      scope="col"
                      className="border-b border-border px-2 py-2 font-medium"
                    >
                      Company
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.people.map((p) => (
                    <tr key={p.id}>
                      <th
                        scope="row"
                        className="border-b border-border px-2 py-2 font-normal"
                      >
                        {p.name}
                      </th>
                      <td className="border-b border-border px-2 py-2">
                        {p.email ?? ""}
                      </td>
                      <td className="border-b border-border px-2 py-2">
                        {p.accountName ?? ""}
                      </td>
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
            <div className={card}>
              <h2 className="mb-3 font-medium">Add a person</h2>
              <AddPersonForm
                workspaceId={ws.id}
                accounts={accounts.accounts.map((a) => ({
                  id: a.id,
                  name: a.name,
                }))}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.accounts.length === 0 ? (
            <p className="text-muted">No companies yet.</p>
          ) : (
            <ul className="space-y-3">
              {accounts.accounts.map((a) => (
                <li key={a.id} className={card}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-sm text-muted">
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
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-accent underline">
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
            <div className={card}>
              <h2 className="mb-3 font-medium">Add a company</h2>
              <AddAccountForm workspaceId={ws.id} />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
