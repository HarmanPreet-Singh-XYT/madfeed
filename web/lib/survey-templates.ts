import type { QuestionDraft } from "@/app/(app)/w/[workspaceId]/surveys/actions";

export const TEMPLATES: {
  id: string;
  label: string;
  title: string;
  questions: QuestionDraft[];
}[] = [
  {
    id: "nps",
    label: "Would you recommend us? (NPS)",
    title: "Would you recommend us?",
    questions: [
      {
        kind: "nps",
        prompt: "How likely are you to recommend us to a friend or colleague?",
        required: true,
        options: [],
      },
      {
        kind: "text",
        prompt: "What is the main reason for your score?",
        required: false,
        options: [],
      },
    ],
  },
  {
    id: "csat",
    label: "How satisfied are you? (CSAT)",
    title: "How are we doing?",
    questions: [
      {
        kind: "csat",
        prompt: "How satisfied are you with us overall?",
        required: true,
        options: [],
      },
      {
        kind: "text",
        prompt: "What one thing would make it better?",
        required: false,
        options: [],
      },
    ],
  },
  {
    id: "needs",
    label: "What do you need next?",
    title: "What should we build next?",
    questions: [
      {
        kind: "text",
        prompt:
          "What is the one thing you wish our product did that it does not?",
        required: true,
        options: [],
      },
      {
        kind: "text",
        prompt: "What are you doing instead today?",
        required: false,
        options: [],
      },
      {
        kind: "csat",
        prompt: "How important is this to you? (1 = not at all, 5 = essential)",
        required: false,
        options: [],
      },
    ],
  },
];
