import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { Bullets, Page, Section, Updated } from "@/components/site/blocks";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How customer data is isolated, protected, retained and deleted, and how to report a vulnerability.",
};

const a = "text-link underline underline-offset-2 hover:no-underline";

// Each line restates something this page already says in its own sections; nothing new is claimed here.
const BOARD: [string, boolean][] = [
  [
    "Every route called as a stranger, an anonymous visitor and a read-only member, by an automated test",
    true,
  ],
  [
    "Row-level security on every table, with a test that fails if a table has no policy",
    true,
  ],
  ["Every stored quote checked word for word against its source", true],
  ["The send worker refuses any message that is not approved", true],
  ["Known-vulnerability and code-weakness scans on each release", true],
  ["Automated accessibility tests on the main flows", true],
  ["An independent human security review", false],
  ["A penetration test", false],
  ["A staging environment that mirrors production", false],
  ["Virus scanning of uploaded files", false],
];

export default function Security() {
  return (
    <Page
      tone="brand"
      eyebrow="Security"
      title="How your customers' words are protected"
      lead="Your customers' words are sensitive. Here is how they are protected, in plain terms, and what we have and have not yet verified."
    >
      <Updated />
      <ul
        aria-label="Three pillars"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        {[
          [
            "Security",
            "bg-tint-blue",
            [
              "Every workspace separated at the database level",
              "Roles checked on every route",
              "Secrets shown once, never in logs",
            ],
          ],
          [
            "Privacy",
            "bg-tint-teal",
            [
              "Never used to train models",
              "Card numbers and keys hidden before storage",
              "Delete a person and everything about them",
            ],
          ],
          [
            "Reliability",
            "bg-tint-amber",
            [
              "Slow work retried, never duplicated",
              "If the AI is down, sources are still saved",
              "Backups and a restore drill",
            ],
          ],
        ].map(([t, tint, pts]) => (
          <li
            key={t as string}
            className={`space-y-3 rounded-3xl p-6 ${tint as string}`}
          >
            <h2 className="font-display text-xl font-bold">{t as string}</h2>
            <ul className="space-y-2 text-sm">
              {(pts as string[]).map((x) => (
                <li key={x} className="flex gap-2">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-link"
                  />
                  {x}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <section
        aria-labelledby="board-h"
        className="space-y-4 rounded-3xl bg-card p-6 shadow-card sm:p-8"
      >
        <div className="space-y-1">
          <h2
            id="board-h"
            className="font-display text-2xl font-bold tracking-tight"
          >
            Status board
          </h2>
          <p className="text-muted-foreground">
            What has been checked, and what has not yet. We list what is missing
            as plainly as what is done.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {BOARD.map(([what, ok]) => (
            <li
              key={what}
              className="flex items-center justify-between gap-4 py-3"
            >
              <span>{what}</span>
              <span
                className={
                  ok
                    ? "shrink-0 rounded-full bg-tint-teal px-3 py-0.5 text-xs font-semibold"
                    : "shrink-0 rounded-full border border-dashed border-input px-3 py-0.5 text-xs font-semibold text-muted-foreground"
                }
              >
                {ok ? "Verified" : "Not yet"}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <Section title="Isolation">
        <Bullets
          items={[
            "Every workspace's data is separated at the database level. Each table carries the workspace and enforces row-level security, and every request runs inside a transaction that names the workspace. A table without a policy fails our tests.",
            "The service never uses an all-powerful database role, and application tables are not reachable from the browser.",
            "Roles (admin, member, viewer) come from our own records, never from what the browser says, and are enforced on every route. A generated test calls every route as a stranger, an anonymous visitor and a read-only member to prove it.",
          ]}
        />
      </Section>
      <Section title="Data in use">
        <Bullets
          items={[
            "Credentials kept for connected services are encrypted with a server key. Secrets such as API keys and signing secrets are shown once and never again, and never appear in logs, addresses or browser code.",
            "Card numbers, keys and passwords found in customer text are hidden before anything is stored and before any AI call.",
            "Customer text goes only to AI routes marked as allowed to receive it, is never used to train models, and every AI call records the provider, model, prompt version, tokens and cost.",
            "Customer text is treated as untrusted. Quotes that look like instructions to an AI are flagged and withheld from assistants, and model output can never trigger a send, a delete or a change.",
            "Uploaded files are checked by what they are, served only as downloads, and size-limited. They are not scanned for viruses yet.",
          ]}
        />
      </Section>
      <Section title="Sending">
        <p>
          Nothing is sent to your customers without an approved state, enforced
          inside the sending code itself. Messages use an authenticated sender
          domain, carry a signed unsubscribe link and honour opt-outs.
        </p>
      </Section>
      <Section title="Access and sessions">
        <Bullets
          items={[
            "Sign-in tokens are verified on every request (signature, expiry, audience, issuer). Sessions live in protected cookies the page's code cannot read.",
            "API keys are scoped, can expire, can be limited to addresses, are rate limited and keep an activity log. Assistants connect through an approval page, can be disconnected at any time, and cannot send, publish, merge or delete.",
            "Public endpoints are rate limited and, where they can be embedded, limited to the sites you allow.",
          ]}
        />
      </Section>
      <Section title="Retention and deletion">
        <p>
          Deleting a person removes their quotes, conversations, transcripts,
          recordings, survey answers and files. Working data expires on its own
          schedule (see the{" "}
          <Link className={a} href="/privacy">
            privacy policy
          </Link>
          ). An admin can export a whole workspace.
        </p>
      </Section>
      <Section title="Reliability">
        <Bullets
          items={[
            "Slow work runs as retried jobs with idempotency keys, so a crash does not lose or duplicate work.",
            "If the AI is unavailable, sources are still saved and queued. If email is unavailable, approved messages wait.",
            "Backups and a restore drill are part of the release checks.",
          ]}
        />
      </Section>
      <Section title="What we check, and what we have not yet">
        <Bullets
          items={[
            "Each release is checked for known vulnerabilities in our code and dependencies, scanned for common code weaknesses, and covered by automated authorisation and accessibility tests.",
            "Not yet done: an independent human security review, a staging environment that mirrors production, and a penetration test. We will list them here when they happen rather than imply they have.",
          ]}
        />
      </Section>
      <Section title="Report a vulnerability">
        <p>
          Please tell us before you tell anyone else.{" "}
          {SITE.securityEmail ? (
            <>
              Write to{" "}
              <a className={a} href={`mailto:${SITE.securityEmail}`}>
                {SITE.securityEmail}
              </a>
              .
            </>
          ) : (
            <span className="text-muted-foreground">
              The security address is published here before launch.
            </span>
          )}{" "}
          Include what you found, how to reproduce it and what you think the
          impact is. Do not access other people&apos;s data, run
          denial-of-service tests or publish details before we have fixed the
          problem. We will acknowledge your report, keep you informed, and
          credit you if you wish.
        </p>
      </Section>
    </Page>
  );
}
