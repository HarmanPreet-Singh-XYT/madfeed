import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, CallToAction, Page, Section } from "@/components/site/blocks";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Community",
  description:
    "How to ask questions, request integrations, report problems and shape what gets built.",
};

const a = "text-link underline underline-offset-2 hover:no-underline";

export default function Community() {
  const mail = SITE.contactEmail;
  return (
    <Page
      title="Community"
      lead="This is a product shaped by the people who use it. Here is how to be heard."
    >
      <Section title="Ask a question">
        <p>
          Start with the{" "}
          <Link className={a} href="/docs">
            documentation
          </Link>{" "}
          and the{" "}
          <Link className={a} href="/faq">
            FAQ
          </Link>
          . If your answer is not there, write to us from the{" "}
          <Link className={a} href="/contact">
            contact page
          </Link>
          {mail ? (
            <>
              {" "}
              or at{" "}
              <a className={a} href={`mailto:${mail}`}>
                {mail}
              </a>
            </>
          ) : null}
          . A person reads every message.
        </p>
      </Section>
      <Section title="Ask for an integration or a feature">
        <p>
          The planned list on the{" "}
          <Link className={a} href="/integrations">
            integrations page
          </Link>{" "}
          is ordered by what people ask for, so asking genuinely moves things.
          When you ask, it helps to tell us:
        </p>
        <Bullets
          items={[
            "the tool, and what you do with it today;",
            "what you would want to happen (capture feedback from it, send work to it, read a value from it);",
            "how often it matters to you.",
          ]}
        />
      </Section>
      <Section title="Report a problem">
        <p>
          Tell us what you did, what you expected and what happened, and the
          time it happened. Please do not send customer data or passwords in a
          report. For a security problem, use the{" "}
          <Link className={a} href="/security">
            security page
          </Link>{" "}
          instead.
        </p>
      </Section>
      <Section title="See what is changing">
        <p>
          Every workspace can publish its own release notes and roadmap with
          this product, and we do the same for ours once it launches. Until then
          the integrations page is the most current view of what is built,
          coming and planned.
        </p>
      </Section>
      <Section title="Meet other users">
        <p>
          A public forum or chat space for users has not been opened yet. When
          it is, the address will be here, with a short code of conduct: be
          kind, keep customer data out of it, and no selling.
        </p>
      </Section>
      <CallToAction />
    </Page>
  );
}
