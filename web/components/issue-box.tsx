"use client";

import { useState, useTransition } from "react";
import {
  createIssueAction,
  resolveIssueAction,
  unlinkIssueAction,
} from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
import { FormError } from "./form-message";
import { link } from "./ui";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Issue = {
  label: string;
  repo: string;
  number: number;
  url: string;
  state: "open" | "closed" | "deleted";
  conflict: string;
};

export function IssueBox({
  workspaceId,
  requestId,
  issue,
  connected,
}: {
  workspaceId: string;
  requestId: string;
  issue?: Issue;
  connected: boolean;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      const r = await fn();
      setError(r?.error);
    });
  if (!issue && !connected) return null;
  return (
    <Card className="[--card-spacing:0px] space-y-2 p-5">
      <h2 className="text-lg font-medium">Issue</h2>
      {issue ? (
        <>
          <p className="text-sm">
            {/^https:\/\//i.test(issue.url) ? (
              <a href={issue.url} className={link} rel="noreferrer">
                {issue.label}
              </a>
            ) : (
              issue.label
            )}{" "}
            <span className="text-muted-foreground" id="issue-state">
              ({issue.state === "deleted" ? "no longer followed" : issue.state})
            </span>
          </p>
          {issue.conflict ? (
            <div
              role="status"
              className="space-y-2 rounded-xl border border-border p-3 text-sm"
            >
              <p>{issue.conflict}</p>
              {issue.state !== "deleted" ? (
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        resolveIssueAction(workspaceId, requestId, true),
                      )
                    }
                  >
                    Use the issue&apos;s change
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        resolveIssueAction(workspaceId, requestId, false),
                      )
                    }
                  >
                    Keep it as it is here
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => unlinkIssueAction(workspaceId, requestId))}
          >
            Stop following this issue
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Open an issue in your issue tracker for this request. It carries the
            title and counts only, never customer words.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => createIssueAction(workspaceId, requestId))}
          >
            Create an issue
          </Button>
        </>
      )}
      <FormError message={error} />
    </Card>
  );
}
