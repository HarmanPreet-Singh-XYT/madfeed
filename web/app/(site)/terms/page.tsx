import type { Metadata } from "next";
import Link from "next/link";
import {
  DraftNotice,
  Fact,
  Page,
  Section,
  Updated,
} from "@/components/site/blocks";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description:
    "The agreement for using the service: accounts, your data, acceptable use, AI features, fees, termination and liability.",
};

const a = "text-accent underline underline-offset-2 hover:no-underline";

export default function Terms() {
  return (
    <Page
      title="Terms and conditions"
      lead="The agreement between you and us for using the service, in plain language."
    >
      <DraftNotice />
      <Updated />

      <Section title="1. Who these terms are between">
        <p>
          These terms are between the business or person that creates an account
          (&quot;you&quot;) and{" "}
          <Fact value={SITE.legalName} fallback="company legal name" />{" "}
          (&quot;we&quot;), which operates {SITE.name} (the
          &quot;service&quot;). By creating an account or using the service you
          agree to them. If you sign up for a company, you confirm you may bind
          it.
        </p>
      </Section>

      <Section title="2. The service">
        <p>
          The service helps you collect customer conversations, find and weigh
          the requests in them, and tell the people who asked what happened. It
          changes over time; we may add, change or retire features, and will
          give reasonable notice of a change that removes something you rely on.
        </p>
      </Section>

      <Section title="3. Accounts and workspaces">
        <p>
          Give accurate information, keep your sign-in details secret, and tell
          us promptly if you think someone else has used your account. You are
          responsible for what happens in your workspaces, including what your
          teammates do, and for the roles you give them.
        </p>
      </Section>

      <Section title="4. Your data">
        <p>
          You own your content: the conversations, recordings, files, people and
          account details you add or connect, and what you create from them. You
          give us permission to store and process it to provide the service,
          including sending it to the AI and other providers listed on the{" "}
          <Link className={a} href="/subprocessors">
            subprocessors page
          </Link>
          . We do not use your content to train AI models and do not sell it.
        </p>
        <p>
          You promise that you have the right to put the content into the
          service and to have it processed this way, and that you have told the
          people it is about what the law requires. Our{" "}
          <Link className={a} href="/privacy">
            privacy policy
          </Link>{" "}
          explains what we hold, for how long, and how to export or delete it. A
          data processing agreement is available on request.
        </p>
      </Section>

      <Section title="5. Messages to your customers">
        <p>
          The service drafts messages; you review and approve each one, and
          nothing is sent without that approval. You are the sender. You are
          responsible for having the right to contact each person, for the
          content you approve, and for obeying the laws on email and marketing.
          Every message carries an unsubscribe link, and you must honour
          opt-outs, which the service helps by suppressing them.
        </p>
      </Section>

      <Section title="6. AI features">
        <p>
          AI output (suggested requests, matches, feelings, answers, briefs and
          drafts) can be wrong or incomplete. It is designed to show the quotes
          behind it so you can check it, and you are responsible for reviewing
          it before relying on it or sending it. Do not use the service to make
          decisions that significantly affect a person (such as employment or
          credit) without human review.
        </p>
      </Section>

      <Section title="7. Acceptable use">
        <p>You will not:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            break the law or others&apos; rights, or upload content you have no
            right to use;
          </li>
          <li>send spam, or send messages to people who have opted out;</li>
          <li>
            try to access other workspaces&apos; data, probe or attack the
            service, or bypass limits and permissions;
          </li>
          <li>
            upload malicious files, or use the service to build a competing
            product by scraping or copying it;
          </li>
          <li>
            put in sensitive data the service is not meant for, such as full
            card numbers, health records or government identity numbers.
          </li>
        </ul>
        <p>
          We may suspend access to stop harm, and will tell you why where we
          can.
        </p>
      </Section>

      <Section title="8. Connected services">
        <p>
          When you connect another service (for example Slack, an issue tracker
          or a CRM) you authorise us to exchange the data the connection is for.
          That service has its own terms, which you are responsible for, and you
          can disconnect at any time.
        </p>
      </Section>

      <Section title="9. Plans, fees and payment">
        <p>
          There is a free plan and paid plans. Prices, billing periods, taxes
          and refund rules are [to be published before launch] and shown before
          you pay. Limits (for example the daily AI allowance and the number of
          API keys) are part of each plan and are enforced by the service. You
          can change or cancel a paid plan in Settings; a cancellation takes
          effect at the end of the paid period unless the law says otherwise.
        </p>
      </Section>

      <Section title="10. Our rights">
        <p>
          We own the service, its software and its design. You may use it as
          these terms allow. If you send us feedback about the service, we may
          use it freely.
        </p>
      </Section>

      <Section title="11. Confidentiality">
        <p>
          Each of us will protect the other&apos;s non-public information with
          at least reasonable care and use it only for the service.
        </p>
      </Section>

      <Section title="12. Availability and support">
        <p>
          We work to keep the service available and to degrade gracefully when a
          provider is down (sources are still saved and approved messages wait),
          but we do not promise it will never be interrupted [service-level
          commitment, if any].
        </p>
      </Section>

      <Section title="13. Ending the agreement">
        <p>
          You can stop using the service and delete your workspace at any time;
          you can export your data first. We may end or suspend your access if
          you break these terms or the law, or if we stop providing the service,
          giving notice where we can. On ending, we delete your content as
          described in the privacy policy, except where the law requires us to
          keep something.
        </p>
      </Section>

      <Section title="14. Warranties and liability">
        <p>
          The service is provided &quot;as is&quot;. To the extent the law
          allows, we disclaim all warranties not stated here, and we are not
          liable for indirect or consequential loss, lost profits or lost data.
          Our total liability for a claim is limited to [liability cap, for
          example the fees you paid in the twelve months before the claim].
          Nothing here limits liability that cannot be limited by law.
        </p>
      </Section>

      <Section title="15. Changes to these terms">
        <p>
          If we change these terms in a way that matters, we will tell account
          holders before the change takes effect. Using the service afterwards
          means you accept it.
        </p>
      </Section>

      <Section title="16. Law and disputes">
        <p>
          These terms are governed by the law of{" "}
          <Fact value={SITE.governingLaw} fallback="governing law and courts" />
          . Please contact us first so we can try to settle a dispute
          informally.
        </p>
      </Section>

      <Section title="17. Contact">
        <p>
          <Link className={a} href="/contact">
            Contact page
          </Link>
          {SITE.contactEmail ? <> or {SITE.contactEmail}</> : null}.
        </p>
      </Section>
    </Page>
  );
}
