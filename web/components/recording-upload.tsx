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
import { cn } from "@/lib/utils";
import { FormError } from "./form-message";
import { PersonCombobox } from "./person-combobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UploadCloud } from "lucide-react";

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
  const [dragging, setDragging] = useState(false);
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

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    if (busy || !ready) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void start(file);
  }

  const disabled = busy || !ready;
  const inputId = resume ? `file-${resume.id}` : "recording-file";
  const label = resume
    ? `Choose ${resume.filename} again to continue`
    : "Recording file";
  const percent = progress
    ? Math.round((progress.sent / progress.total) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {!resume ? (
        <div>
          <Label
            htmlFor="rec-person"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Who is speaking?
          </Label>
          <PersonCombobox
            id="rec-person"
            workspaceId={workspaceId}
            people={people.map((p) => ({ id: p.id, label: p.name }))}
            value={personId}
            onChange={setPersonId}
            noneLabel="Not sure, or more than one person"
            disabled={busy}
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-8 text-center transition-colors focus-within:ring-3 focus-within:ring-ring/20",
            dragging
              ? "border-primary bg-primary/5"
              : "border-input bg-muted/30 hover:bg-muted/60",
            disabled && "pointer-events-none opacity-60",
          )}
        >
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void start(file);
            }}
            className="sr-only"
          />
          <span className="sr-only">{label}</span>
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-full bg-card text-muted-foreground shadow-xs ring-1 ring-border"
          >
            <UploadCloud className="size-5" />
          </span>
          <span className="text-sm font-medium">
            {resume
              ? `Choose ${resume.filename} again to continue`
              : "Drag a recording here, or choose a file"}
          </span>
          <span className="text-xs text-muted-foreground">
            MP3, WAV, M4A, MP4, OGG, FLAC or WebM, up to 1 GB
          </span>
        </label>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        The transcription service accepts files up to 25 MB, so choose a
        compressed format such as MP3 or M4A for long recordings.
      </p>

      {progress ? (
        <div className="space-y-2">
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.sent}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span role="status">
              {fileSize(progress.sent)} of {fileSize(progress.total)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void cancel()}
            >
              Cancel upload
            </Button>
          </div>
        </div>
      ) : null}

      {status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}
      <FormError message={error} />
    </div>
  );
}
