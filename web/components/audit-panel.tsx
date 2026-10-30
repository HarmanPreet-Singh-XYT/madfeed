"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { reviewAuditAction } from "@/app/(app)/w/[workspaceId]/quality/actions";
import { FormError } from "./form-message";
import { link } from "./ui";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AuditItem = {
  id: string;
  kind: "answer" | "brief";
  heading: string;
  text: string;
  gone: boolean;
  verdict?: "supported" | "not_supported";
  note?: string;
  quotes: {
    text: string;
    sourceItemId: string;
    spanStart: number;
    spanEnd: number;
  }[];
};

export function AuditPanel({
  workspaceId,
  items,
}: {
  workspaceId: string;
  items: AuditItem[];
}) {
  if (items.length === 0)
    return (
      <p className="text-muted-foreground">
        Nothing to check yet. Each week a few of the answers and briefs the
        assistant has given appear here, so you can see whether the quotes
        really back them up.
      </p>
    );
  return (
    <ul className="space-y-4">
      {items.map((it) => (
        <Row key={it.id} workspaceId={workspaceId} it={it} />
      ))}
    </ul>
  );
}

function Row({ workspaceId, it }: { workspaceId: string; it: AuditItem }) {
  const [verdict, setVerdict] = useState(it.verdict);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function judge(v: "supported" | "not_supported") {
    setError(undefined);
    start(async () => {
      const r = await reviewAuditAction(workspaceId, it.id, v, note);
      if (r.error) setError(r.error);
      else setVerdict(v);
    });
  }

  return (
    <Card
      asChild
      className="[--card-spacing:0px] space-y-3 p-5"
      aria-label={`${it.kind === "answer" ? "Answer" : "Brief"} to check: ${it.heading}`}
    >
      <li>
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {it.kind === "answer" ? "An answer to:" : "A decision brief"}{" "}
            {it.kind === "answer" ? <strong>{it.heading}</strong> : null}
          </p>
          <Badge
            variant={
              verdict === "supported"
                ? "tint-teal"
                : verdict === "not_supported"
                  ? "tint-coral"
                  : "muted"
            }
          >
            {verdict === "supported"
              ? "Supported"
              : verdict === "not_supported"
                ? "Not supported"
                : "Waiting"}
          </Badge>
        </div>
        {it.gone ? (
          <p className="text-sm text-muted-foreground">
            This has since been deleted, so there is nothing to check.
          </p>
        ) : (
          <>
            <p className="leading-7">{it.text}</p>
            <div>
              <p className="text-sm font-medium">The quotes it relies on</p>
              <ul className="mt-1 space-y-2 text-sm">
                {it.quotes.map((q, i) => (
                  <li key={i} className="border-l-4 border-border pl-3">
                    “{q.text}”{" "}
                    <Link
                      href={`/w/${workspaceId}/sources/${q.sourceItemId}?s=${q.spanStart}&e=${q.spanEnd}#quote`}
                      className={link}
                    >
                      See it in the conversation
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        {verdict ? (
          <p role="status" className="text-sm">
            Checked:{" "}
            <strong>
              {verdict === "supported"
                ? "the quotes support it"
                : "the quotes do not support it"}
            </strong>
            {it.note ? ` — ${it.note}` : ""}
          </p>
        ) : !it.gone ? (
          <div className="space-y-3">
            <div>
              <Label
                htmlFor={`note-${it.id}`}
                className="mb-1 block text-sm font-medium"
              >
                What was wrong, if anything (optional)
              </Label>
              <Input
                id={`note-${it.id}`}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => judge("supported")}
              >
                <Check aria-hidden="true" className="size-4" />
                The quotes support it
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => judge("not_supported")}
              >
                <X aria-hidden="true" className="size-4" />
                The quotes do not support it
              </Button>
            </div>
            <FormError message={error} />
          </div>
        ) : null}
      </li>
    </Card>
  );
}
