import type { Store, SurveyRec } from "./store";
import { uid } from "./ids";

// Two sample surveys: one sent to named people (with answers coming in) and one open to anyone with a link.

export function seedSurveys(
  people: Store["people"],
  ago: (days: number, hours?: number) => string,
): SurveyRec[] {
  const q = (
    n: number,
    kind: "nps" | "csat" | "choice" | "text",
    prompt: string,
    options: string[] = [],
    required = true,
  ) => ({ id: uid(900 + n), kind, prompt, required, options });
  const questions = [
    q(1, "nps", "How likely are you to recommend us to a colleague?"),
    q(2, "choice", "What best describes how you use it?", [
      "Deciding what to build",
      "Preparing for customer calls",
      "Reporting to leadership",
    ]),
    q(3, "text", "What is one thing we should improve?", [], false),
  ];
  const onboarding: SurveyRec["survey"] = {
    id: uid(910),
    title: "How is onboarding going?",
    intro: "Three short questions. It takes a minute.",
    thankYou: "Thank you, this helps us a lot.",
    state: "open",
    delivery: "invited",
    onPersonDelete: "remove",
    createdAt: ago(8),
    openedAt: ago(7),
    audience: { field: "has_account", op: "is", value: true },
    questions,
    invitesByState: { sent: 5, draft: 1 },
    responses: 4,
    partial: 1,
  };
  const states = ["sent", "sent", "sent", "sent", "sent", "draft"] as const;
  const invites: SurveyRec["invites"] = people.slice(0, 6).map((p, i) => ({
    id: uid(920 + i),
    personId: p.id,
    personName: p.name,
    email: p.email ?? "",
    state: states[i],
    sentAt: states[i] === "sent" ? ago(7) : undefined,
    answered: i < 4,
  }));
  const pick = [
    "Deciding what to build",
    "Preparing for customer calls",
    "Deciding what to build",
    "Reporting to leadership",
  ];
  const scores = [9, 10, 7, 4];
  const words = [
    "Bulk editing would save me time.",
    "More ways to share a request with my team.",
    "",
    "I could not find where to invite someone.",
  ];
  const responses: SurveyRec["responses"] = scores.map((n, i) => ({
    id: uid(930 + i),
    complete: true,
    person: people[i].name,
    at: ago(6 - i),
    answers: [
      { questionId: questions[0].id, number: n },
      { questionId: questions[1].id, choice: pick[i] },
      ...(words[i] ? [{ questionId: questions[2].id, text: words[i] }] : []),
    ],
  }));
  responses.push({
    id: uid(934),
    complete: false,
    person: people[4].name,
    at: ago(1),
    answers: [{ questionId: questions[0].id, number: 8 }],
  });

  const pulse: SurveyRec["survey"] = {
    id: uid(911),
    title: "Quick pulse check",
    intro: "",
    thankYou: "Thanks!",
    state: "draft",
    delivery: "open",
    onPersonDelete: "remove",
    createdAt: ago(2),
    questions: [q(4, "csat", "How satisfied are you with the product today?")],
    invitesByState: {},
    responses: 0,
    partial: 0,
  };
  return [
    { survey: onboarding, invites, responses },
    { survey: pulse, invites: [], responses: [] },
  ];
}
