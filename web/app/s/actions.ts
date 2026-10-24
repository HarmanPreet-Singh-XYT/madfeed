"use server";

import { publicApi, toApiError } from "@/lib/server/api";

const TOKEN = /^[A-Za-z0-9._-]{20,200}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;

export type Answer = {
  questionId: string;
  number?: number;
  choice?: string;
  text?: string;
};

export type SubmitResult = {
  error?: string;
  complete?: boolean;
  alreadyAnswered?: boolean;
  thankYou?: string;
};

/** Saves answers so far, or finishes. Nothing here needs a sign-in: the link is the credential. */
export async function submitAnswersAction(
  token: string,
  respondent: string,
  answers: Answer[],
  complete: boolean,
  website: string,
): Promise<SubmitResult> {
  if (!TOKEN.test(token)) return { error: "This link is not valid." };
  const res = await publicApi().POST("/v1/public/surveys/{token}/answers", {
    params: { path: { token } },
    body: {
      answers,
      complete,
      website,
      ...(KEY.test(respondent) ? { respondent } : {}),
    },
    cache: "no-store",
  });
  if (res.data) return res.data;
  return { error: toApiError(res.response.status, res.error).message };
}

export type Saved = {
  answered: boolean;
  answers: Answer[];
};

/** What this browser already sent on a public link, so it can pick up where it stopped. */
export async function loadSavedAction(
  token: string,
  respondent: string,
): Promise<Saved> {
  if (!TOKEN.test(token) || !KEY.test(respondent))
    return { answered: false, answers: [] };
  const res = await publicApi().GET("/v1/public/surveys/{token}", {
    params: { path: { token }, query: { respondent } },
    cache: "no-store",
  });
  if (!res.data) return { answered: false, answers: [] };
  return {
    answered: res.data.answered,
    answers: res.data.saved.map((s) => ({
      questionId: s.questionId,
      ...(s.number !== undefined ? { number: s.number } : {}),
      ...(s.choice !== undefined ? { choice: s.choice } : {}),
      ...(s.text !== undefined ? { text: s.text } : {}),
    })),
  };
}
