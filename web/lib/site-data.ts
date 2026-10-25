// What the public pages say about integrations, in one place so the integrations page, the docs and the front
// page cannot disagree. "available" is on for everyone; "soon" is built and tested but switched on only after it has
// been tried against the real service; "planned" is not built yet.
export type Availability = "available" | "soon" | "planned";

export type IntegrationEntry = {
  name: string;
  what: string;
  status: Availability;
};

export type IntegrationGroup = {
  title: string;
  intro: string;
  items: IntegrationEntry[];
};

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    title: "Bring feedback in",
    intro:
      "Everything lands in the same review queue, as an untouched source, with sensitive numbers hidden first.",
    items: [
      {
        name: "Website feedback form",
        what: "An embeddable form for your site, limited to the addresses you allow.",
        status: "available",
      },
      {
        name: "Website chat",
        what: "A chat window for your site, with files in both directions.",
        status: "available",
      },
      {
        name: "Email",
        what: "Forward or route customer email in from any mail provider.",
        status: "available",
      },
      {
        name: "Slack",
        what: "Messages in one channel you choose become feedback.",
        status: "available",
      },
      {
        name: "Recordings and transcripts",
        what: "Upload a call or interview and get a transcript with speakers and timing.",
        status: "available",
      },
      {
        name: "Any tool that can send a web request",
        what: "Help desks, form tools and automation services post notes in with a source label, a link back and their own id, so a retry is stored once.",
        status: "available",
      },
      {
        name: "Call transcripts from other tools",
        what: "Send WebVTT, SRT, JSON speaker turns or plain text from your call-recording tool.",
        status: "available",
      },
      {
        name: "Surveys",
        what: "Send NPS, CSAT, choice and free-text surveys; free text goes to the review queue.",
        status: "available",
      },
    ],
  },
  {
    title: "Send work to your tracker",
    intro:
      "Open an issue for a request and let the request follow it. Issues carry the title and counts, never customer quotes, names or emails. One tracker per workspace.",
    items: [
      {
        name: "GitHub issues",
        what: "Open an issue; the request follows it closing or reopening.",
        status: "available",
      },
      { name: "Linear", what: "The same, for a Linear team.", status: "soon" },
      {
        name: "Jira Cloud",
        what: "The same, for a Jira Cloud project.",
        status: "soon",
      },
      {
        name: "ClickUp",
        what: "The same, for a ClickUp list.",
        status: "soon",
      },
      {
        name: "Asana",
        what: "The same, for an Asana project.",
        status: "soon",
      },
      {
        name: "Azure DevOps",
        what: "The same, for an Azure DevOps project.",
        status: "soon",
      },
    ],
  },
  {
    title: "Weigh requests by what customers are worth",
    intro:
      "Read-only. People you already know are looked up by email; nobody is created or removed, and nothing is written to your CRM.",
    items: [
      {
        name: "CSV import",
        what: "A strict, previewed import of people and accounts.",
        status: "available",
      },
      {
        name: "HubSpot",
        what: "Account value from annual revenue or closed-won deals.",
        status: "soon",
      },
      {
        name: "Salesforce",
        what: "Account value from annual revenue or won opportunities.",
        status: "soon",
      },
    ],
  },
  {
    title: "Tell your team and your tools",
    intro:
      "Signed messages when things happen, or plain sentences in a chat channel.",
    items: [
      {
        name: "Webhooks",
        what: "Signed messages to any address: request created, status changed, suggestions ready, release note published, survey finished.",
        status: "available",
      },
      {
        name: "Slack, Discord and Microsoft Teams channels",
        what: "The same events as one plain sentence with a link, with customer text made safe first.",
        status: "available",
      },
      {
        name: "Zapier, Make and similar",
        what: "Use the inbound web request and the webhooks; a ready-made app listing is planned.",
        status: "available",
      },
      {
        name: "Weekly team digest",
        what: "An optional emailed summary, off until you turn it on.",
        status: "available",
      },
    ],
  },
  {
    title: "Use it from your AI assistant and your own code",
    intro:
      "Keys and approvals you control, with exactly the permissions you choose.",
    items: [
      {
        name: "Public API",
        what: "Scoped, expiring, address-limited keys; read requests, ask cited questions, add notes.",
        status: "available",
      },
      {
        name: "MCP for AI assistants",
        what: "Ten tools for Claude, ChatGPT, Cursor and other assistants, connected through an approval page you control.",
        status: "available",
      },
    ],
  },
  {
    title: "Sign in",
    intro: "",
    items: [
      {
        name: "Email and password",
        what: "With email confirmation and automatic session renewal.",
        status: "available",
      },
      {
        name: "Company sign-in (SAML and OIDC providers) and provider buttons",
        what: "Sign in with a work email through your company's own identity system, or with Google or Microsoft.",
        status: "soon",
      },
    ],
  },
  {
    title: "On the list, not built yet",
    intro:
      "Most of these already work through the inbound web request. A native connector would add things like linking a ticket back to a request. Tell us which one you need and it moves up.",
    items: [
      {
        name: "Intercom, Zendesk, Help Scout, Freshdesk, Gist",
        what: "Native capture from closed conversations, and ticket links back to requests.",
        status: "planned",
      },
      {
        name: "Gong, Fathom, Fireflies, Grain, tl;dv, Zoom, Google Meet",
        what: "Automatic capture of call transcripts without sending them.",
        status: "planned",
      },
      {
        name: "Typeform, Google Forms, SurveyMonkey",
        what: "Native capture of free-text answers.",
        status: "planned",
      },
      {
        name: "Review sites and app stores",
        what: "Capture of new reviews (G2, Capterra, Trustpilot, the app stores, Product Hunt).",
        status: "planned",
      },
      {
        name: "Microsoft Teams and Discord as a place to collect feedback",
        what: "Notifications to them already work; collecting from them does not yet.",
        status: "planned",
      },
      {
        name: "Okta, Entra ID, OneLogin, Google Workspace group sync",
        what: "Group import and automatic joining by company domain.",
        status: "planned",
      },
      {
        name: "Segment, Google Analytics, a browser extension",
        what: "Customer data in, and capture from any web page.",
        status: "planned",
      },
      {
        name: "WordPress and Shopify",
        what: "Ready-made plugins for the form and chat.",
        status: "planned",
      },
      {
        name: "Marketplace listings",
        what: "The Zapier and Make apps, the Slack directory, and the AI assistants' connector directories.",
        status: "planned",
      },
    ],
  },
];

export const STATUS_LABEL: Record<Availability, string> = {
  available: "Available",
  soon: "Coming soon",
  planned: "Planned",
};

export type Faq = { q: string; a: string };

export const FAQS: Faq[] = [
  {
    q: "What does it actually do?",
    a: "It reads customer conversations from wherever they happen (support chats and email, calls, surveys, forms, team chat), proposes the requests hidden in them with the exact sentence that supports each, lets you accept or reject every suggestion, weighs requests by who asked and what their account is worth, and helps you tell the people who asked when it ships.",
  },
  {
    q: "Can I trust what the AI says?",
    a: "It is built so you do not have to take its word. Every quote is checked to appear word for word in the original at the stored position; a made-up quote cannot be saved. Answers cite quotes or say there is no evidence. Suggestions never become requests until a person accepts them, and the platform measures how often its own suggestions were right.",
  },
  {
    q: "Will it send messages to my customers by itself?",
    a: "No. When a request ships, it prepares a personal draft for each person who asked, in their own words. You review and approve; only approved messages are sent, and that rule is enforced in the sending code itself, not only on the screen. Every message carries an unsubscribe link and opt-outs are honoured.",
  },
  {
    q: "Who sees my customers' data?",
    a: "Only your workspace, and only the teammates who have a role in it. Each workspace is isolated at the database level. Customer text goes only to AI routes marked as allowed to receive it, is never used to train models, and sensitive numbers (card numbers, keys, passwords) are hidden before storage and before any AI call. The subprocessors page lists every company that handles data for us.",
  },
  {
    q: "What happens to a customer's data if they ask to be deleted?",
    a: "Deleting a person removes their quotes, conversations, transcripts, recordings, survey answers and files. Working data such as past questions and AI cost records also expires on its own schedule, listed in the privacy policy.",
  },
  {
    q: "Do I have to set things up before it is useful?",
    a: "No. Paste one conversation and you get cited requests in minutes. Everything else (people and accounts, tags, integrations, surveys) can wait.",
  },
  {
    q: "How is a request's value worked out?",
    a: "From the accounts of the people who asked. The value is summed over distinct accounts, so two people from one account count that account once. Account values come from a CSV import, from entering them, or (soon) read-only from HubSpot or Salesforce.",
  },
  {
    q: "Can it work with my help desk, call tool or forms tool?",
    a: "Yes, through one inbound web request that almost every tool can send. You choose what to send (a ticket thread, a call transcript, a form answer), and a retry never stores it twice. Native connectors that capture automatically are on the list; see the integrations page for what is available, coming soon and planned.",
  },
  {
    q: "Can my AI assistant use it?",
    a: "Yes. Connect Claude, ChatGPT, Cursor or another assistant that supports remote tools. An admin approves what it may do. It can search and read requests, ask cited questions, find quotes by meaning and add notes to the review queue. With an extra permission it can change a request's status (never to or from shipped) and add tags. It cannot send, publish, merge or delete anything.",
  },
  {
    q: "Which AI providers do you use?",
    a: "Models are used through one interface with separate small, mid and large tiers and failover, so providers can change without changing what the platform promises. The subprocessors page lists the providers in use at any time. Every AI call records the provider, model, prompt version, tokens and cost.",
  },
  {
    q: "Can I get my data out?",
    a: "Yes. An admin can export the whole workspace (companies, people, conversations, requests and the quotes behind them) and import it again.",
  },
  {
    q: "Is it accessible?",
    a: "The target is WCAG 2.2 AA: semantic pages, full keyboard use, labelled controls, announced errors, good contrast in light and dark, and phone-width layouts. Automated checks run on the main flows. A screen-reader review by a person is still to come, and we will say so here when it is done.",
  },
  {
    q: "What does it cost?",
    a: "There is a free plan and paid plans for teams that need recordings, surveys, integrations and more. Prices will be published before launch; the pricing page shows what each plan includes.",
  },
  {
    q: "Where can I ask for something, or report a problem?",
    a: "Use the contact page, or the feedback address on the community page. Integration requests are especially welcome: the order of the list follows what people ask for.",
  },
];
