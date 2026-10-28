"use client";

import { useActionState, useRef, useState } from "react";
import { pasteAction } from "@/app/(app)/w/[workspaceId]/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// A made-up conversation so a new person can see the result without pasting
// anything real. Clearly labelled; it is not a real customer.
const SAMPLE = `Priya (Northwind Co): Thanks for making time. Overall the team likes the product.

Priya (Northwind Co): The biggest blocker for us is that we can't use single sign-on, so every new hire needs another password. We really need SSO before we can roll this out to the whole company.

Priya (Northwind Co): One more thing, when we export the monthly report the totals are sometimes wrong, and it takes us an hour to double check them by hand.

Support: Thanks Priya, I'll pass both of those on.`;

/** A Radix Select cannot use an empty string as a value; this stands in for "not sure". */
const ANY = "__any";

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
  const [personId, setPersonId] = useState("");
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
        <Textarea
          id="text"
          name="text"
          ref={textRef}
          rows={16}
          required
          maxLength={400000}
          className="min-h-72 resize-y font-mono text-sm leading-relaxed"
          placeholder="Paste a call transcript, a support thread or a chat…"
          aria-describedby="text-help"
        />
        <p id="text-help" className="text-sm text-muted-foreground">
          We pick out what customers asked for and show you each one next to the
          exact words they used. Nothing is created until you approve it.
        </p>
      </div>

      <aside className="space-y-4">
        <Card className="[--card-spacing:0px] space-y-3 p-4">
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
              <input type="hidden" name="personId" value={personId} />
              <Select
                value={personId || ANY}
                onValueChange={(v) => setPersonId(v === ANY ? "" : v)}
              >
                <SelectTrigger
                  id="personId"
                  className="w-full"
                  aria-describedby="person-help"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>
                    Not sure / more than one person
                  </SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Input id="title" name="title" ref={titleRef} maxLength={200} />
          </div>
          <div>
            <label
              htmlFor="originUrl"
              className="mb-1 block text-sm font-medium"
            >
              Link to the original
            </label>
            <Input
              id="originUrl"
              name="originUrl"
              type="url"
              inputMode="url"
              maxLength={2000}
              placeholder="https://…"
            />
          </div>
        </Card>
        <FormError message={state?.error} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingLabel="Sending…">Find requests</SubmitButton>
          <Button type="button" variant="outline" onClick={useSample}>
            Try a sample conversation
          </Button>
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
