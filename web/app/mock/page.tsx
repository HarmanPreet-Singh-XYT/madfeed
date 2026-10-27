import Link from "next/link";
import { uid } from "@/mock/ids";

export const metadata = { title: "Preview index" };

const ws = `/w/${uid(1)}`;
const req = (n: number) => `${ws}/requests/${uid(200 + n)}`;

// Every screen of the app, grouped the way a person moves through it. Links open the real pages, filled with
// sample data (see mock/README.md).
const groups: {
  title: string;
  note: string;
  screens: { label: string; href: string }[];
}[] = [
  {
    title: "Getting feedback in",
    note: "Paste a conversation, review what the model found, accept it into requests.",
    screens: [
      { label: "Home (your workspaces)", href: "/home" },
      { label: "Add feedback", href: `${ws}/add` },
      { label: "Review queue", href: `${ws}/review` },
      {
        label: "Conversation with highlighted quotes",
        href: `${ws}/sources/${uid(41)}`,
      },
    ],
  },
  {
    title: "Deciding",
    note: "Requests with who is behind them, the cited brief, and the status that starts the loop.",
    screens: [
      { label: "Requests", href: `${ws}/requests` },
      { label: "A request with evidence and a brief", href: req(1) },
      { label: "A shipped request", href: req(2) },
      { label: "Public roadmap choices", href: `${ws}/roadmap` },
    ],
  },
  {
    title: "Closing the loop",
    note: "Personal messages for review, release notes, and the pages customers see.",
    screens: [
      { label: "Messages", href: `${ws}/outreach` },
      {
        label: "A batch to review and approve",
        href: `${ws}/outreach/${uid(300)}`,
      },
      { label: "Release notes", href: `${ws}/releases` },
      { label: "Edit a release note", href: `${ws}/releases/${uid(501)}` },
      { label: "Public roadmap", href: "/r/northwind/roadmap" },
      { label: "Public release notes", href: "/r/northwind" },
    ],
  },
  {
    title: "Pages anyone can open",
    note: "What customers and visitors see: no sign-in needed.",
    screens: [
      {
        label: "Website chat window",
        href: "/chat/sample-widget-not-real?o=https%3A%2F%2Fwww.northwind.example",
      },
      { label: "Answer a survey (personal link)", href: `/s/${uid(920)}` },
      {
        label: "Answer a survey (shown inside another page)",
        href: `/embed/s/${uid(910)}`,
      },
      { label: "Unsubscribe from messages", href: "/unsubscribe/sample" },
      {
        label: "Unsubscribe from the digest",
        href: "/digest/unsubscribe/sample",
      },
      { label: "Join a workspace (invitation)", href: `/invite/${uid(1300)}` },
      {
        label: "Connect an AI assistant (approval page)",
        href: "/oauth/authorize?client_id=sample&redirect_uri=https%3A%2F%2Fassistant.example%2Fcallback&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=demo",
      },
    ],
  },
  {
    title: "Signing in",
    note: "Any email and password works. Password “wrong” shows the error; an email starting “confirm” shows the check-your-email step on sign-up.",
    screens: [
      { label: "Sign in", href: "/login" },
      { label: "Create an account", href: "/signup" },
      { label: "Forgot your password", href: "/forgot" },
      {
        label: "Choose a new password",
        href: "/reset?token_hash=sample-reset-code",
      },
    ],
  },
  {
    title: "Everything else",
    note: "These screens are being filled in; one that says it needs sample data is next on the list.",
    screens: [
      { label: "People", href: `${ws}/people` },
      { label: "Quotes", href: `${ws}/quotes` },
      { label: "Ask", href: `${ws}/ask` },
      { label: "Recordings", href: `${ws}/recordings` },
      { label: "Findings", href: `${ws}/findings` },
      { label: "Surveys", href: `${ws}/surveys` },
      { label: "Inbox", href: `${ws}/inbox` },
      { label: "Quality", href: `${ws}/quality` },
      { label: "Settings", href: `${ws}/settings` },
    ],
  },
];

const behaviours = [
  { set: "normal", label: "Normal" },
  { set: "empty", label: "Empty workspace" },
  { set: "slow", label: "Slow responses" },
  { set: "error", label: "Everything failing" },
];

export default function PreviewIndex() {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-4 py-12"
    >
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Preview</h1>
        <p className="text-muted-foreground">
          The real screens, filled with sample data and no sign-in. Changes you
          make here (accepting a quote, shipping a request) are kept until the
          server restarts.
        </p>
      </header>

      <section aria-labelledby="how" className="space-y-3">
        <h2 id="how" className="text-lg font-medium">
          How the data behaves
        </h2>
        <ul className="flex flex-wrap gap-2">
          {behaviours.map((b) => (
            <li key={b.set}>
              <Link
                href={`/mock/scenario?set=${b.set}&to=/mock`}
                className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm hover:bg-muted"
              >
                {b.label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/mock/scenario?reset=1&to=/mock"
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm hover:bg-muted"
            >
              Reset sample data
            </Link>
          </li>
          <li>
            <Link
              href="/mock/scenario?session=out&to=/mock"
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm hover:bg-muted"
            >
              Signed out
            </Link>
          </li>
          <li>
            <Link
              href="/mock/scenario?session=in&to=/mock"
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm hover:bg-muted"
            >
              Signed in
            </Link>
          </li>
        </ul>
      </section>

      {groups.map((g) => (
        <section key={g.title} aria-labelledby={g.title} className="space-y-3">
          <h2 id={g.title} className="text-lg font-medium">
            {g.title}
          </h2>
          <p className="text-sm text-muted-foreground">{g.note}</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {g.screens.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="flex min-h-11 items-center justify-between px-4 py-2 hover:bg-muted"
                >
                  <span>{s.label}</span>
                  <span aria-hidden className="text-muted-foreground">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
