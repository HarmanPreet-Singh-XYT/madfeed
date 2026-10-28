"use client";

import { useActionState, useRef } from "react";
import { pasteAction } from "@/app/(app)/w/[workspaceId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { btn, field } from "./ui";

// A made-up conversation so a new person can see the result without pasting
// anything real. Clearly labelled; it is not a real customer.
const SAMPLE = `Priya (Northwind Co): Thanks for making time. Overall the team likes the product.

Priya (Northwind Co): The biggest blocker for us is that we can't use single sign-on, so every new hire needs another password. We really need SSO before we can roll this out to the whole company.

Priya (Northwind Co): One more thing, when we export the monthly report the totals are sometimes wrong, and it takes us an hour to double check them by hand.

Support: Thanks Priya, I'll pass both of those on.`;

export function PasteForm({
  workspaceId,
  people,
}: {
  workspaceId: string;
  people: { id: string; label: string }[];
}) {
  const [state, action] = useActionState(
    pasteAction.bind(null, workspaceId),
    undefined,
  );
  const textRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function useSample() {
    if (textRef.current) textRef.current.value = SAMPLE;
    if (titleRef.current && !titleRef.current.value)
      titleRef.current.value = "Sample call with Priya";
    textRef.current?.focus();
  }

  return (
    <form
      action={action}
      className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="space-y-2">
        <label htmlFor="text" className="block text-sm font-medium">
          Conversation
        </label>
        <textarea
          id="text"
          name="text"
          ref={textRef}
          rows={16}
          required
          maxLength={400000}
          className={`${field} min-h-72 resize-y font-mono text-sm leading-relaxed`}
          placeholder="Paste a call transcript, a support thread or a chat…"
          aria-describedby="text-help"
        />
        <p id="text-help" className="text-sm text-muted-foreground">
          We pick out what customers asked for and show you each one next to the
          exact words they used. Nothing is created until you approve it.
        </p>
      </div>

      <aside className="space-y-4">
        <div className="space-y-3 rounded-2xl bg-card shadow-card p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Details (all optional)
          </p>
          {people.length > 0 ? (
            <div>
              <label
                htmlFor="personId"
                className="mb-1 block text-sm font-medium"
              >
                Who said it
              </label>
              <select
                id="personId"
                name="personId"
                defaultValue=""
                className={field}
                aria-describedby="person-help"
              >
                <option value="">Not sure / more than one person</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p
                id="person-help"
                className="mt-1 text-xs text-muted-foreground"
              >
                Picking the person lets us weigh each request by the value of
                the company behind it.
              </p>
            </div>
          ) : null}
          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium">
              Title
            </label>
            <input
              id="title"
              name="title"
              ref={titleRef}
              maxLength={200}
              className={field}
            />
          </div>
          <div>
            <label
              htmlFor="originUrl"
              className="mb-1 block text-sm font-medium"
            >
              Link to the original
            </label>
            <input
              id="originUrl"
              name="originUrl"
              type="url"
              inputMode="url"
              maxLength={2000}
              className={field}
              placeholder="https://…"
            />
          </div>
        </div>
        <FormError message={state?.error} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingLabel="Sending…">Find requests</SubmitButton>
          <button type="button" onClick={useSample} className={btn}>
            Try a sample conversation
          </button>
        </div>
        <ol className="space-y-2 rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1.</span> We read it
            and propose requests.
          </li>
          <li>
            <span className="font-medium text-foreground">2.</span> You review
            each with its exact words.
          </li>
          <li>
            <span className="font-medium text-foreground">3.</span> Accepted
            ones become requests, weighed by who asked.
          </li>
        </ol>
      </aside>
    </form>
  );
}
