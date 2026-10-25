import type { Metadata } from "next";
import {
  CallToAction,
  Page,
  Section,
  ScrollBox,
} from "@/components/site/blocks";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "A free plan to start and paid plans for teams that need recordings, surveys, integrations and more.",
};

type Row = { what: string; free: string; team: string; business: string };

// What each plan includes, as set in the service's plan settings. Prices are decided by the owner and published
// before launch; none is invented here.
const ROWS: Row[] = [
  {
    what: "Paste, review and requests",
    free: "Yes",
    team: "Yes",
    business: "Yes",
  },
  {
    what: "People, accounts and value",
    free: "Yes",
    team: "Yes",
    business: "Yes",
  },
  {
    what: "Questions and briefs with citations",
    free: "Yes",
    team: "Yes",
    business: "Yes",
  },
  {
    what: "Closing the loop (approved messages)",
    free: "Yes",
    team: "Yes",
    business: "Yes",
  },
  {
    what: "AI allowance per day",
    free: "Small",
    team: "Larger",
    business: "Largest",
  },
  {
    what: "Recordings and transcripts",
    free: "No",
    team: "Yes",
    business: "Yes",
  },
  { what: "Surveys", free: "No", team: "Yes", business: "Yes" },
  {
    what: "Public pages (release notes, roadmap)",
    free: "No",
    team: "Yes",
    business: "Yes",
  },
  { what: "Weekly digest", free: "No", team: "Yes", business: "Yes" },
  {
    what: "Integrations (trackers, CRMs, chat)",
    free: "No",
    team: "Yes",
    business: "Yes",
  },
  { what: "API keys", free: "None", team: "Up to 3", business: "Up to 10" },
];

export default function Pricing() {
  return (
    <Page
      title="Pricing"
      lead="Start free with your own conversations. Move up when you need recordings, surveys, public pages and integrations."
    >
      <p className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
        <strong>Prices are announced before launch.</strong> The table shows
        what each plan includes today. Nothing here is a quote.
      </p>
      <ScrollBox label="What each plan includes">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <caption className="sr-only">What each plan includes</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-3 pr-4 font-semibold">
                Included
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Free
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Team
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Business
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.what} className="border-b border-border">
                <th scope="row" className="py-3 pr-4 font-normal">
                  {r.what}
                </th>
                <td className="px-4 py-3">{r.free}</td>
                <td className="px-4 py-3">{r.team}</td>
                <td className="px-4 py-3">{r.business}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      <Section title="How limits work">
        <p>
          Limits are enforced by the service, not just shown on screen, and when
          you reach one the screen says what is missing and how to get it. The
          AI allowance is per workspace per day, so one busy import cannot run
          up an unexpected bill. Admins can see the plan, change it and manage
          payment details in Settings.
        </p>
      </Section>
      <CallToAction
        title="Try the free plan"
        text="No card needed to start. Paste a conversation and see what it finds."
      />
    </Page>
  );
}
