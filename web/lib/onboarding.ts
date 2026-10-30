// Everything the first-run help knows: the tour's steps, the one-line tip each tool page can show, and the few flags
// that remember what a person has already seen. Pure data and tiny helpers, so it is easy to test; the components
// that draw it live in components/onboarding. Copy is plain and uses the product's own nouns (see
// synthesis/00-glossary.md).

/** What the API calls the example workspace (portability.SampleName); the banner and the tour recognise it by it. */
export const SAMPLE_WORKSPACE_NAME = "Sample workspace";

export const isSampleWorkspace = (name: string) =>
  name === SAMPLE_WORKSPACE_NAME;

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** The value of a `data-tour` attribute to spotlight. No target means a centred card. */
  target?: string;
  /** Skip the step when its target is not on screen (the search box is hidden on small screens). */
  onlyWithTarget?: boolean;
  /** A button on the card that goes somewhere, as a path under the workspace. */
  action?: { label: string; path: string };
};

/**
 * The tour for this workspace: only the tools that are switched on, and nothing about adding feedback for someone
 * who cannot add it. `available` is the list of navigation paths the person can see.
 */
export function tourSteps(
  available: readonly string[],
  canAdd: boolean,
): TourStep[] {
  const has = (p: string) => available.includes(p);
  const steps: (TourStep | false)[] = [
    {
      id: "welcome",
      title: "A quick look around",
      body: "This takes about a minute. We will show where things are and how a customer conversation becomes a request with proof behind it. You can leave at any time and come back from the Help menu.",
    },
    canAdd &&
      has("add") && {
        id: "add",
        target: "nav-add",
        title: "Start here: add feedback",
        body: "Paste a call, an email or a chat. We pick out what customers asked for and keep their exact words.",
      },
    has("review") && {
      id: "review",
      target: "nav-review",
      title: "Check what we found",
      body: "Every suggestion shows the customer's own sentence. Accept the real ones; nothing is saved until you do. The keys J, K, A and D move, accept and dismiss.",
    },
    has("requests") && {
      id: "requests",
      target: "nav-requests",
      title: "Requests, weighed by who asked",
      body: "Each accepted suggestion becomes a request with its quotes as evidence. Its value adds up across the accounts behind it, each counted once.",
    },
    has("quotes") && {
      id: "quotes",
      target: "nav-quotes",
      title: "Every quote in one place",
      body: "Search, tag and filter what customers said. Each quote links back to the conversation it came from.",
    },
    has("ask") && {
      id: "ask",
      target: "nav-ask",
      title: "Ask your quotes",
      body: "Ask a question in plain words. Answers cite stored quotes, and when the quotes do not say, you are told so instead of getting a guess.",
    },
    has("outreach") && {
      id: "outreach",
      target: "nav-outreach",
      title: "Tell people when it ships",
      body: "When a request ships, we draft a personal note to each person who asked, using their own words. You approve every message. Nothing is sent without that.",
    },
    {
      id: "search",
      target: "search",
      onlyWithTarget: true,
      title: "Jump anywhere",
      body: "Press ⌘K (Ctrl K on Windows) to go to any screen, start something, or search the words of a quote.",
    },
    {
      id: "help",
      target: "help",
      onlyWithTarget: true,
      title: "Help is one click away",
      body: "Replay this tour, see the keyboard shortcuts and read the guides from here, whenever you like.",
    },
    {
      id: "finish",
      title: "You are ready",
      body: canAdd && has("add")
        ? "Add your first conversation to see it work. Prefer to look around first? Open the sample workspace from the Overview: it holds made-up data and you can delete it any time."
        : "Look around the Overview and the requests. Ask an admin if you need to add something.",
      action:
        canAdd && has("add")
          ? { label: "Add feedback", path: "add" }
          : undefined,
    },
  ];
  return steps.filter((s): s is TourStep => Boolean(s));
}

export type Hint = {
  id: string;
  title: string;
  body: string;
  tips: string[];
};

const HINTS: Hint[] = [
  {
    id: "add",
    title: "Paste anything customers said",
    body: "A call transcript, an email thread or a chat. Long is fine: we split it up and find each separate request. The same text added twice is only counted once.",
    tips: [
      "Link the conversation to a person so their account's value counts.",
      "Secrets and card-like numbers are removed before anything is stored.",
    ],
  },
  {
    id: "review",
    title: "You decide what becomes a request",
    body: "Accepting turns a suggestion into a request with its quote as evidence. Dismissing leaves nothing behind. Either can be undone later from the Accepted and Dismissed tabs.",
    tips: [
      "Spot a near-duplicate? Add it to the request that already exists instead of making a second one.",
      "Once you trust the confidence score, accept everything above a level in one go.",
    ],
  },
  {
    id: "requests",
    title: "Requests, most valuable first",
    body: "A request's value is added up across the accounts behind it, each counted once, so ten people at one company count as one.",
    tips: [
      "Open a request to read every quote that backs it.",
      "Move one to a shipped status to start personal messages to the people who asked. You approve each one before it is sent.",
      "Save a set of filters as a view to come back to it.",
    ],
  },
  {
    id: "quotes",
    title: "Everything customers said, with the source",
    body: "Every stored quote is word for word from its conversation. Filter by tag, feeling, source or date, and switch between the table and the board.",
    tips: [
      "Search by meaning as well as by exact words.",
      "Write what you learn up as a finding; its quote cards always show the stored quote.",
    ],
  },
  {
    id: "ask",
    title: "Answers come with their quotes",
    body: "Ask about what customers said. Every answer cites stored quotes, and if they do not support one you will see that instead of a guess.",
    tips: [
      "Ask narrow questions: who asked about sign-in, and what did they say?",
      "Open any cited quote to read the whole conversation around it.",
    ],
  },
  {
    id: "roadmap",
    title: "Your requests by status",
    body: "The most valuable requests come first in each status. Click one to see its evidence.",
    tips: [
      "You can also publish a version of this for customers to see and vote on.",
    ],
  },
  {
    id: "outreach",
    title: "Nothing goes out until you approve it",
    body: "Shipping a request drafts one personal message per person who asked, built from their own quotes. Read each, edit it, then approve.",
    tips: [
      "People who opted out are skipped automatically.",
      "Approved messages wait in the queue if email is ever down.",
    ],
  },
  {
    id: "releases",
    title: "Tell everyone what changed",
    body: "Write a release note, link the requests it covers, and publish it now or schedule it. Each has a public page.",
    tips: ["The people who asked for a request can be marked as told."],
  },
  {
    id: "surveys",
    title: "Ask customers directly",
    body: "Start from a template or a blank survey. Send personal links by email once you approve, or share one public link.",
    tips: [
      "Target an audience by what you already know about people.",
      "Free-text answers go to the review queue like any other conversation.",
    ],
  },
  {
    id: "inbox",
    title: "One place for customer messages",
    body: "Website chat and email arrive here. Teammates reply from the inbox, and two people cannot answer the same message at once.",
    tips: [
      "Use a private note to talk to your team without the customer seeing it.",
      "Send a customer message to Review to turn it into a request.",
    ],
  },
  {
    id: "people",
    title: "People and the accounts they belong to",
    body: "Each person can belong to an account. Value lives on the account, which is how requests are weighed.",
    tips: [
      "Import people from a spreadsheet; a preview shows problems before anything is saved.",
      "Deleting a person removes their quotes, transcripts and recordings.",
    ],
  },
  {
    id: "quality",
    title: "How well the suggestions are doing",
    body: "See how many suggestions you accept, accept unchanged and dismiss, compared with the period before, and what the AI costs.",
    tips: [
      "Admins also get a few spot checks each week: mark an answer as backed, or not backed, by its quotes.",
    ],
  },
];

export const HINT_IDS = HINTS.map((h) => h.id);

/** The tip for the page at `pathname`, or nothing for the overview, a detail page or a tool without one. */
export function hintFor(pathname: string, base: string): Hint | undefined {
  if (!pathname.startsWith(`${base}/`)) return undefined;
  const rest = pathname.slice(base.length + 1).replace(/\/+$/, "");
  if (rest.includes("/")) return undefined; // a request, a conversation, a note: the tip belongs to the list
  return HINTS.find((h) => h.id === rest);
}

// What has been seen is remembered in this browser only. It never leaves it and carries nothing about the person,
// so there is nothing to protect, delete or migrate; a person on a new browser simply sees the tour again.
export const KEYS = {
  /** "done" once the tour was finished or skipped. */
  tour: "onb:v1:tour",
  /** "off" when all page tips are switched off. */
  hints: "onb:v1:hints",
  hint: (id: string) => `onb:v1:hint:${id}`,
} as const;

export const CHANGE_EVENT = "onboarding:change";

export function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage can be blocked (private windows, strict settings); the app must work without it
  }
}

export function writeFlag(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* blocked: the tip simply shows again next time */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Show every page tip again, including the ones closed one by one. */
export function resetTips() {
  for (const id of HINT_IDS) writeFlag(KEYS.hint(id), null);
  writeFlag(KEYS.hints, null);
}
