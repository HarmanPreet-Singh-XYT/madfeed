import type { Metadata } from "next";
import Link from "next/link";
import { Page, Section } from "@/components/site/blocks";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "How to reach us for questions, help, security reports and privacy requests.",
};

const a = "text-accent underline underline-offset-2 hover:no-underline";

function Mail({ address, fallback }: { address: string; fallback: string }) {
  return address ? (
    <a className={a} href={`mailto:${address}`}>
      {address}
    </a>
  ) : (
    <span className="text-muted">{fallback}</span>
  );
}

export default function Contact() {
  return (
    <Page
      title="Contact"
      lead="We read everything and answer in plain language."
    >
      <Section title="Questions, help and feedback">
        <p>
          <Mail
            address={SITE.contactEmail}
            fallback="The contact address is published here before launch."
          />
        </p>
        <p className="text-muted">
          Already a customer? Signed-in teams can also reach us from inside the
          product. Please do not email customer data or passwords.
        </p>
      </Section>
      <Section title="Security reports">
        <p>
          <Mail
            address={SITE.securityEmail}
            fallback="The security address is published here before launch."
          />{" "}
          See the{" "}
          <Link className={a} href="/security">
            security page
          </Link>{" "}
          for what to include and what to expect.
        </p>
      </Section>
      <Section title="Privacy requests">
        <p>
          To see, correct, export or delete personal data we hold, write to{" "}
          <Mail
            address={SITE.privacyEmail}
            fallback="the privacy address (published here before launch)"
          />
          . The{" "}
          <Link className={a} href="/privacy">
            privacy policy
          </Link>{" "}
          explains what we hold and for how long.
        </p>
      </Section>
      <Section title="Company">
        <p>
          {SITE.legalName ? (
            <>
              {SITE.legalName}
              {SITE.address ? <>, {SITE.address}</> : null}
            </>
          ) : (
            <span className="text-muted">
              The company name and address are published here before launch.
            </span>
          )}
        </p>
      </Section>
    </Page>
  );
}
