"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  deleteMediaAction,
  type MediaInfo,
} from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { clock, fileSize } from "@/lib/format";
import { FormError } from "./form-message";
import { RecordingUpload } from "./recording-upload";
import { btn, card, link } from "./ui";

const STATE: Record<string, string> = {
  uploading: "Upload not finished",
  uploaded: "Waiting to be transcribed",
  transcribing: "Writing the transcript…",
  done: "Transcript ready",
  failed: "Couldn't be transcribed",
};

export function RecordingsList({
  workspaceId,
  items,
  people,
  canEdit,
}: {
  workspaceId: string;
  items: MediaInfo[];
  people: { id: string; name: string }[];
  canEdit: boolean;
}) {
  return (
    <ul className="space-y-3">
      {items.map((m) => (
        <Row
          key={m.id}
          workspaceId={workspaceId}
          m={m}
          people={people}
          canEdit={canEdit}
        />
      ))}
    </ul>
  );
}

function Row({
  workspaceId,
  m,
  people,
  canEdit,
}: {
  workspaceId: string;
  m: MediaInfo;
  people: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [resuming, setResuming] = useState(false);

  function remove() {
    setError(undefined);
    start(async () => {
      const r = await deleteMediaAction(workspaceId, m.id);
      if (r.error) setError(r.error);
    });
  }
  return (
    <li className={`${card} space-y-2`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{m.filename}</span>
        <span className="text-sm text-muted">
          {fileSize(m.sizeBytes)}
          {m.durationMs ? ` · ${clock(m.durationMs)}` : ""} ·{" "}
          {new Date(m.createdAt).toLocaleDateString()}
        </span>
      </div>
      <p className="text-sm" role={m.state === "failed" ? "alert" : undefined}>
        <strong>{STATE[m.state]}</strong>
        {m.state === "uploading"
          ? ` — ${fileSize(m.receivedBytes)} of ${fileSize(m.sizeBytes)} received`
          : ""}
        {m.state === "failed" && m.failureReason ? `: ${m.failureReason}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {m.state === "done" && m.sourceItemId ? (
          <Link
            href={`/w/${workspaceId}/sources/${m.sourceItemId}`}
            className={link}
          >
            Open the transcript and recording
          </Link>
        ) : null}
        {m.state === "uploading" && canEdit ? (
          <button
            type="button"
            className={btn}
            onClick={() => setResuming((v) => !v)}
            aria-expanded={resuming}
          >
            Continue this upload
          </button>
        ) : null}
        {canEdit && !confirming ? (
          <button
            type="button"
            className={btn}
            onClick={() => setConfirming(true)}
          >
            Delete {m.filename}
          </button>
        ) : null}
      </div>
      {confirming ? (
        <div
          role="group"
          aria-label={`Confirm deleting ${m.filename}`}
          className="space-y-3 rounded-md border border-border bg-background p-4"
        >
          <p className="text-sm">
            Delete this recording
            {m.sourceItemId
              ? ", its transcript and every quote, highlight and tag built on it"
              : ""}
            ? The file is removed from storage and this can&apos;t be undone.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={remove}
            >
              {pending ? "Deleting…" : "Yes, delete it"}
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      {resuming ? (
        <RecordingUpload
          workspaceId={workspaceId}
          people={people}
          resume={m}
          onDone={() => setResuming(false)}
        />
      ) : null}
      <FormError message={error} />
    </li>
  );
}
