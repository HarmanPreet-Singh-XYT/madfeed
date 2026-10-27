import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store, SurveyRec } from "../store";

// Surveys: building them, choosing who gets one, sending, answering from the link, and reading the results.

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();

const find = (s: Store, id: string): SurveyRec => {
  const r = s.surveys.find((x) => x.survey.id === id);
  if (!r) throw notFound("That survey");
  return r;
};
const counts = (r: SurveyRec) => {
  const by: Record<string, number> = {};
  for (const i of r.invites) by[i.state] = (by[i.state] ?? 0) + 1;
  r.survey.invitesByState = by;
  r.survey.responses = r.responses.filter((x) => x.complete).length;
  r.survey.partial = r.responses.filter((x) => !x.complete).length;
};
const link = (id: string) => `http://localhost:3100/s/${id}`;

on("GET", `${W}/surveys`, ({ s }) => ({
  surveys: s.surveys.map((r) => {
    counts(r);
    return {
      id: r.survey.id,
      title: r.survey.title,
      state: r.survey.state,
      delivery: r.survey.delivery,
      createdAt: r.survey.createdAt,
      invitesSent: r.invites.filter((i) => i.state === "sent").length,
      responses: r.survey.responses,
    };
  }),
}));
on("POST", `${W}/surveys`, ({ s, body }) => {
  const id = freshId();
  const survey = {
    id,
    title: String(body.title),
    intro: String(body.intro ?? ""),
    thankYou: String(body.thankYou ?? "Thank you."),
    state: "draft" as const,
    delivery: body.delivery ?? "invited",
    onPersonDelete: body.onPersonDelete ?? "remove",
    createdAt: now(),
    questions: [],
    invitesByState: {},
    responses: 0,
    partial: 0,
  };
  s.surveys.unshift({ survey, invites: [], responses: [] });
  return created({ id });
});
on("GET", `${W}/surveys/{surveyId}`, ({ s, params }) => {
  const r = find(s, params.surveyId);
  counts(r);
  return {
    ...r.survey,
    publicLink: r.survey.delivery === "open" ? link(r.survey.id) : undefined,
  };
});
on("PUT", `${W}/surveys/{surveyId}`, ({ s, params, body }) => {
  const r = find(s, params.surveyId);
  Object.assign(r.survey, {
    title: String(body.title),
    intro: body.intro ?? r.survey.intro,
    thankYou: body.thankYou ?? r.survey.thankYou,
    delivery: body.delivery ?? r.survey.delivery,
    onPersonDelete: body.onPersonDelete ?? r.survey.onPersonDelete,
  });
});
on("DELETE", `${W}/surveys/{surveyId}`, ({ s, params }) => {
  find(s, params.surveyId);
  s.surveys = s.surveys.filter((x) => x.survey.id !== params.surveyId);
});
on("PUT", `${W}/surveys/{surveyId}/questions`, ({ s, params, body }) => {
  const r = find(s, params.surveyId);
  type In = {
    kind: "nps" | "csat" | "choice" | "text";
    prompt: string;
    required?: boolean;
    options?: string[];
    showIf?: { question: number; op: string; number?: number; choice?: string };
    showWhen?: {
      match: string;
      conditions: {
        question: number;
        op: string;
        number?: number;
        choice?: string;
      }[];
    };
  };
  const input = body.questions as In[];
  const ids = input.map((_, i) => r.survey.questions[i]?.id ?? freshId());
  const cond = (c: {
    question: number;
    op: string;
    number?: number;
    choice?: string;
  }) => ({
    questionId: ids[c.question],
    op: c.op as "eq",
    number: c.number,
    choice: c.choice,
  });
  r.survey.questions = input.map((x, i) => ({
    id: ids[i],
    kind: x.kind,
    prompt: x.prompt,
    required: x.required ?? true,
    options: x.options ?? [],
    showIf: x.showIf ? cond(x.showIf) : undefined,
    showWhen: x.showWhen
      ? {
          match: x.showWhen.match as "all",
          conditions: x.showWhen.conditions.map(cond),
        }
      : undefined,
  }));
});
on(
  "PUT",
  `${W}/surveys/{surveyId}/audience`,
  ({ s, params, body }) =>
    void (find(s, params.surveyId).survey.audience = body.audience),
);
on("POST", `${W}/surveys/{surveyId}/audience/preview`, ({ s }) => {
  const have = s.people.filter((p) => p.email);
  return {
    total: s.people.length,
    withEmail: have.length,
    alreadyInvited: 0,
    sample: have
      .slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name, email: p.email! })),
  };
});
on("POST", `${W}/surveys/{surveyId}/open`, ({ s, params }) => {
  const r = find(s, params.surveyId);
  if (r.survey.questions.length === 0)
    throw new MockError(
      409,
      "no_questions",
      "Add at least one question before opening the survey.",
    );
  Object.assign(r.survey, {
    state: "open",
    openedAt: now(),
    closedAt: undefined,
  });
});
on("POST", `${W}/surveys/{surveyId}/close`, ({ s, params }) => {
  Object.assign(find(s, params.surveyId).survey, {
    state: "closed",
    closedAt: now(),
  });
});
on("POST", `${W}/surveys/{surveyId}/link/reset`, ({ s, params }) => ({
  link: link(find(s, params.surveyId).survey.id),
}));

// ---- invitations
on("GET", `${W}/surveys/{surveyId}/invites`, ({ s, params }) => {
  const r = find(s, params.surveyId);
  return {
    remindable: r.invites.filter((i) => i.state === "sent" && !i.answered)
      .length,
    invites: r.invites,
  };
});
on("POST", `${W}/surveys/{surveyId}/invites`, ({ s, params, body }) => {
  const r = find(s, params.surveyId);
  const have = new Set(r.invites.map((i) => i.personId));
  const todo = s.people.filter(
    (p) => !have.has(p.id) && (body?.withoutEmail || p.email),
  );
  for (const p of todo)
    r.invites.push({
      id: freshId(),
      personId: p.id,
      personName: p.name,
      email: p.email ?? "",
      state: p.email ? "draft" : "manual",
      answered: false,
    });
  counts(r);
  return {
    manual: todo.filter((p) => !p.email).length,
    added: todo.length,
    alreadyInvited: have.size,
    suppressed: 0,
  };
});
on("GET", `${W}/surveys/{surveyId}/invites/links`, ({ s, params }) => ({
  links: find(s, params.surveyId)
    .invites.filter((i) => i.state === "manual")
    .map((i) => ({ personName: i.personName, link: `${link(i.id)}` })),
}));
on("GET", `${W}/surveys/{surveyId}/invites/preview`, ({ s, params }) => ({
  subject: `${find(s, params.surveyId).survey.title}`,
  text: "Hi {name},\n\nWe'd value a minute of your time. Here's a short survey:\n\n{link}\n\nThank you.",
  emailConfigured: true,
}));
on("POST", `${W}/surveys/{surveyId}/invites/approve`, ({ s, params }) => {
  const r = find(s, params.surveyId);
  const drafts = r.invites.filter((i) => i.state === "draft");
  for (const i of drafts) Object.assign(i, { state: "sent", sentAt: now() });
  counts(r);
  return { queued: drafts.length };
});
on("POST", `${W}/surveys/{surveyId}/invites/remind`, ({ s, params }) => {
  const r = find(s, params.surveyId);
  const todo = r.invites.filter((i) => i.state === "sent" && !i.answered);
  for (const i of todo) i.reminded = (i.reminded ?? 0) + 1;
  return { queued: todo.length };
});
on(
  "PUT",
  `${W}/surveys/{surveyId}/invites/{inviteId}/excluded`,
  ({ s, params, body }) => {
    const i = find(s, params.surveyId).invites.find(
      (x) => x.id === params.inviteId,
    );
    if (!i) throw notFound("That invitation");
    i.state = body.excluded ? "excluded" : "draft";
  },
);

// ---- results
on("GET", `${W}/surveys/{surveyId}/results`, ({ s, params }) => {
  const r = find(s, params.surveyId);
  const done = r.responses.filter((x) => x.complete);
  const numeric = r.survey.questions
    .filter((q) => q.kind === "nps" || q.kind === "csat")
    .map((q) => {
      const vals = done.flatMap((x) =>
        x.answers
          .filter((a) => a.questionId === q.id && a.number !== undefined)
          .map((a) => a.number!),
      );
      const promoters = vals.filter((v) => v >= 9).length,
        detractors = vals.filter((v) => v <= 6).length;
      return {
        questionId: q.id,
        kind: q.kind as "nps" | "csat",
        answers: vals.length,
        average: vals.length
          ? vals.reduce((a, b) => a + b, 0) / vals.length
          : 0,
        promoters,
        passives: vals.length - promoters - detractors,
        detractors,
        score: vals.length
          ? Math.round(((promoters - detractors) / vals.length) * 100)
          : 0,
      };
    });
  const choices = r.survey.questions
    .filter((q) => q.kind === "choice")
    .flatMap((q) =>
      q.options.map((o) => ({
        questionId: q.id,
        choice: o,
        count: done
          .flatMap((x) => x.answers)
          .filter((a) => a.questionId === q.id && a.choice === o).length,
      })),
    );
  const text = r.survey.questions
    .filter((q) => q.kind === "text")
    .flatMap((q) =>
      done.flatMap((x) =>
        x.answers
          .filter((a) => a.questionId === q.id && a.text)
          .map((a) => ({
            questionId: q.id,
            text: a.text!,
            person: x.person,
            at: x.at,
          })),
      ),
    );
  return {
    complete: done.length,
    partial: r.responses.length - done.length,
    numeric,
    choices,
    text,
  };
});

// ---- answering from the link
const byToken = (s: Store, token: string): SurveyRec => {
  const direct = s.surveys.find((x) => x.survey.id === token);
  if (direct) return direct;
  const viaInvite = s.surveys.find((x) =>
    x.invites.some((i) => i.id === token),
  );
  if (viaInvite) return viaInvite;
  throw new MockError(404, "not_found", "That survey was not found.");
};
on("GET", "/v1/public/surveys/{token}", ({ s, params, query }) => {
  const r = byToken(s, params.token);
  const who = query.get("respondent");
  const mine = r.responses.find((x) => x.id === who);
  return {
    workspaceName: s.workspace.name,
    title: r.survey.title,
    intro: r.survey.intro,
    thankYou: r.survey.thankYou,
    closed: r.survey.state === "closed",
    answered: Boolean(mine?.complete),
    questions: r.survey.questions,
    saved: mine && !mine.complete ? mine.answers : [],
  };
});
on("POST", "/v1/public/surveys/{token}/answers", ({ s, params, body }) => {
  const r = byToken(s, params.token);
  if (r.survey.state === "closed")
    throw new MockError(409, "closed", "This survey is closed.");
  const id = String(body.respondent ?? freshId());
  const existing = r.responses.find((x) => x.id === id);
  if (existing?.complete)
    return {
      complete: true,
      alreadyAnswered: true,
      thankYou: r.survey.thankYou,
    };
  const rec = existing ?? {
    id,
    complete: false,
    person: "Anonymous",
    at: now(),
    answers: [],
  };
  rec.answers = body.answers;
  rec.complete = Boolean(body.complete);
  if (!existing) r.responses.push(rec);
  const inv = r.invites.find((i) => i.id === params.token);
  if (inv && rec.complete) inv.answered = true;
  return {
    complete: rec.complete,
    alreadyAnswered: false,
    thankYou: r.survey.thankYou,
  };
});
