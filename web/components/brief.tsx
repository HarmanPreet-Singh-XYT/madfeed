import type { components } from "@/lib/api/schema.gen";
import { Quote } from "./quote";
import { BriefButton } from "./brief-button";
import { Loader2 } from "lucide-react";
import { SourceStatus } from "./source-status";
import { link } from "./ui";
import { Card } from "@/components/ui/card";
import { formatValue, plural } from "@/lib/format";
import Link from "next/link";

type BriefData = components["schemas"]["Brief"];

/**
 * The decision brief. The claim and the "what would change this" sentence are
 * written by the model; every number, company and date beside them is computed
 * from the data, and every quote is the customer's own words.
 */
export function Brief({
  brief,
  sources,
  workspaceId,
  requestId,
  canEdit,
  hasEvidence,
}: {
  brief: BriefData | undefined;
  sources: Map<string, string>;
  workspaceId: string;
  requestId: string;
  canEdit: boolean;
  hasEvidence: boolean;
}) {
  if (!brief) {
    return (
      <Card asChild className="[--card-spacing:0px] space-y-3 p-5">
        <section aria-labelledby="brief-h">
          <h2 id="brief-h" className="text-lg font-medium">
            Decision brief
          </h2>
          {!hasEvidence ? (
            <p className="text-muted-foreground">
              A brief needs at least one customer quote. Accept a suggestion for
              this request first.
            </p>
          ) : canEdit ? (
            <>
              <p className="text-muted-foreground">
                A short summary of what customers are asking for, with the
                quotes to back it up and what would change the picture.
              </p>
              <BriefButton
                workspaceId={workspaceId}
                requestId={requestId}
                label="Write a decision brief"
              />
            </>
          ) : (
            <p className="text-muted-foreground">
              No brief has been written yet.
            </p>
          )}
        </section>
      </Card>
    );
  }

  const f = brief.facts;
  return (
    <Card asChild className="[--card-spacing:0px] space-y-4 p-5">
      <section aria-labelledby="brief-h">
        <h2 id="brief-h" className="text-lg font-medium">
          Decision brief
        </h2>

        {brief.state === "pending" ? (
          <SourceStatus state="pending">
            <p className="flex items-start gap-2">
              <Loader2
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 animate-spin text-link"
              />
              <span>
                Writing the brief from the quotes… this usually takes under a
                minute, and the page updates itself.
              </span>
            </p>
          </SourceStatus>
        ) : null}

        {brief.state === "failed" ? (
          <div className="space-y-2">
            <p className="text-destructive">
              We couldn&apos;t write the brief
              {brief.failureReason ? ` (${brief.failureReason})` : ""}.
            </p>
            {canEdit ? (
              <BriefButton
                workspaceId={workspaceId}
                requestId={requestId}
                label="Try again"
              />
            ) : null}
          </div>
        ) : null}

        {brief.state === "ready" ? (
          <>
            {brief.stale ? (
              <div
                role="status"
                className="rounded-xl border border-border bg-background p-3 text-sm"
              >
                <p>
                  Quotes were added or removed since this was written, so it may
                  be out of date. The numbers below are always current.
                </p>
                {canEdit ? (
                  <div className="pt-2">
                    <BriefButton
                      workspaceId={workspaceId}
                      requestId={requestId}
                      label="Refresh the brief"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {brief.lowEvidence ? (
              <p role="note" className="text-sm text-muted-foreground">
                Only {plural(f.evidenceCount, "customer quote")} so far, so
                treat this as one person&apos;s view, not a pattern.
              </p>
            ) : null}

            <p className="text-lg leading-7">{brief.claim}</p>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">In their words</h3>
              <ul className="space-y-3">
                {brief.quotes.map((q) => (
                  <li key={q.evidenceId}>
                    <Quote
                      text={sources.get(q.sourceItemId)}
                      start={q.spanStart}
                      end={q.spanEnd}
                      quote={q.quote}
                    />
                    <p className="mt-1 text-sm">
                      <Link
                        href={`/w/${workspaceId}/sources/${q.sourceItemId}?s=${q.spanStart}&e=${q.spanEnd}#quote`}
                        className={link}
                      >
                        See it in the full conversation
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">Who asked</dt>
                <dd className="text-muted-foreground">
                  {plural(f.peopleCount, "person", "people")} at{" "}
                  {plural(f.accountCount, "company", "companies")}
                  {f.unidentifiedQuotes > 0
                    ? `, plus ${plural(f.unidentifiedQuotes, "quote")} from someone we don't have recorded`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Revenue behind it</dt>
                <dd className="text-muted-foreground">
                  {f.accountsWithValue > 0
                    ? `${formatValue(f.totalValue)} across ${plural(f.accountsWithValue, "company", "companies")} with a figure`
                    : "No revenue figures recorded for these companies"}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Recent activity</dt>
                <dd className="text-muted-foreground">
                  {plural(f.newLast30Days, "new quote")} in the last 30 days,{" "}
                  {plural(f.evidenceCount, "quote")} in total
                </dd>
              </div>
              {f.accounts.length > 0 ? (
                <div>
                  <dt className="font-medium">Companies</dt>
                  <dd className="text-muted-foreground">
                    {f.accounts
                      .map(
                        (a) =>
                          `${a.name}${a.revenue ? ` (${formatValue(a.revenue)})` : ""}`,
                      )
                      .join(", ")}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div>
              <h3 className="text-sm font-medium">What would change this</h3>
              <p className="text-muted-foreground">{brief.disproof}</p>
            </div>
          </>
        ) : null}
      </section>
    </Card>
  );
}
