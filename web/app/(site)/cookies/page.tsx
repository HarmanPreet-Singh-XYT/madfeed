import type { Metadata } from "next";
import {
  DraftNotice,
  Page,
  Section,
  Updated,
  ScrollBox,
} from "@/components/site/blocks";

export const metadata: Metadata = {
  title: "Cookies",
  description:
    "The few cookies and browser storage items we use, and why. No advertising or analytics cookies.",
};

const ROWS = [
  [
    "session",
    "Keeps you signed in. Not readable by page scripts.",
    "Up to 8 hours",
    "Necessary",
  ],
  [
    "refresh",
    "Renews your session without asking you to sign in again. Not readable by page scripts.",
    "30 days",
    "Necessary",
  ],
  [
    "sso_pkce, sso_next",
    "Used for a few minutes only while you sign in with a company account, to make sure the person who finishes signing in is the one who started.",
    "10 minutes",
    "Necessary",
  ],
];

export default function Cookies() {
  return (
    <Page
      title="Cookies"
      lead="We use as few as we can. There are no advertising or analytics cookies on this site."
    >
      <DraftNotice />
      <Updated />
      <Section title="Cookies we set">
        <ScrollBox label="Cookies and what they are for">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <caption className="sr-only">Cookies and what they are for</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4">
                  Name
                </th>
                <th scope="col" className="px-4 py-2">
                  What it is for
                </th>
                <th scope="col" className="px-4 py-2">
                  How long
                </th>
                <th scope="col" className="px-4 py-2">
                  Kind
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([n, w, h, k]) => (
                <tr key={n} className="border-b border-border align-top">
                  <th
                    scope="row"
                    className="py-2 pr-4 font-mono text-xs font-normal"
                  >
                    {n}
                  </th>
                  <td className="px-4 py-2">{w}</td>
                  <td className="px-4 py-2">{h}</td>
                  <td className="px-4 py-2">{k}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
        <p>
          These are needed for the service to work, so they are set without a
          banner. Visiting the public pages of this site (home, features,
          documentation and so on) sets none of them.
        </p>
      </Section>
      <Section title="Browser storage on your customers' pages">
        <p>
          The chat window and surveys you place on your own site keep a random
          identifier in the visitor&apos;s browser storage, so a visitor&apos;s
          conversation continues and a survey can be answered once. It is not
          used to track visitors across sites. If your visitors need to be told
          about this, your own cookie notice should mention it.
        </p>
      </Section>
      <Section title="Changes">
        <p>
          If we add any other cookie, we will list it here first and ask where
          the law requires.
        </p>
      </Section>
    </Page>
  );
}
