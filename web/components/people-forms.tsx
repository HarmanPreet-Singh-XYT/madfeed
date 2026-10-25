"use client";

import { useActionState } from "react";
import {
  createAccountAction,
  createPersonAction,
  updateAccountAction,
} from "@/app/(app)/w/[workspaceId]/people/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function AddPersonForm({
  workspaceId,
  accounts,
}: {
  workspaceId: string;
  accounts: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(
    createPersonAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="p-name" className="mb-1 block text-sm font-medium">
            Name
          </label>
          <input id="p-name" name="name" maxLength={200} className={field} />
        </div>
        <div>
          <label htmlFor="p-email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="p-email"
            name="email"
            type="email"
            maxLength={320}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="p-account" className="mb-1 block text-sm font-medium">
            Company
          </label>
          <select
            id="p-account"
            name="accountId"
            className={field}
            defaultValue=""
          >
            <option value="">(none)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <FormError message={state?.error} />
      <SubmitButton variant="plain" pendingLabel="Adding…">
        Add person
      </SubmitButton>
    </form>
  );
}

export function AddAccountForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(
    createAccountAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="a-name" className="mb-1 block text-sm font-medium">
            Company name
          </label>
          <input
            id="a-name"
            name="name"
            required
            maxLength={200}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="a-revenue" className="mb-1 block text-sm font-medium">
            Revenue <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="a-revenue"
            name="revenue"
            inputMode="decimal"
            placeholder="12000"
            className={field}
          />
        </div>
        <div>
          <label htmlFor="a-plan" className="mb-1 block text-sm font-medium">
            Plan <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input id="a-plan" name="plan" maxLength={100} className={field} />
        </div>
        <div>
          <label htmlFor="a-renewal" className="mb-1 block text-sm font-medium">
            Renewal date{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="a-renewal"
            name="renewalDate"
            type="date"
            className={field}
          />
        </div>
      </div>
      <FormError message={state?.error} />
      <SubmitButton variant="plain" pendingLabel="Adding…">
        Add company
      </SubmitButton>
    </form>
  );
}

export function EditAccountForm({
  workspaceId,
  account,
}: {
  workspaceId: string;
  account: {
    id: string;
    name: string;
    revenue?: string;
    plan?: string;
    renewalDate?: string;
    domain?: string;
  };
}) {
  const [state, action] = useActionState(
    updateAccountAction.bind(null, workspaceId, account.id),
    undefined,
  );
  const id = (k: string) => `${k}-${account.id}`;
  return (
    <form action={action} className="space-y-3 pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor={id("name")}
            className="mb-1 block text-sm font-medium"
          >
            Company name
          </label>
          <input
            id={id("name")}
            name="name"
            defaultValue={account.name}
            required
            maxLength={200}
            className={field}
          />
        </div>
        <div>
          <label
            htmlFor={id("revenue")}
            className="mb-1 block text-sm font-medium"
          >
            Revenue
          </label>
          <input
            id={id("revenue")}
            name="revenue"
            defaultValue={account.revenue}
            inputMode="decimal"
            className={field}
          />
        </div>
        <div>
          <label
            htmlFor={id("plan")}
            className="mb-1 block text-sm font-medium"
          >
            Plan
          </label>
          <input
            id={id("plan")}
            name="plan"
            defaultValue={account.plan}
            maxLength={100}
            className={field}
          />
        </div>
        <div>
          <label
            htmlFor={id("renewal")}
            className="mb-1 block text-sm font-medium"
          >
            Renewal date
          </label>
          <input
            id={id("renewal")}
            name="renewalDate"
            type="date"
            defaultValue={account.renewalDate}
            className={field}
          />
        </div>
      </div>
      <input type="hidden" name="domain" defaultValue={account.domain} />
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
