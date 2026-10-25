"use client";

import { useActionState, useEffect } from "react";
import {
  authorizeAction,
  type AuthorizeState,
} from "@/app/oauth/authorize/actions";
import { keepForm } from "@/lib/keep-form";
import { SCOPE_TEXT } from "@/lib/scopes";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

export type Params = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  resource: string;
};

export function AuthorizeAssistantForm({
  params,
  clientName,
  workspaces,
  requested,
}: {
  params: Params;
  clientName: string;
  workspaces: { id: string; name: string }[];
  requested: string[];
}) {
  const [result, action, pending] = useActionState<AuthorizeState, FormData>(
    authorizeAction,
    undefined,
  );
  useEffect(() => {
    const url = result?.redirectUrl;
    if (!url) return;
    // The API only returns an address the assistant registered; still never run script from one.
    if (/^(javascript|data|vbscript|file):/i.test(url)) return;
    window.location.assign(url);
  }, [result]);
  return (
    <form method="post" onSubmit={keepForm(action)} className="space-y-5">
      {Object.entries(params).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div>
        <label htmlFor="ws" className="mb-1 block text-sm font-medium">
          Workspace it may use
        </label>
        <select
          id="ws"
          name="workspaceId"
          className={field}
          defaultValue={workspaces[0]?.id}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          What “{clientName}” may do
        </legend>
        {Object.entries(SCOPE_TEXT).map(([id, s]) => (
          <div key={id} className="flex items-start gap-3">
            <input
              id={`scope-${id}`}
              name={`scope-${id}`}
              type="checkbox"
              className="mt-0.5 size-5"
              defaultChecked={requested.includes(id)}
            />
            <label htmlFor={`scope-${id}`} className="text-sm">
              <strong>{s.label}</strong>{" "}
              <span className="text-muted-foreground">({s.help})</span>
            </label>
          </div>
        ))}
      </fieldset>
      <p className="text-sm text-muted-foreground">
        It never sees names or email addresses. Its access renews itself until
        you disconnect it under Settings, and it stops if you stop being an
        admin.
      </p>
      <FormError message={result?.error} />
      {result?.redirectUrl ? (
        <p role="status" className="text-sm">
          Done. Returning you to the assistant…
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          name="decision"
          value="approve"
          className={btnPrimary}
          disabled={pending || !!result?.redirectUrl}
        >
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className={btn}
          disabled={pending || !!result?.redirectUrl}
        >
          Not now
        </button>
      </div>
    </form>
  );
}
