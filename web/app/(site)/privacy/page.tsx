import type { Metadata } from "next";
import Link from "next/link";
import {
  Bullets,
  DraftNotice,
  Fact,
  Page,
  Section,
  Updated,
} from "@/components/site/blocks";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What personal data we handle, why, who else handles it, how long we keep it, and your rights.",
};

const a = "text-accent underline underline-offset-2 hover:no-underline";

export default function Privacy() {
  return (
    <Page
      title="Privacy policy"
      lead="What we collect, why, who else handles it, how long we keep it, and what you can do about it."
    >
      <DraftNotice />
      <Updated />

      <Section title="1. Who we are">
        <p>
          {SITE.name} is operated by{" "}
          <Fact value={SITE.legalName} fallback="company legal name" />
          {SITE.address ? `, ${SITE.address}` : <> [company address]</>}.
          Questions about this policy:{" "}
          <Fact value={SITE.privacyEmail} fallback="privacy email address" />.
        </p>
        <p>
          There are two kinds of personal data here, and our role differs. For
          the data of the people who use {SITE.name} (account holders and their
          teammates) we decide why and how it is used. For the customer
          conversations, names, email addresses and other content our users put
          into their workspace, the user&apos;s company decides why and how it
          is used and we handle it on their behalf. A data processing agreement
          is available on request.
        </p>
      </Section>

      <Section title="2. What we collect">
        <Bullets
          items={[
            <>
              <strong>Account data:</strong> your email address, the display
              name you choose, your role in each workspace, and sign-in records
              handled by our identity provider (see the subprocessors page).
            </>,
            <>
              <strong>Workspace content</strong> that you or your teammates add
              or connect: conversations, call recordings and transcripts, survey
              answers, chat and email messages and files, the names, email
              addresses and company details of your customers, and what the
              service derives from them (requests, quotes, tags, feeling labels,
              drafts, briefs and answers).
            </>,
            <>
              <strong>Visitors to your public surfaces</strong> (feedback form,
              chat window, survey, roadmap): what they type or upload, an
              address-based rate-limit counter, and a random browser identifier.
              Chat visitors are identified by a hash of that identifier. We do
              not build profiles of visitors.
            </>,
            <>
              <strong>Payments:</strong> handled by our payment provider. We
              keep the plan, status and identifiers, not card numbers.
            </>,
            <>
              <strong>Technical records:</strong> request identifiers,
              timestamps, error reports and per-call AI cost and latency
              records. Logs hold identifiers, not message content, email
              addresses or tokens.
            </>,
          ]}
        />
        <p>
          Card numbers, keys and passwords that appear in customer text are
          hidden before anything is stored.
        </p>
      </Section>

      <Section title="3. Why we use it">
        <Bullets
          items={[
            "To provide the service you asked for: store and read conversations, propose and track requests, weigh them, send the messages you approve, run surveys and the support desk.",
            "To keep the service secure, prevent abuse, and fix problems.",
            "To bill for paid plans and communicate about your account.",
            "To measure and improve the quality of our own suggestions using aggregate counts and samples you grade; never by training a model on your customers' content.",
          ]}
        />
        <p>
          Where the law requires a basis, we rely on performing our contract
          with you, our legitimate interest in running a secure service, and
          your consent where we ask for it.
        </p>
      </Section>

      <Section title="4. AI processing">
        <p>
          To read conversations, answer questions and draft messages, text is
          sent to AI model providers listed on the{" "}
          <Link className={a} href="/subprocessors">
            subprocessors page
          </Link>
          . Customer text goes only to routes marked as allowed to receive it,
          under terms that do not allow the provider to train on it where the
          provider offers such terms. Every call records the provider, model,
          prompt version, tokens and cost. AI output is a suggestion: nothing
          becomes a request and nothing is sent to a customer without a person
          approving it.
        </p>
      </Section>

      <Section title="5. Who else handles it">
        <p>
          Only the subprocessors listed on the{" "}
          <Link className={a} href="/subprocessors">
            subprocessors page
          </Link>
          , and services your workspace connects (for example Slack or an issue
          tracker), which receive what you choose to send them. We do not sell
          personal data and do not use it for advertising.
        </p>
      </Section>

      <Section title="6. How long we keep it">
        <Bullets
          items={[
            "Workspace content: until you delete it or the workspace is deleted. Deleting a person removes their quotes, conversations, transcripts, recordings, survey answers and files.",
            "Questions asked and the answers given: 180 days.",
            "Per-call AI cost and latency records: 400 days.",
            "Notices shown to admins: 30 days.",
            "Suggestions a person dismissed: 90 days.",
            "Records of messages sent and unsubscribes: kept so an opt-out keeps being honoured.",
            "Backups: removed as they age out on a fixed schedule [backup retention period].",
          ]}
        />
      </Section>

      <Section title="7. Where it is stored">
        <p>
          Data is stored with the providers on the subprocessors page in{" "}
          <Fact value="" fallback="regions, to be confirmed before launch" />. A
          choice of region is not offered yet; we will say so plainly rather
          than imply one. Where data moves outside your country, we rely on the
          transfer mechanisms the law provides [mechanism].
        </p>
      </Section>

      <Section title="8. Your rights">
        <p>
          Depending on where you live, you may have the right to see, correct,
          export or delete your personal data, to object to or restrict some
          uses, and to complain to your data protection authority. Account
          holders can export a workspace and delete data in the product. If you
          are a customer of one of our users, please contact that company first;
          we will help them respond. To make a request to us, write to{" "}
          <Fact value={SITE.privacyEmail} fallback="privacy email address" />.
        </p>
      </Section>

      <Section title="9. Security">
        <p>
          See the{" "}
          <Link className={a} href="/security">
            security page
          </Link>
          . No service can promise perfect security; we tell affected customers
          promptly if something goes wrong that affects them.
        </p>
      </Section>

      <Section title="10. Cookies">
        <p>
          We use only the cookies needed to sign you in. See the{" "}
          <Link className={a} href="/cookies">
            cookies page
          </Link>
          .
        </p>
      </Section>

      <Section title="11. Children">
        <p>The service is for businesses and is not directed at children.</p>
      </Section>

      <Section title="12. Changes">
        <p>
          If we change this policy in a way that matters, we will tell account
          holders before it takes effect and update the date above.
        </p>
      </Section>
    </Page>
  );
}
