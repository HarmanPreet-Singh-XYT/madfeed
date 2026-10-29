import { Suspense } from "react";
import Link from "next/link";
import { Building2, Download, MailCheck, MailX, Plus, Users } from "lucide-react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { isUuid } from "@/lib/text";
import { ImportWizard } from "@/components/import-wizard";
import { ImportSection } from "@/components/import-section";
import { AddAccountForm, AddPersonForm, EditAccountForm } from "@/components/people-forms";
import { PeopleTable } from "@/components/people/people-table";
import { PeopleToolbar, type PersonEmailFilter } from "@/components/people/people-toolbar";
import { PeopleSkeleton } from "@/components/people/people-skeleton";
import { link } from "@/components/ui";
import { PageHeader, Stat } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Panel, Segmented } from "@/components/app/panel";
import { formatValue, plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
            {canEdit ? (
              <Button asChild className="bg-on-brand text-brand-1 hover:bg-on-brand/90">
                <Link href={tab === "people" ? "#add-person" : "#add-company"}>
                  <Plus aria-hidden="true" />
                  {tab === "people" ? "Add person" : "Add company"}
                </Link>
              </Button>
            ) : null}
            {canEdit ? (
              <Button asChild variant="outline">
                <Link href="#import">Import</Link>
              </Button>
            ) : null}
            {tab === "people" ? (
              <Button asChild variant="outline">
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

      {canEdit ? (
        <div id="import" className="scroll-mt-6">
          <ImportSection initiallyOpen={stats.total === 0 && tab === "people" && !cursor}>
            <ImportWizard workspaceId={ws.id} />
          </ImportSection>
        </div>
      ) : null}

      <Segmented label="List" items={segmented} />

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
                    <Button asChild size="sm">
                      <Link href="#add-person">Add one person</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href="#import">Import a spreadsheet</Link>
                    </Button>
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
            <p>
              <Link href={peopleNext} className={link}>
                More people
              </Link>
            </p>
          ) : null}

          {canEdit ? (
            <div id="add-person" className="scroll-mt-6">
              <Panel title="Add a person">
                <AddPersonForm
                  workspaceId={ws.id}
                  accounts={accounts.accounts.map((a) => ({ id: a.id, name: a.name }))}
                />
              </Panel>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <form method="get" role="search" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="companies" />
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor="companies-q" className="sr-only">
                Search companies by name
              </label>
              <Input
                id="companies-q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Search companies"
              />
            </div>
            <Button type="submit" variant="outline">Search</Button>
            {q ? (
              <Button asChild variant="ghost">
                <Link href={`/w/${ws.id}/people?tab=companies`}>Clear</Link>
              </Button>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground">
              {accounts.total ?? 0} {(accounts.total ?? 0) === 1 ? "company" : "companies"}
            </span>
          </form>

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
                Import a spreadsheet above, or add a company below. Company value
                is what lets a request’s impact be counted in money, not just in
                votes.
              </EmptyState>
            )
          ) : (
            <Card asChild className="gap-0 py-0">
              <ul className="divide-y divide-border">
                {accounts.accounts.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium">{a.name}</span>
                        {a.domain ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {a.domain}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        <Link
                          href={`/w/${ws.id}/people?tab=people&accountId=${a.id}`}
                          className="text-link underline underline-offset-2 hover:no-underline"
                          title={`Everyone at ${a.name}`}
                        >
                          {plural(a.peopleCount, "person", "people")}
                        </Link>
                        {a.revenue ? ` · ${formatValue(a.revenue)} revenue` : " · no revenue recorded"}
                        {a.plan ? ` · ${a.plan}` : ""}
                        {a.renewalDate ? ` · renews ${a.renewalDate}` : ""}
                      </span>
                    </div>
                    {canEdit ? (
                      <details className="mt-1">
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

          {companiesNext ? (
            <p>
              <Link href={companiesNext} className={link}>More companies</Link>
            </p>
          ) : null}

          {canEdit ? (
            <div id="add-company" className="scroll-mt-6">
              <Panel title="Add a company">
                <AddAccountForm workspaceId={ws.id} />
              </Panel>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
