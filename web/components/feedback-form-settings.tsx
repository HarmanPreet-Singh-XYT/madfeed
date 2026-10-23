"use client";

import { useActionState } from "react";
import {
  forgetSubmitterAction,
  saveFormAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

function embedCode(api: string, slug: string, key: string) {
  return `<form id="feedback-form">
  <label>Your feedback <textarea name="text" required maxlength="5000"></textarea></label>
  <label>Email (optional) <input name="email" type="email"></label>
  <button>Send</button>
  <p id="feedback-status" role="status"></p>
</form>
<script>
document.getElementById("feedback-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, s = document.getElementById("feedback-status");
  const body = { key: "${key}", text: f.text.value };
  if (f.email.value) body.email = f.email.value;
  try {
    const r = await fetch("${api}/v1/public/sites/${slug}/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    s.textContent = r.ok ? "Thank you!" : "Sorry, that did not go through.";
    if (r.ok) f.reset();
  } catch { s.textContent = "Sorry, that did not go through."; }
});
</script>`;
}

export function FeedbackFormSettings({
  workspaceId,
  enabled,
  keyValue,
  origins,
  slug,
  apiUrl,
}: {
  workspaceId: string;
  enabled: boolean;
  keyValue?: string;
  origins: string[];
  slug?: string;
  apiUrl: string;
}) {
  const [state, action, pending] = useActionState(
    saveFormAction.bind(null, workspaceId),
    undefined,
  );
  const [fstate, faction, fpending] = useActionState(
    forgetSubmitterAction.bind(null, workspaceId),
    undefined,
  );
  if (!slug)
    return (
      <p className="text-muted">
        Set a public address above first; the form is reached through it.
      </p>
    );
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="origins" className="mb-1 block text-sm font-medium">
            Websites allowed to use the form (one per line)
          </label>
          <textarea
            id="origins"
            name="origins"
            rows={3}
            defaultValue={origins.join("\n")}
            className={field}
            aria-describedby="origins-help"
          />
          <p id="origins-help" className="mt-1 text-sm text-muted">
            Full addresses like https://www.example.com. Other sites cannot send
            feedback, even with the key.
          </p>
        </div>
        <FormError message={state?.error} />
        {state?.notice ? (
          <p role="status" className="text-sm text-muted">
            {state.notice}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            name="intent"
            value="save"
            className={btnPrimary}
            disabled={pending}
          >
            {enabled ? "Save sites" : "Turn the form on"}
          </button>
          {enabled ? (
            <>
              <button
                type="submit"
                name="intent"
                value="rotate"
                className={btn}
                disabled={pending}
              >
                Issue a new key
              </button>
              <button
                type="submit"
                name="intent"
                value="disable"
                className={btn}
                disabled={pending}
              >
                Turn the form off
              </button>
            </>
          ) : null}
        </div>
      </form>

      {enabled && keyValue ? (
        <div className="space-y-2">
          <h3 className="font-medium">Add it to your website</h3>
          <p className="text-sm text-muted">
            Paste this where the form should appear. The key identifies your
            workspace; it is not a password, which is why the allowed websites
            matter. Everything sent arrives in your review queue; nothing is
            published or acted on without a person.
          </p>
          <textarea
            readOnly
            aria-label="Embed code"
            rows={10}
            className={`${field} font-mono text-xs`}
            value={embedCode(apiUrl, slug, keyValue)}
          />
        </div>
      ) : null}

      <form action={faction} className="space-y-2">
        <h3 className="font-medium">Erase a visitor&apos;s submissions</h3>
        <label htmlFor="forget-email" className="block text-sm text-muted">
          Removes everything that arrived from this email address through the
          form, with the suggestions and quotes built on it.
        </label>
        <div className="flex flex-wrap gap-3">
          <input
            id="forget-email"
            name="email"
            type="email"
            maxLength={320}
            className={`${field} max-w-sm`}
          />
          <button type="submit" className={btn} disabled={fpending}>
            Erase
          </button>
        </div>
        <FormError message={fstate?.error} />
        {fstate?.notice ? (
          <p role="status" className="text-sm text-muted">
            {fstate.notice}
          </p>
        ) : null}
      </form>
    </div>
  );
}
