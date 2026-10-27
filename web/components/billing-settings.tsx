"use client";

import { useState, useTransition } from "react";
import {
  openBillingPortalAction,
  startCheckoutAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary } from "./ui";
import { LocalTime } from "./local-time";

type Plan = {
  id: string;
  name: string;
  priceText: string;
  forSale: boolean;
  entitlements: {
    aiBudgetUsd: number;
    recordings: boolean;
    apiKeys: number;
    publicPages: boolean;
    digest: boolean;
    integrations: boolean;
  };
};

type Info = {
  enabled: boolean;
  plan: Plan;
  status: string;
  cancelAtPeriodEnd: boolean;
  periodEnd?: string;
  pastDueSince?: string;
  graceEndsAt?: string;
  canManage: boolean;
  activeApiKeys: number;
  plans: Plan[];
  events: { at: string; kind: string; summary: string }[];
};

function includes(p: Plan) {
  const e = p.entitlements;
  return [
    `Model allowance of $${e.aiBudgetUsd} a day`,
    e.recordings ? "Recordings and transcripts" : null,
    e.apiKeys > 0 ? `${e.apiKeys} API keys` : null,
    e.publicPages ? "Website form, public roadmap and votes" : null,
    e.digest ? "Weekly digest" : null,
    e.integrations ? "Slack and issue tracker connections" : null,
  ].filter(Boolean) as string[];
}

export function BillingSettings({
  workspaceId,
  info,
}: {
  workspaceId: string;
  info: Info;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (!info.enabled)
    return (
      <p className="text-muted-foreground">
        Billing isn&apos;t switched on for this server, so everything is
        included and nothing is charged.
      </p>
    );
  const limit = info.plan.entitlements.apiKeys;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p>
          You&apos;re on the <strong>{info.plan.name}</strong> plan
          {info.plan.priceText ? ` (${info.plan.priceText})` : ""}.
        </p>
        {info.status === "past_due" ? (
          <p
            role="status"
            className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
          >
            The last payment failed. Update your card under Manage billing
            {info.graceEndsAt ? (
              <>
                {" before "}
                <LocalTime iso={info.graceEndsAt} />
                {": after that the Free plan applies"}
              </>
            ) : null}
            . Nothing is deleted either way.
          </p>
        ) : null}
        {info.cancelAtPeriodEnd && info.periodEnd ? (
          <p role="status" className="text-sm text-muted-foreground">
            This plan ends on <LocalTime iso={info.periodEnd} />, then the Free
            plan applies.
          </p>
        ) : null}
        {info.status === "active" &&
        !info.cancelAtPeriodEnd &&
        info.periodEnd ? (
          <p className="text-sm text-muted-foreground">
            Renews on <LocalTime iso={info.periodEnd} />.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          API keys in use: {info.activeApiKeys}
          {limit > 0 ? ` of ${limit}` : " (none included)"}.
        </p>
      </div>

      <ul className="grid gap-3 md:grid-cols-3">
        {info.plans.map((p) => (
          <li
            key={p.id}
            className="space-y-2 rounded-md border border-border p-3"
            aria-current={p.id === info.plan.id ? "true" : undefined}
          >
            <h3 className="font-medium">
              {p.name}
              {p.id === info.plan.id ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  (current)
                </span>
              ) : null}
            </h3>
            <p className="text-sm">
              {p.priceText || (p.forSale ? "" : "Not for sale yet")}
            </p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {includes(p).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {p.id !== info.plan.id && p.forSale && !info.canManage ? (
              <button
                type="button"
                className={btnPrimary}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await startCheckoutAction(workspaceId, p.id);
                    setError(r?.error);
                  })
                }
              >
                Choose {p.name}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {info.canManage ? (
        <div className="space-y-1">
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await openBillingPortalAction(workspaceId);
                setError(r?.error);
              })
            }
          >
            Manage billing
          </button>
          <p className="text-sm text-muted-foreground">
            Change plan, update your card, read invoices or cancel.
          </p>
        </div>
      ) : null}
      <FormError message={error} />
      {info.events.length > 0 ? (
        <div className="space-y-1">
          <h3 className="font-medium">What happened</h3>
          <ul
            className="text-sm text-muted-foreground"
            aria-label="Billing history"
          >
            {info.events.map((e, i) => (
              <li key={i}>
                <LocalTime iso={e.at} /> · {e.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
