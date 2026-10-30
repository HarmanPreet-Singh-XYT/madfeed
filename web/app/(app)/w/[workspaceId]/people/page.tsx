import { Suspense } from "react";
import Link from "next/link";
import { Building2, Download, MailCheck, MailX, Plus, Users } from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { ImportDialog } from "@/components/import-dialog";
import { AddAccountDialog } from "@/components/people/add-account-dialog";
import { AddPersonDialog } from "@/components/people/add-person-dialog";
import { CompanyList } from "@/components/people/company-list";
import { CompanyToolbar } from "@/components/people/company-toolbar";
import { PeopleTable } from "@/components/people/people-table";
import { PeopleToolbar, type PersonEmailFilter } from "@/components/people/people-toolbar";
import { PeopleSkeleton } from "@/components/people/people-skeleton";
import { PageHeader, Stat } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Segmented } from "@/components/app/panel";
import { Button } from "@/components/ui/button";

export const metadata = { title: "People and companies" };

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    tab?: string;
    cursor?: string;
    q?: string;
    accountId?: string;
    email?: string;
  }>;
};

export default function PeoplePage(props: Props) {
  return (
    <Suspense fallback={<PeopleSkeleton />}>
      <People {...props} />
    </Suspense>
  );
}

async function People({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const ws = await getWorkspace(workspaceId);
  const tab = sp.tab === "companies" ? "companies" : "people";
  const q = (sp.q ?? "").trim().slice(0, 200);
  const cursor = sp.cursor ?? "";
  const accountId = sp.accountId && isUuid(sp.accountId) ? sp.accountId : undefined;
  const email: PersonEmailFilter =
    sp.email === "with" || sp.email === "without" ? sp.email : "";
  const canEdit = ws.role !== "viewer";
  const isAdmin = ws.role === "admin";
  const client = await api();

  const accountQuery = {
    limit: 50,
    ...(cursor && tab === "companies" ? { cursor } : {}),
    ...(tab === "companies" && q ? { q } : {}),
  };

  const [accountsRes, peopleRes, accountRes, companyStatsRes] = await Promise.all([
    client
      .GET("/v1/workspaces/{workspaceId}/accounts", {
        params: {
          path: { workspaceId: ws.id },
          // A short list fills the "add person" and filter pickers; the companies tab pages through all.
          query: tab === "companies" ? accountQuery : { limit: 100 },
        },
      })
      .then(unwrap),
    tab === "people"
      ? client
          .GET("/v1/workspaces/{workspaceId}/people", {
            params: {
              path: { workspaceId: ws.id },
              query: {
                limit: 50,
                ...(cursor ? { cursor } : {}),
                ...(q ? { q } : {}),
                ...(accountId ? { accountId } : {}),
                ...(email ? { email } : {}),
              },
            },
          })
          .then(unwrap)
      : client
          .GET("/v1/workspaces/{workspaceId}/people", {
            params: { path: { workspaceId: ws.id }, query: { limit: 1 } },
          })
          .then(unwrap),
    accountId
      ? client
          .GET("/v1/workspaces/{workspaceId}/accounts/{accountId}", {
            params: { path: { workspaceId: ws.id, accountId } },
          })
          .then((r) => (r.response.ok ? unwrap(r) : undefined))
      : Promise.resolve(undefined),
    // The tile is the whole directory even while the companies tab is searched.
    tab === "companies" && q
      ? client
          .GET("/v1/workspaces/{workspaceId}/accounts", {
            params: { path: { workspaceId: ws.id }, query: { limit: 1 } },
          })
          .then(unwrap)
      : Promise.resolve(undefined),
  ]);

  const people = peopleRes;
  const stats = people.stats;
  const accounts = accountsRes;

  const filtered = Boolean(q || accountId || email);
  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (accountId) exportParams.set("accountId", accountId);
  if (email) exportParams.set("email", email);

  const peopleNext = people.nextCursor
    ? `/w/${ws.id}/people?tab=people&cursor=${encodeURIComponent(people.nextCursor)}${
        q ? `&q=${encodeURIComponent(q)}` : ""
      }${accountId ? `&accountId=${accountId}` : ""}${email ? `&email=${email}` : ""}`
    : undefined;
  const companiesNext = accounts.nextCursor
    ? `/w/${ws.id}/people?tab=companies&cursor=${encodeURIComponent(accounts.nextCursor)}${
        q ? `&q=${encodeURIComponent(q)}` : ""
      }`
    : undefined;

  const segmented = [
    {
      href: `/w/${ws.id}/people?tab=people`,
      label: "People",
      active: tab === "people",
    },
    {
      href: `/w/${ws.id}/people?tab=companies`,
      label: "Companies",
      active: tab === "companies",
    },
  ];

  return (
    <section className="space-y-5">
      <PageHeader
        title="People and companies"
        description="Who asked, what they said, and what their company is worth — so requests can be ranked by impact instead of volume."
        actions={
          <>
            {canEdit && tab === "people" ? (
              <AddPersonDialog
                workspaceId={ws.id}
                accounts={accounts.accounts.map((a) => ({ id: a.id, name: a.name }))}
                trigger={
                  <Button
                    type="button"
                    className="bg-on-brand text-brand-1 hover:bg-on-brand/90"
                  >
                    <Plus aria-hidden="true" />
                    Add person
                  </Button>
                }
              />
            ) : null}
            {canEdit && tab === "companies" ? (
              <AddAccountDialog
                workspaceId={ws.id}
                trigger={
                  <Button
                    type="button"
                    className="bg-on-brand text-brand-1 hover:bg-on-brand/90"
                  >
                    <Plus aria-hidden="true" />
                    Add company
                  </Button>
                }
              />
            ) : null}
            {canEdit ? (
              <ImportDialog
                workspaceId={ws.id}
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-on-brand hover:bg-on-brand/15 hover:text-on-brand"
                  >
                    Import
                  </Button>
                }
              />
            ) : null}
            {tab === "people" ? (
              <Button
                asChild
                variant="ghost"
                className="text-on-brand hover:bg-on-brand/15 hover:text-on-brand"
              >
                <a href={`/w/${ws.id}/people/export?${exportParams.toString()}`}>
                  <Download aria-hidden="true" /> Export
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="People" value={stats.total} icon={Users} hue="blue" />
        <Stat
          label="Companies"
          value={companyStatsRes?.total ?? accounts.total ?? 0}
          icon={Building2}
          hue="teal"
        />
        <Stat label="With an email" value={stats.withEmail} icon={MailCheck} hue="sky" />
        <Stat label="No email yet" value={stats.withoutEmail} icon={MailX} hue="amber" />
      </div>

      <Segmented label="Directory" items={segmented} />

      {tab === "people" ? (
        <div className="space-y-4">
          <PeopleToolbar
            workspaceId={ws.id}
            q={q}
            account={
              accountRes
                ? { id: accountRes.id, name: accountRes.name }
                : undefined
            }
            email={email}
            total={people.total}
            loaded={people.people.length}
          />

          {people.people.length === 0 ? (
            filtered ? (
              <EmptyState icon={Users} title="No people match">
                <span className="block space-y-3">
                  <span className="block">
                    Nothing in the directory matches those filters.
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/w/${ws.id}/people?tab=people`}>Clear all filters</Link>
                  </Button>
                </span>
              </EmptyState>
            ) : (
              <EmptyState icon={Users} title="No people yet">
                <span className="block space-y-3">
                  <span className="block">
                    People appear when you import a spreadsheet, add someone
                    below, or a customer writes in. Their company decides which
                    account their requests count towards.
                  </span>
                  <span className="flex flex-wrap justify-center gap-2">
                    <AddPersonDialog
                      workspaceId={ws.id}
                      accounts={accounts.accounts.map((a) => ({
                        id: a.id,
                        name: a.name,
                      }))}
                      trigger={
                        <Button type="button" size="sm">
                          Add one person
                        </Button>
                      }
                    />
                    <ImportDialog
                      workspaceId={ws.id}
                      trigger={
                        <Button type="button" variant="outline" size="sm">
                          Import a spreadsheet
                        </Button>
                      }
                    />
                  </span>
                </span>
              </EmptyState>
            )
          ) : (
            <PeopleTable
              workspaceId={ws.id}
              rows={people.people}
              accounts={accounts.accounts}
              canEdit={canEdit}
              isAdmin={isAdmin}
            />
          )}

          {peopleNext ? (
            <div className="flex justify-center">
              <Button asChild variant="outline" size="sm">
                <Link href={peopleNext}>More people</Link>
              </Button>
            </div>
          ) : null}

        </div>
      ) : (
        <div className="space-y-4">
          <CompanyToolbar q={q} total={accounts.total ?? 0} />

          {accounts.accounts.length === 0 ? (
            q ? (
              <EmptyState icon={Building2} title="No companies match">
                <span className="block space-y-3">
                  <span className="block">Nothing matches “{q}”.</span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/w/${ws.id}/people?tab=companies`}>Clear the search</Link>
                  </Button>
                </span>
              </EmptyState>
            ) : (
              <EmptyState icon={Building2} title="No companies yet">
                Add a company from the button above, or import a spreadsheet with
                a company column. Company value is what lets a request’s impact be
                counted in money, not just in votes.
              </EmptyState>
            )
          ) : (
            <CompanyList
              workspaceId={ws.id}
              rows={accounts.accounts}
              canEdit={canEdit}
              isAdmin={isAdmin}
            />
          )}

          {companiesNext ? (
            <div className="flex justify-center">
              <Button asChild variant="outline" size="sm">
                <Link href={companiesNext}>More companies</Link>
              </Button>
            </div>
          ) : null}

        </div>
      )}
    </section>
  );
}
