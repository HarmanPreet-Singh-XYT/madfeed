"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

export async function saveSettingsAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const publicSlug = String(formData.get("publicSlug") ?? "")
    .trim()
    .toLowerCase();
  const senderName = String(formData.get("senderName") ?? "").trim();
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/settings", {
        params: { path: { workspaceId } },
        body: { publicSlug, senderName },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

export type FormSettingsState = { error?: string; notice?: string } | undefined;

/** Saves the feedback form's allowed sites; "intent" says whether to turn it on, off or issue a new key. */
export async function saveFormAction(
  workspaceId: string,
  _prev: FormSettingsState,
  formData: FormData,
): Promise<FormSettingsState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const intent = String(formData.get("intent") ?? "save");
  const origins = String(formData.get("origins") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const enabled = intent !== "disable";
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/form", {
        params: { path: { workspaceId } },
        body: { enabled, origins, rotateKey: intent === "rotate" },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return {
    notice:
      intent === "disable"
        ? "The form is off."
        : intent === "rotate"
          ? "New key issued. The old one no longer works."
          : "Saved.",
  };
}

/** Erases every form submission from one email address. */
export async function forgetSubmitterAction(
  workspaceId: string,
  _prev: FormSettingsState,
  formData: FormData,
): Promise<FormSettingsState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter the email address to erase." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/form/forget", {
        params: { path: { workspaceId } },
        body: { email },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}`, "layout");
  const n = res.value.removed;
  return {
    notice:
      n === 0
        ? "Nothing was stored from that address."
        : `Erased ${n} ${n === 1 ? "submission" : "submissions"}, with everything built on ${n === 1 ? "it" : "them"}.`,
  };
}

export type DigestState =
  { error?: string; notice?: string; preview?: string } | undefined;

/** Saves the weekly digest's schedule and recipients; "intent" is "save" or "preview". */
export async function saveDigestAction(
  workspaceId: string,
  _prev: DigestState,
  formData: FormData,
): Promise<DigestState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  if (formData.get("intent") === "preview") {
    const res = await attempt(async () =>
      unwrap(
        await (
          await api()
        ).GET("/v1/workspaces/{workspaceId}/digest/preview", {
          params: { path: { workspaceId } },
        }),
      ),
    );
    if (!res.ok) return res.state;
    return { preview: `${res.value.subject}\n\n${res.value.text}` };
  }
  const weekday = Number(formData.get("weekday"));
  const hourUtc = Number(formData.get("hourUtc"));
  if (!Number.isInteger(weekday) || !Number.isInteger(hourUtc))
    return { error: "Choose a day and an hour." };
  const recipients = String(formData.get("recipients") ?? "")
    .split(/[\r\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/digest", {
        params: { path: { workspaceId } },
        body: {
          enabled: formData.get("enabled") === "on",
          weekday,
          hourUtc,
          recipients,
          recipientsConfirmed: formData.get("confirmed") === "on",
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return { notice: "Saved." };
}

export type VotingSecretState = { error?: string; secret?: string } | undefined;

/** Makes a new signing secret for verified voting links. It is returned once and never stored by this app. */
export async function rotateVotingSecretAction(
  workspaceId: string,
): Promise<VotingSecretState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/voting/secret", {
        params: { path: { workspaceId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return { secret: res.value.secret };
}

export type ApiKeyState =
  { error?: string; secret?: string; name?: string } | undefined;

/** Makes a read-only key. The secret comes back once and is never stored by this app. */
export async function createApiKeyAction(
  workspaceId: string,
  _prev: ApiKeyState,
  formData: FormData,
): Promise<ApiKeyState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 80)
    return { error: "Give the key a name of up to 80 characters." };
  const SCOPES = ["requests", "quotes", "ask", "submit", "write"] as const;
  const scopes = SCOPES.filter((s) => formData.get(`scope-${s}`) === "on");
  if (scopes.length === 0)
    return { error: "Choose at least one thing the key may do." };
  const days = Number(formData.get("days") ?? 0);
  if (!Number.isInteger(days) || days < 0 || days > 365)
    return { error: "Choose how long the key lasts." };
  const allowedCidrs = String(formData.get("addresses") ?? "")
    .split(/[\r\n,;\s]+/)
    .filter(Boolean);
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/api-keys", {
        params: { path: { workspaceId } },
        body: {
          name,
          scopes,
          ...(days > 0 ? { expiresInDays: days } : {}),
          allowedCidrs,
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return { secret: res.value.secret, name };
}

export async function revokeApiKeyAction(
  workspaceId: string,
  keyId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(keyId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/api-keys/{keyId}", {
        params: { path: { workspaceId, keyId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

export async function disconnectAssistantAction(
  workspaceId: string,
  grantId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(grantId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/oauth/grants/{grantId}", {
        params: { path: { workspaceId, grantId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

export type KeyEvent = {
  at: string;
  action: string;
  detail: string;
  ok: boolean;
};

/** What a key did lately, for the activity view. */
export async function keyEventsAction(
  workspaceId: string,
  keyId: string,
): Promise<{ error?: string; events?: KeyEvent[] }> {
  if (!isUuid(workspaceId) || !isUuid(keyId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/api-keys/{keyId}/events", {
        params: { path: { workspaceId, keyId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  return { events: res.value.events };
}

// ---- billing ----

/** Sends the person to pay for a plan. Returns only if it could not (the message says why). */
export async function startCheckoutAction(
  workspaceId: string,
  planId: string,
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(planId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/billing/checkout", {
        params: { path: { workspaceId } },
        body: { planId },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  redirect(res.value.url);
}

/** Sends the person to change plan, update the card, read invoices or cancel. */
export async function openBillingPortalAction(
  workspaceId: string,
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/billing/portal", {
        params: { path: { workspaceId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  redirect(res.value.url);
}

// ---- connections ----

export async function startSlackAction(
  workspaceId: string,
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/integrations/slack/connect", {
        params: { path: { workspaceId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  redirect(res.value.url);
}

export async function slackChannelsAction(
  workspaceId: string,
): Promise<{ error?: string; channels?: { id: string; name: string }[] }> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/integrations/slack/channels", {
        params: { path: { workspaceId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  return { channels: res.value.channels };
}

export async function setSlackChannelAction(
  workspaceId: string,
  channelId: string,
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId) || !/^C[A-Z0-9]{2,30}$/.test(channelId))
    return { error: "Choose a channel from the list." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/integrations/slack/channel", {
        params: { path: { workspaceId } },
        body: { channelId },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/settings`);
  return {};
}

export async function checkConnectionAction(
  workspaceId: string,
  kind: "slack" | "github" | "linear" | "jira",
): Promise<{ error?: string; ok?: boolean }> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    kind === "slack"
      ? unwrapEmpty(
          await (
            await api()
          ).POST("/v1/workspaces/{workspaceId}/integrations/slack/check", {
            params: { path: { workspaceId } },
          }),
        )
      : kind === "jira"
        ? unwrapEmpty(
            await (
              await api()
            ).POST("/v1/workspaces/{workspaceId}/integrations/jira/check", {
              params: { path: { workspaceId } },
            }),
          )
        : kind === "linear"
          ? unwrapEmpty(
              await (
                await api()
              ).POST("/v1/workspaces/{workspaceId}/integrations/linear/check", {
                params: { path: { workspaceId } },
              }),
            )
          : unwrapEmpty(
              await (
                await api()
              ).POST("/v1/workspaces/{workspaceId}/integrations/github/check", {
                params: { path: { workspaceId } },
              }),
            ),
  );
  revalidatePath(`/w/${workspaceId}/settings`);
  if (!res.ok) return { error: res.state?.error };
  return { ok: true };
}

export async function disconnectAction(
  workspaceId: string,
  kind: "slack" | "github" | "linear" | "jira",
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/integrations/{kind}", {
        params: { path: { workspaceId, kind } },
      }),
    ),
  );
  revalidatePath(`/w/${workspaceId}/settings`);
  if (!res.ok) return { error: res.state?.error };
  return {};
}

export type GithubState =
  { error?: string; webhookUrl?: string; webhookSecret?: string } | undefined;

export async function connectGithubAction(
  workspaceId: string,
  _prev: GithubState,
  formData: FormData,
): Promise<GithubState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const token = String(formData.get("token") ?? "").trim();
  const repo = String(formData.get("repo") ?? "").trim();
  if (!token) return { error: "Paste the access token." };
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo))
    return { error: "The repository must look like owner/name." };
  const close = String(formData.get("close") ?? "");
  const reopen = String(formData.get("reopen") ?? "");
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/integrations/github/connect", {
        params: { path: { workspaceId } },
        body: {
          token,
          repo,
          allowPublicRepo: formData.get("public") === "on",
          ...(isUuid(close) ? { closeStatusId: close } : {}),
          ...(isUuid(reopen) ? { reopenStatusId: reopen } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return {
    webhookUrl: res.value.webhookUrl,
    webhookSecret: res.value.webhookSecret,
  };
}

export async function setGithubMappingAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const close = String(formData.get("close") ?? "");
  const reopen = String(formData.get("reopen") ?? "");
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/integrations/github/mapping", {
        params: { path: { workspaceId } },
        body: {
          ...(isUuid(close) ? { closeStatusId: close } : {}),
          ...(isUuid(reopen) ? { reopenStatusId: reopen } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

const BAD_LINK = "That link is not valid. Go back and try again.";

export type JiraState =
  { error?: string; webhookUrl?: string; webhookSecret?: string } | undefined;

export async function connectJiraAction(
  workspaceId: string,
  _prev: JiraState,
  formData: FormData,
): Promise<JiraState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const f = (n: string) => String(formData.get(n) ?? "").trim();
  const site = f("site");
  const email = f("email");
  const token = f("token");
  const project = f("project").toUpperCase();
  if (!site) return { error: "Enter your Jira site, for example acme." };
  if (!email.includes("@"))
    return { error: "Enter the Atlassian account's email address." };
  if (!token) return { error: "Paste the API token." };
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(project))
    return {
      error:
        "The project key is the short prefix of its issues, for example PROJ.",
    };
  const close = f("close");
  const reopen = f("reopen");
  const issueType = f("issueType");
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/integrations/jira/connect", {
        params: { path: { workspaceId } },
        body: {
          site,
          email,
          token,
          project,
          ...(issueType ? { issueType } : {}),
          ...(isUuid(close) ? { closeStatusId: close } : {}),
          ...(isUuid(reopen) ? { reopenStatusId: reopen } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return {
    webhookUrl: res.value.webhookUrl,
    webhookSecret: res.value.webhookSecret,
  };
}

export async function setJiraMappingAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const close = String(formData.get("close") ?? "");
  const reopen = String(formData.get("reopen") ?? "");
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/integrations/jira/mapping", {
        params: { path: { workspaceId } },
        body: {
          ...(isUuid(close) ? { closeStatusId: close } : {}),
          ...(isUuid(reopen) ? { reopenStatusId: reopen } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

export type LinearState = { error?: string; webhookUrl?: string } | undefined;

export async function connectLinearAction(
  workspaceId: string,
  _prev: LinearState,
  formData: FormData,
): Promise<LinearState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const token = String(formData.get("token") ?? "").trim();
  const teamKey = String(formData.get("teamKey") ?? "")
    .trim()
    .toUpperCase();
  if (!token) return { error: "Paste the API key." };
  if (!/^[A-Z0-9]{1,10}$/.test(teamKey))
    return {
      error: "The team key is the short prefix of its issues, for example ENG.",
    };
  const close = String(formData.get("close") ?? "");
  const reopen = String(formData.get("reopen") ?? "");
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/integrations/linear/connect", {
        params: { path: { workspaceId } },
        body: {
          token,
          teamKey,
          ...(isUuid(close) ? { closeStatusId: close } : {}),
          ...(isUuid(reopen) ? { reopenStatusId: reopen } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return { webhookUrl: res.value.webhookUrl };
}

export async function setLinearSecretAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<{ error?: string; saved?: boolean } | undefined> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const secret = String(formData.get("secret") ?? "").trim();
  if (!secret) return { error: "Paste the signing secret Linear shows." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/integrations/linear/secret", {
        params: { path: { workspaceId } },
        body: { secret },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return { saved: true };
}

export async function setLinearMappingAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const close = String(formData.get("close") ?? "");
  const reopen = String(formData.get("reopen") ?? "");
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/integrations/linear/mapping", {
        params: { path: { workspaceId } },
        body: {
          ...(isUuid(close) ? { closeStatusId: close } : {}),
          ...(isUuid(reopen) ? { reopenStatusId: reopen } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

export type WebhookState =
  { error?: string; secret?: string; url?: string } | undefined;

/** Adds an address for signed messages. The signing secret comes back once. */
export async function createWebhookAction(
  workspaceId: string,
  _prev: WebhookState,
  formData: FormData,
): Promise<WebhookState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: "Enter the address that should receive messages." };
  const events = formData.getAll("events").map(String);
  if (events.length === 0) return { error: "Choose at least one event." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/webhooks", {
        params: { path: { workspaceId } },
        body: {
          url,
          description: String(formData.get("description") ?? "").trim(),
          events,
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return { secret: res.value.secret, url: res.value.endpoint.url };
}

export async function setWebhookEnabledAction(
  workspaceId: string,
  id: string,
  enabled: boolean,
  current: { url: string; description: string; events: string[] },
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(id)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/webhooks/{webhookId}", {
        params: { path: { workspaceId, webhookId: id } },
        body: { ...current, enabled },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

export async function deleteWebhookAction(
  workspaceId: string,
  id: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(id)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/webhooks/{webhookId}", {
        params: { path: { workspaceId, webhookId: id } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

export async function testWebhookAction(
  workspaceId: string,
  id: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(id)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/webhooks/{webhookId}/test", {
        params: { path: { workspaceId, webhookId: id } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  return undefined;
}

export async function rotateWebhookSecretAction(
  workspaceId: string,
  id: string,
): Promise<{ error?: string; secret?: string }> {
  if (!isUuid(workspaceId) || !isUuid(id)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/webhooks/{webhookId}/secret", {
        params: { path: { workspaceId, webhookId: id } },
      }),
    ),
  );
  if (!res.ok) return res.state ?? {};
  return { secret: res.value.secret };
}

export type WebhookDelivery = {
  id: string;
  eventType: string;
  state: "pending" | "sent" | "failed";
  attempts: number;
  lastStatus?: number;
  lastError: string;
  createdAt: string;
};

export async function webhookDeliveriesAction(
  workspaceId: string,
  id: string,
): Promise<{ error?: string; deliveries?: WebhookDelivery[] }> {
  if (!isUuid(workspaceId) || !isUuid(id)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/webhooks/{webhookId}/deliveries", {
        params: { path: { workspaceId, webhookId: id } },
      }),
    ),
  );
  if (!res.ok) return res.state ?? {};
  return { deliveries: res.value.deliveries };
}
