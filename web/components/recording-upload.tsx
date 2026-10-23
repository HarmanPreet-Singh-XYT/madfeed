"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  completeUploadAction,
  deleteMediaAction,
  getMediaAction,
  startUploadAction,
  type MediaInfo,
} from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { fileSize } from "@/lib/format";
import { FormError } from "./form-message";
import { btn, field } from "./ui";

type Person = { id: string; name: string };

const ACCEPT =
  ".mp3,.wav,.m4a,.mp4,.ogg,.oga,.flac,.webm,audio/*,video/mp4,video/webm";
const TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

function mimeOf(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? file.type;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Uploads a recording in pieces. If the connection drops it asks the server
 * where it got to and carries on from there, so a long upload never starts
 * over. Pass `resume` to continue an unfinished upload with the same file.
 */
export function RecordingUpload({
  workspaceId,
  people,
  resume,
  onDone,
}: {
  workspaceId: string;
  people: Person[];
  resume?: MediaInfo;
  onDone?: () => void;
}) {
  // Until the page is interactive the picker would silently ignore a file, so it stays disabled.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [personId, setPersonId] = useState("");
  const [progress, setProgress] = useState<{ sent: number; total: number }>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);
  const current = useRef<string | undefined>(undefined);

  async function sendPieces(file: File, media: MediaInfo) {
    let sent = media.receivedBytes;
    const piece = media.chunkBytes;
    let failures = 0;
    while (sent < file.size) {
      if (cancelled.current) return false;
      const end = Math.min(sent + piece, file.size);
      let res: Response | undefined;
      try {
        res = await fetch(
          `/api/media/${workspaceId}/${media.id}/chunk?offset=${sent}`,
          { method: "PUT", body: file.slice(sent, end) },
        );
      } catch {
        res = undefined; // connection dropped
      }
      if (res?.ok) {
        failures = 0;
        sent = end;
        setProgress({ sent, total: file.size });
        continue;
      }
      if (res && res.status === 409) {
        // The server is at a different position (e.g. a piece arrived but its answer was lost).
        const now = await getMediaAction(workspaceId, media.id);
        if (now.media) {
          sent = now.media.receivedBytes;
          setProgress({ sent, total: file.size });
          continue;
        }
      }
      if (
        res &&
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 408 &&
        res.status !== 429
      ) {
        const body = (await res.json().catch(() => undefined)) as
          { error?: { message?: string } } | undefined;
        throw new Error(body?.error?.message ?? "The upload was refused.");
      }
      failures++;
      if (failures > 6)
        throw new Error(
          "The connection keeps dropping. Your progress is saved; choose the file again to continue.",
        );
      setStatus("Connection lost. Trying again…");
      await wait(Math.min(1000 * 2 ** failures, 15000));
      const now = await getMediaAction(workspaceId, media.id);
      if (now.media) sent = now.media.receivedBytes;
      setStatus(undefined);
    }
    return true;
  }

  async function start(file: File) {
    setError(undefined);
    setStatus(undefined);
    cancelled.current = false;
    setBusy(true);
    try {
      let media: MediaInfo;
      if (resume) {
        if (file.name !== resume.filename || file.size !== resume.sizeBytes) {
          setError(
            `Choose the same file to continue: ${resume.filename} (${fileSize(resume.sizeBytes)}).`,
          );
          return;
        }
        const now = await getMediaAction(workspaceId, resume.id);
        if (!now.media) {
          setError(now.error ?? "That upload is no longer available.");
          return;
        }
        media = now.media;
      } else {
        const begun = await startUploadAction(
          workspaceId,
          file.name,
          mimeOf(file),
          file.size,
          personId,
        );
        if (!begun.media) {
          setError(begun.error ?? "We couldn't start the upload.");
          return;
        }
        media = begun.media;
      }
      current.current = media.id;
      setProgress({ sent: media.receivedBytes, total: file.size });
      const finished = await sendPieces(file, media);
      if (!finished) return;
      setStatus("Finishing…");
      const done = await completeUploadAction(workspaceId, media.id);
      if (done.error) {
        setError(done.error);
        return;
      }
      setStatus(
        "Uploaded. We're writing out the transcript; this page updates by itself.",
      );
      setProgress(undefined);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    cancelled.current = true;
    if (current.current && !resume)
      await deleteMediaAction(workspaceId, current.current);
    setProgress(undefined);
    setStatus("Upload cancelled.");
    setBusy(false);
  }

  const inputId = resume ? `file-${resume.id}` : "recording-file";
  return (
    <div className="space-y-3">
      {!resume ? (
        <div>
          <label
            htmlFor="rec-person"
            className="mb-1 block text-sm font-medium"
          >
            Who is speaking? (optional)
          </label>
          <select
            id="rec-person"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            disabled={busy}
            className={field}
          >
            <option value="">Not sure, or more than one person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div>
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
          {resume
            ? `Choose ${resume.filename} again to continue`
            : "Recording file"}
        </label>
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          disabled={busy || !ready}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void start(f);
          }}
          className={`${field} file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1`}
        />
        <p className="mt-1 text-sm text-muted">
          MP3, WAV, M4A, MP4, OGG, FLAC or WebM, up to 1 GB. The transcription
          service accepts files up to 25 MB, so choose a compressed format such
          as MP3 or M4A for long recordings.
        </p>
      </div>
      {progress ? (
        <div className="space-y-2">
          <progress
            aria-label="Upload progress"
            className="h-3 w-full"
            max={progress.total}
            value={progress.sent}
          />
          <p className="text-sm text-muted" role="status">
            {fileSize(progress.sent)} of {fileSize(progress.total)}
          </p>
          <button type="button" className={btn} onClick={() => void cancel()}>
            Cancel upload
          </button>
        </div>
      ) : null}
      {status ? (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      ) : null}
      <FormError message={error} />
    </div>
  );
}
