"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { pasteAction } from "@/app/(app)/w/[workspaceId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { PersonCombobox, type PersonOption } from "./person-combobox";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

// A made-up conversation so a new person can see the result without pasting
// anything real. Clearly labelled; it is not a real customer.
const SAMPLE = {
  title: "Sample call with Priya",
  text: `Priya (Northwind Co): Thanks for making time. Overall the team likes the product.

Priya (Northwind Co): The biggest blocker for us is that we can't use single sign-on, so every new hire needs another password. We really need SSO before we can roll this out to the whole company.

Priya (Northwind Co): One more thing, when we export the monthly report the totals are sometimes wrong, and it takes us an hour to double check them by hand.

Support: Thanks Priya, I'll pass both of those on.`,
};

export function PasteForm({
  workspaceId,
  people,
}: {
  workspaceId: string;
  people: PersonOption[];
}) {
  const [state, action] = useActionState(
    pasteAction.bind(null, workspaceId),
    undefined,
  );
  const [personId, setPersonId] = useState("");
  const countRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const originRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draftKey = `add-feedback-draft:${workspaceId}`;

  function showCount(n: number) {
    if (countRef.current)
      countRef.current.textContent = `${n.toLocaleString()} ${
        n === 1 ? "character" : "characters"
      }`;
  }

  // Pick up where they left off, rather than losing a long paste to a refresh.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        text?: string;
        title?: string;
        originUrl?: string;
      };
      if (textRef.current && draft.text) {
        textRef.current.value = draft.text;
        showCount(draft.text.length);
      }
      if (titleRef.current && draft.title) titleRef.current.value = draft.title;
      if (originRef.current && draft.originUrl)
        originRef.current.value = draft.originUrl;
    } catch {
      // A corrupt or blocked draft must never stop the page working.
    }
  }, [draftKey]);

  function saveDraft() {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const text = textRef.current?.value ?? "";
        const title = titleRef.current?.value ?? "";
        const originUrl = originRef.current?.value ?? "";
        if (!text && !title && !originUrl) {
          window.localStorage.removeItem(draftKey);
        } else {
          window.localStorage.setItem(
            draftKey,
            JSON.stringify({ text, title, originUrl }),
          );
        }
      } catch {
        // Storage can be full or off; the form still submits without it.
      }
    }, 300);
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    if (textRef.current) textRef.current.value = "";
    if (titleRef.current) titleRef.current.value = "";
    if (originRef.current) originRef.current.value = "";
    showCount(0);
    textRef.current?.focus();
  }

  function useSample() {
    if (textRef.current) {
      textRef.current.value = SAMPLE.text;
      showCount(SAMPLE.text.length);
    }
    if (titleRef.current && !titleRef.current.value)
      titleRef.current.value = SAMPLE.title;
    saveDraft();
    textRef.current?.focus();
  }

  return (
    <form
      action={action}
      onSubmit={() => {
        // A successful submit navigates away; an error leaves the page, so the
        // text stays on screen even though the saved draft is gone.
        clearTimeout(saveTimer.current);
        try {
          window.localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
      }}
      className="space-y-3"
    >
      <Card className="[--card-spacing:0px] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
          <label htmlFor="text" className="text-sm font-semibold">
            Conversation
          </label>
          <span className="text-xs text-muted-foreground">Required</span>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <Textarea
            id="text"
            name="text"
            ref={textRef}
            rows={10}
            required
            maxLength={400000}
            className="field-sizing-fixed min-h-56 resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-[0.9375rem] leading-relaxed dark:bg-input/30"
            placeholder="Paste a call transcript, a support thread or a chat…"
            aria-describedby="text-help text-count"
            onInput={(e) => {
              showCount(e.currentTarget.value.length);
              saveDraft();
            }}
          />
          <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <p
              id="text-help"
              className="max-w-prose text-xs leading-relaxed text-muted-foreground"
            >
              We quote each request with the customer&apos;s exact words. Text
              stays in this workspace; card numbers, keys and passwords are
              removed before saving.
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <span
                id="text-count"
                ref={countRef}
                className="text-xs tabular-nums text-muted-foreground"
              >
                0 characters
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={clearDraft}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-muted/40 px-4 py-4 sm:px-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Details</h2>
            <span className="text-xs text-muted-foreground">
              Optional, but they make the result more useful
            </span>
          </div>
          <div className="grid items-start gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {people.length > 0 ? (
              <div>
                <label
                  htmlFor="personId"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  Who said it
                </label>
                <input type="hidden" name="personId" value={personId} />
                <PersonCombobox
                  id="personId"
                  workspaceId={workspaceId}
                  people={people}
                  value={personId}
                  onChange={setPersonId}
                  noneLabel="Not sure / more than one person"
                  describedBy="person-help"
                />
                <p
                  id="person-help"
                  className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
                >
                  Weighs requests by the company&apos;s value.
                </p>
              </div>
            ) : null}
            <div>
              <label
                htmlFor="title"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Title
              </label>
              <Input
                id="title"
                name="title"
                ref={titleRef}
                maxLength={200}
                placeholder="Name this conversation"
                onInput={saveDraft}
              />
            </div>
            <div>
              <label
                htmlFor="originUrl"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Link to the original
              </label>
              <Input
                id="originUrl"
                name="originUrl"
                ref={originRef}
                type="url"
                inputMode="url"
                maxLength={2000}
                placeholder="https://…"
                onInput={saveDraft}
              />
            </div>
          </div>
        </div>

        {state?.error ? (
          <div className="px-4 pb-3 sm:px-5">
            <FormError message={state.error} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
          <p className="max-w-md text-xs text-muted-foreground">
            We propose requests, you review the exact words, and nothing is
            saved until you approve.
          </p>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button type="button" variant="ghost" onClick={useSample}>
              Try a sample conversation
            </Button>
            <SubmitButton pendingLabel="Sending…">Find requests</SubmitButton>
          </div>
        </div>
      </Card>
    </form>
  );
}
