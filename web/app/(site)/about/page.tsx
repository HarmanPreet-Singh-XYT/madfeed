import type { Metadata } from "next";
import { Bullets, CallToAction, Page, Section } from "@/components/site/blocks";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why this exists, what we believe about customer feedback, and how we build.",
};

export default function About() {
  return (
    <Page
      tone="brand"
      eyebrow="About"
      title="Why this exists"
      lead={`${SITE.name} is a small, independent product for teams who want to decide from what customers actually said, and then tell them what happened.`}
    >
      <Section title="Why it exists">
        <p>
          Product teams hear their customers constantly: in sales calls, support
          threads, chats, interviews and surveys. Almost none of it is read
          together. Decisions end up resting on memory and on whoever spoke
          loudest, and the customers who asked rarely hear back.
        </p>
        <p>
          We built the thing we wanted: a place where every conversation is
          read, every claim points to the words behind it, requests are weighed
          by who asked and what they are worth, and closing the loop with a
          personal reply is the normal last step, not an afterthought.
        </p>
      </Section>
      <Section title="What we believe">
        <Bullets
          items={[
            <>
              <strong>Show your work.</strong> A summary you cannot check is a
              guess. Every number, label, answer and message traces to the quote
              that justifies it, and the platform reports how often its own
              suggestions are right.
            </>,
            <>
              <strong>People decide, machines suggest.</strong> The AI proposes;
              a person accepts. Nothing is sent to a customer without approval.
            </>,
            <>
              <strong>Useful before configured.</strong> You should see value
              from the first pasted conversation, not after a setup project.
            </>,
            <>
              <strong>Customer data is not ours.</strong> It is never used to
              train models, it is isolated per workspace, and you can export or
              delete it.
            </>,
            <>
              <strong>Small and honest.</strong> We say plainly what is built,
              what is coming and what is not planned. Our integrations page and
              FAQ do the same.
            </>,
          ]}
        />
      </Section>
      <Section title="How we build">
        <Bullets
          items={[
            "Independent and self-funded, with no investors to please but the people who use it.",
            "Closed source and cloud only, so security fixes reach everyone at once.",
            "Tests come first: authorisation is checked for every route, as a stranger, an anonymous visitor and a read-only member. Accessibility is checked on the main flows.",
            "Dependencies stay current and are scanned for known vulnerabilities as part of every release check.",
            "Anything outward-facing or hard to undo is a decision a person makes, not something that happens automatically.",
          ]}
        />
      </Section>
      <Section title="Who is behind it">
        <p>
          {SITE.legalName ? (
            <>
              {SITE.name} is operated by {SITE.legalName}
              {SITE.address ? `, ${SITE.address}` : ""}.
            </>
          ) : (
            <>
              The company details are published here before launch, alongside
              the legal pages.
            </>
          )}{" "}
          You can reach us on the contact page.
        </p>
      </Section>
      <CallToAction />
    </Page>
  );
}
