"use client";

import { Check, Minus } from "lucide-react";
import { plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The last step before anything leaves: what will happen, checked off in plain words, and one clear action.
 * The confirmation dialog lives beside this card so the sticky bar can open the same one.
 */
export function OutreachApprove({
  ready,
  left = 0,
  opened,
  total,
  senderName,
  senderAddress,
  replyTo,
  onApprove,
  onCancel,
  approveDisabled = false,
  disabledReason,
}: {
  ready: number;
  /** People in this batch who won't get an email (left out, or asked not to be emailed). */
  left?: number;
  /** Messages the reviewer has opened this visit. */
  opened: number;
  total: number;
  senderName: string;
  senderAddress?: string;
  replyTo?: string;
  onApprove: () => void;
  onCancel: () => void;
  approveDisabled?: boolean;
  disabledReason?: string;
}) {
  const unseen = Math.max(total - opened, 0);

  const checks: { ok: boolean; text: string }[] = [
    {
      ok: ready > 0,
      text:
        ready > 0
          ? `${plural(ready, "person", "people")} will each get one email from ${senderName}${
              senderAddress ? ` <${senderAddress}>` : ""
            }.`
          : "Nobody is ready to send to yet. Include at least one person.",
    },
    {
      ok: true,
      text: "Each message is based on that person's own words, shown beside it.",
    },
    ...(replyTo
      ? [{ ok: true, text: `Replies go to ${replyTo}.` }]
      : []),
    {
      ok: true,
      text: "Anyone who asked not to be emailed is skipped automatically, and every email ends with a link to stop updates.",
    },
    {
      ok: left === 0,
      text:
        left === 0
          ? "Nobody has been left out."
          : `${plural(left, "person", "people")} will not be emailed.`,
    },
    {
      ok: unseen === 0,
      text:
        unseen === 0
          ? "You have opened every message."
          : `${unseen} of ${plural(total, "message")} not opened yet.`,
    },
  ];

  return (
    <Card asChild className="[--card-spacing:0px] p-0">
      <section aria-labelledby="approve-h" id="approve">
        <div className="border-b border-border px-5 py-3">
          <h2 id="approve-h" className="text-base font-semibold">
            Ready to send?
          </h2>
          <p className="text-sm text-muted-foreground">
            You can&apos;t recall an email once it is sent, so read them first.
          </p>
        </div>
        <ul className="divide-y divide-border px-5">
          {checks.map((c) => (
            <li key={c.text} className="flex items-start gap-3 py-3 text-sm">
              <span
                aria-hidden="true"
                className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full ${c.ok ? "bg-tint-teal text-hue-teal" : "bg-tint-amber text-hue-amber"}`}
              >
                {c.ok ? (
                  <Check className="size-3" />
                ) : (
                  <Minus className="size-3" />
                )}
              </span>
              <span>
                <span className="sr-only">{c.ok ? "OK: " : "Note: "}</span>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/50 px-5 py-3">
          <Button
            type="button"
            disabled={approveDisabled || ready === 0}
            onClick={onApprove}
            title={disabledReason}
          >
            Approve and send {plural(ready, "message")}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel this batch
          </Button>
          {disabledReason ? (
            <p className="text-xs text-muted-foreground">{disabledReason}</p>
          ) : null}
        </div>
      </section>
    </Card>
  );
}
