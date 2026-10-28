"use client";

import { useActionState, useState } from "react";
import {
  createAccountAction,
  createPersonAction,
  updateAccountAction,
} from "@/app/(app)/w/[workspaceId]/people/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A Radix Select cannot use an empty string as a value; this stands in for "no company". */
const ANY = "__any";

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
  const [accountId, setAccountId] = useState("");
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="p-name" className="mb-1 block text-sm font-medium">
            Name
          </label>
          <Input id="p-name" name="name" maxLength={200} />
        </div>
        <div>
          <label htmlFor="p-email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <Input id="p-email" name="email" type="email" maxLength={320} />
        </div>
        <div>
          <label htmlFor="p-account" className="mb-1 block text-sm font-medium">
            Company
          </label>
          <input type="hidden" name="accountId" value={accountId} />
          <Select
            value={accountId || ANY}
            onValueChange={(v) => setAccountId(v === ANY ? "" : v)}
          >
            <SelectTrigger id="p-account" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>(none)</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Input id="a-name" name="name" required maxLength={200} />
        </div>
        <div>
          <label htmlFor="a-revenue" className="mb-1 block text-sm font-medium">
            Revenue{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Input
            id="a-revenue"
            name="revenue"
            inputMode="decimal"
            placeholder="12000"
          />
        </div>
        <div>
          <label htmlFor="a-plan" className="mb-1 block text-sm font-medium">
            Plan{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Input id="a-plan" name="plan" maxLength={100} />
        </div>
        <div>
          <label htmlFor="a-renewal" className="mb-1 block text-sm font-medium">
            Renewal date{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Input id="a-renewal" name="renewalDate" type="date" />
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
          <Input
            id={id("name")}
            name="name"
            defaultValue={account.name}
            required
            maxLength={200}
          />
        </div>
        <div>
          <label
            htmlFor={id("revenue")}
            className="mb-1 block text-sm font-medium"
          >
            Revenue
          </label>
          <Input
            id={id("revenue")}
            name="revenue"
            defaultValue={account.revenue}
            inputMode="decimal"
          />
        </div>
        <div>
          <label
            htmlFor={id("plan")}
            className="mb-1 block text-sm font-medium"
          >
            Plan
          </label>
          <Input
            id={id("plan")}
            name="plan"
            defaultValue={account.plan}
            maxLength={100}
          />
        </div>
        <div>
          <label
            htmlFor={id("renewal")}
            className="mb-1 block text-sm font-medium"
          >
            Renewal date
          </label>
          <Input
            id={id("renewal")}
            name="renewalDate"
            type="date"
            defaultValue={account.renewalDate}
          />
        </div>
      </div>
      <input type="hidden" name="domain" defaultValue={account.domain} />
      <FormError message={state?.error} />
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
