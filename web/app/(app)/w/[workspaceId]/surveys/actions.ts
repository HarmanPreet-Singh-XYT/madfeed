"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";
import type { components } from "@/lib/api/schema.gen";
import { TEMPLATES } from "@/lib/survey-templates";

const BAD_LINK = "That link is not valid. Go back and try again.";
const bad: FormState = { error: BAD_LINK };

type Rule = components["schemas"]["AudienceRule"];
export type QuestionDraft = {
  kind: "nps" | "csat" | "choice" | "text";
  prompt: string;
  required: boolean;
  options: string[];
};

function refresh(ws: string, id?: string) {
  revalidatePath(`/w/${ws}/surveys`);
  if (id) revalidatePath(`/w/${ws}/surveys/${id}`);
}

export async function createSurveyAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return bad;
  const template = TEMPLATES.find((t) => t.id === formData.get("template"));
  const title =
    String(formData.get("title") ?? "").trim() || template?.title || "";
  if (!title) return { error: "Give the survey a title." };
  const delivery =
    formData.get("delivery") === "open"
      ? ("open" as const)
      : ("invited" as const);
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/surveys", {
        params: { path: { workspaceId } },
        body: { title, delivery },
      }),
    ),
  );
  if (!res.ok) return res.state;
  if (template) {
    const q = await saveQuestionsAction(
      workspaceId,
      res.value.id,
      template.questions,
    );
    if (q?.error) return q;
  }
  refresh(workspaceId);
  redirect(`/w/${workspaceId}/surveys/${res.value.id}`);
}

export async function saveSurveyAction(
  workspaceId: string,
  surveyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return { error: BAD_LINK };
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "The survey needs a title." };
  const delivery =
    formData.get("delivery") === "open"
      ? ("open" as const)
      : ("invited" as const);
  const onPersonDelete =
    formData.get("onPersonDelete") === "anonymise"
      ? ("anonymise" as const)
      : ("remove" as const);
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/surveys/{surveyId}", {
        params: { path: { workspaceId, surveyId } },
        body: {
          title,
          intro: String(formData.get("intro") ?? ""),
          thankYou: String(formData.get("thankYou") ?? ""),
          delivery,
          onPersonDelete,
        },
      }),
    ),
  );
  if (!res.ok) return res.state ?? {};
  refresh(workspaceId, surveyId);
  return { saved: true };
}

export async function saveQuestionsAction(
  workspaceId: string,
  surveyId: string,
  questions: QuestionDraft[],
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return bad;
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/surveys/{surveyId}/questions", {
        params: { path: { workspaceId, surveyId } },
        body: {
          questions: questions.map((q) => ({
            kind: q.kind,
            prompt: q.prompt,
            required: q.required,
            ...(q.kind === "choice" ? { options: q.options } : {}),
          })),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, surveyId);
  return undefined;
}

export async function saveAudienceAction(
  workspaceId: string,
  surveyId: string,
  audience: Rule,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return bad;
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/surveys/{surveyId}/audience", {
        params: { path: { workspaceId, surveyId } },
        body: { audience },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, surveyId);
  return undefined;
}

export type Preview = {
  total: number;
  withEmail: number;
  alreadyInvited: number;
  sample: { id: string; name: string; email: string }[];
};

export async function previewAudienceAction(
  workspaceId: string,
  surveyId: string,
  audience: Rule,
): Promise<{ error?: string; preview?: Preview }> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST(
        "/v1/workspaces/{workspaceId}/surveys/{surveyId}/audience/preview",
        {
          params: { path: { workspaceId, surveyId } },
          body: { audience },
        },
      ),
    ),
  );
  if (!res.ok) return res.state ?? {};
  return { preview: res.value };
}

async function post(
  workspaceId: string,
  surveyId: string,
  path: "open" | "close",
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return bad;
  const client = await api();
  const res = await attempt(async () =>
    unwrapEmpty(
      path === "open"
        ? await client.POST(
            "/v1/workspaces/{workspaceId}/surveys/{surveyId}/open",
            { params: { path: { workspaceId, surveyId } } },
          )
        : await client.POST(
            "/v1/workspaces/{workspaceId}/surveys/{surveyId}/close",
            { params: { path: { workspaceId, surveyId } } },
          ),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, surveyId);
  return undefined;
}

export async function openSurveyAction(
  workspaceId: string,
  surveyId: string,
): Promise<FormState> {
  return post(workspaceId, surveyId, "open");
}

export async function closeSurveyAction(
  workspaceId: string,
  surveyId: string,
): Promise<FormState> {
  return post(workspaceId, surveyId, "close");
}

export async function resetLinkAction(
  workspaceId: string,
  surveyId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return bad;
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/surveys/{surveyId}/link/reset", {
        params: { path: { workspaceId, surveyId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, surveyId);
  return undefined;
}

export async function createInvitesAction(
  workspaceId: string,
  surveyId: string,
): Promise<{ error?: string; message?: string }> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/surveys/{surveyId}/invites", {
        params: { path: { workspaceId, surveyId } },
      }),
    ),
  );
  if (!res.ok) return res.state ?? {};
  refresh(workspaceId, surveyId);
  const r = res.value;
  const parts = [`${r.added} added to the list`];
  if (r.alreadyInvited > 0) parts.push(`${r.alreadyInvited} already on it`);
  if (r.suppressed > 0)
    parts.push(`${r.suppressed} left out because they asked not to be emailed`);
  return { message: parts.join(", ") + "." };
}

export async function approveInvitesAction(
  workspaceId: string,
  surveyId: string,
): Promise<{ error?: string; message?: string }> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST(
        "/v1/workspaces/{workspaceId}/surveys/{surveyId}/invites/approve",
        {
          params: { path: { workspaceId, surveyId } },
        },
      ),
    ),
  );
  if (!res.ok) return res.state ?? {};
  refresh(workspaceId, surveyId);
  return {
    message: `${res.value.queued} ${res.value.queued === 1 ? "invitation is" : "invitations are"} on the way.`,
  };
}

export async function setExcludedAction(
  workspaceId: string,
  surveyId: string,
  inviteId: string,
  excluded: boolean,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(surveyId) || !isUuid(inviteId))
    return bad;
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT(
        "/v1/workspaces/{workspaceId}/surveys/{surveyId}/invites/{inviteId}/excluded",
        {
          params: { path: { workspaceId, surveyId, inviteId } },
          body: { excluded },
        },
      ),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, surveyId);
  return undefined;
}

export async function deleteSurveyAction(
  workspaceId: string,
  surveyId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return bad;
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/surveys/{surveyId}", {
        params: { path: { workspaceId, surveyId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  return undefined;
}

export async function remindInvitesAction(
  workspaceId: string,
  surveyId: string,
): Promise<{ error?: string; message?: string }> {
  if (!isUuid(workspaceId) || !isUuid(surveyId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/surveys/{surveyId}/invites/remind", {
        params: { path: { workspaceId, surveyId } },
      }),
    ),
  );
  if (!res.ok) return res.state ?? {};
  refresh(workspaceId, surveyId);
  return {
    message: `${res.value.queued} ${res.value.queued === 1 ? "reminder is" : "reminders are"} on the way.`,
  };
}
