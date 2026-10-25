import type { Metadata } from "next";
import {
  DraftNotice,
  Page,
  Section,
  Updated,
  ScrollBox,
} from "@/components/site/blocks";

export const metadata: Metadata = {
  title: "Subprocessors",
  description:
    "The companies that handle data for us, what for, and what data.",
};

type Row = { name: string; purpose: string; data: string; status: string };

const ROWS: Row[] = [
  {
    name: "Supabase",
    purpose: "Sign-in and the database that stores workspaces",
    data: "Account email and sign-in records; all workspace content",
    status: "In use [region to confirm]",
  },
  {
    name: "[Application hosting provider]",
    purpose: "Runs the web app and the API",
    data: "Requests in transit; no stored content beyond the database",
    status: "To confirm before launch",
  },
  {
    name: "[Object storage provider]",
    purpose: "Stores uploaded recordings",
    data: "Recordings you upload",
    status: "To confirm before launch",
  },
  {
    name: "AI model providers (selected from Anthropic, OpenAI, Google and DeepSeek)",
    purpose:
      "Read conversations, answer questions, draft messages, label feelings",
    data: "Customer text and what is needed to answer; not used to train models",
    status: "The providers in use at launch are listed here when confirmed",
  },
  {
    name: "OpenAI (embeddings)",
    purpose: "Compare statements and quotes by meaning",
    data: "Short pieces of customer text",
    status: "Only if meaning search is switched on",
  },
  {
    name: "AssemblyAI",
    purpose: "Turn recordings into transcripts",
    data: "Recordings; deleted at the provider after transcription",
    status: "Only if that provider is selected",
  },
  {
    name: "Resend",
    purpose:
      "Send the email you approve, invitations and account email; receive bounce reports",
    data: "Recipient addresses and message text",
    status: "In use at launch",
  },
  {
    name: "Stripe",
    purpose: "Take payment for paid plans",
    data: "Billing contact and payment details (held by Stripe)",
    status: "In use at launch",
  },
  {
    name: "[Error and alert channel]",
    purpose: "Tell us when something breaks",
    data: "Identifiers and error text; no customer content",
    status: "To confirm before launch",
  },
];

export default function Subprocessors() {
  return (
    <Page
      title="Subprocessors"
      lead="Companies that handle personal data on our behalf, and what for. We update this page before adding one."
    >
      <DraftNotice />
      <Updated />
      <ScrollBox label="Subprocessors">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <caption className="sr-only">Subprocessors</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-4">
                Company
              </th>
              <th scope="col" className="px-4 py-2">
                Purpose
              </th>
              <th scope="col" className="px-4 py-2">
                Data
              </th>
              <th scope="col" className="px-4 py-2">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name} className="border-b border-border align-top">
                <th scope="row" className="py-2 pr-4 font-medium">
                  {r.name}
                </th>
                <td className="px-4 py-2">{r.purpose}</td>
                <td className="px-4 py-2">{r.data}</td>
                <td className="px-4 py-2">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      <Section title="Services you connect yourself">
        <p>
          When a workspace admin connects Slack, an issue tracker (GitHub,
          Linear, Jira, ClickUp, Asana, Azure DevOps), a CRM (HubSpot,
          Salesforce) or a chat channel for notifications, that service receives
          only what the connection is for (for example an issue title and
          counts, never customer quotes, names or emails), under that
          customer&apos;s own account with it. These are the customer&apos;s
          choices, not our subprocessors.
        </p>
      </Section>
      <Section title="Changes">
        <p>
          Account holders are told before a new subprocessor starts handling
          their data, and can object within that notice period.
        </p>
      </Section>
    </Page>
  );
}
