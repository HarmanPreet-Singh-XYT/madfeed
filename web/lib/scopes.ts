// What each permission lets an AI assistant or key do, in the words shown to people.
export const SCOPE_TEXT: Record<string, { label: string; help: string }> = {
  requests: {
    label: "See requests",
    help: "titles, status and counts of quotes, people and accounts",
  },
  quotes: {
    label: "See customer quotes",
    help: "the exact words behind each request",
  },
  ask: {
    label: "Ask questions",
    help: "answers are built from, and cite, stored quotes",
  },
  submit: {
    label: "Add notes to the review queue",
    help: "a person still decides whether a note becomes a request",
  },
  write: {
    label: "Change statuses and add tags",
    help: "it can never mark a request shipped, so nothing is sent to customers",
  },
};
