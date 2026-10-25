import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, Page, Section, Updated } from "@/components/site/blocks";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How customer data is isolated, protected, retained and deleted, and how to report a vulnerability.",
};

const a = "text-link underline underline-offset-2 hover:no-underline";

export default function Security() {
  return (
    <Page
      title="Security"
      lead="Your customers' words are sensitive. Here is how they are protected, in plain terms, and what we have and have not yet verified."
    >
      <Updated />
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
