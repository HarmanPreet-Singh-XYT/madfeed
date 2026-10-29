"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
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

/** The transcription provider refuses anything bigger, so we refuse it before a byte is sent. */
const MAX_BYTES = 25 * 1024 * 1024;

function mimeOf(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? file.type;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Uploads one or more recordings in pieces, one after another. If the
 * connection drops it asks the server where it got to and carries on from
 * there, so a long upload never starts over. Pass `resume` to continue an
 * unfinished upload with the same file.
 * `compact` is the same control as one line, for a page that already has
 * recordings and should not be dominated by a dropzone.
 */
export function RecordingUpload({
  workspaceId,
  people,
  resume,
  compact = false,
  onDone,
}: {
  workspaceId: string;
  people: Person[];
  resume?: MediaInfo;
  compact?: boolean;
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
  const [eta, setEta] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const cancelled = useRef(false);
  const current = useRef<string | undefined>(undefined);
  const startedAt = useRef<number>(0);

  /** Progress and its estimate move together, so a render never reads the clock or a ref. */
  function noteProgress(sent: number, total: number) {
    setProgress({ sent, total });
    setEta(estimateLeft({ sent, total }, startedAt.current));
  }

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
        noteProgress(sent, file.size);
        continue;
      }
      if (res && res.status === 409) {
        // The server is at a different position (e.g. a piece arrived but its answer was lost).
        const now = await getMediaAction(workspaceId, media.id);
        if (now.media) {
          sent = now.media.receivedBytes;
          noteProgress(sent, file.size);
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

  /** One file, from the first byte to a finished upload. The reason for a failure is shown above. */
  async function uploadOne(file: File): Promise<boolean> {
    try {
      let media: MediaInfo;
      if (resume) {
        if (file.name !== resume.filename || file.size !== resume.sizeBytes) {
          setError(
            `Choose the same file to continue: ${resume.filename} (${fileSize(resume.sizeBytes)}).`,
          );
          return false;
        }
        const now = await getMediaAction(workspaceId, resume.id);
        if (!now.media) {
          setError(now.error ?? "That upload is no longer available.");
          return false;
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
          return false;
        }
        media = begun.media;
      }
      current.current = media.id;
      noteProgress(media.receivedBytes, file.size);
      const finished = await sendPieces(file, media);
      if (!finished) return false;
      setStatus("Finishing…");
      const done = await completeUploadAction(workspaceId, media.id);
      if (done.error) {
        setError(done.error);
        return false;
      }
      setProgress(undefined);
      setEta(undefined);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed.");
      return false;
    }
  }

  /** Several files go up one after another, so a slow connection never has to carry them all at once. */
  async function start(files: File[]) {
    if (files.length === 0) return;
    setError(undefined);
    setStatus(undefined);
    setEta(undefined);

    if (!resume) {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          setError(
            `“${file.name}” is ${fileSize(file.size)}. The transcription service takes up to 25 MB, which is about 90 minutes as an MP3 or M4A. Compress it, or split it and add each part.`,
          );
          return;
        }
        if (!mimeOf(file)) {
          setError(
            `“${file.name}” is not a supported type. Use MP3, WAV, M4A, MP4, OGG, FLAC or WebM.`,
          );
          return;
        }
      }
    }

    cancelled.current = false;
    setBusy(true);
    let uploaded = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        if (cancelled.current) return;
        const file = files[i];
        startedAt.current = Date.now();
        setProgress(undefined);
        setEta(undefined);
        setStatus(
          files.length > 1
            ? `Uploading ${i + 1} of ${files.length}: ${file.name}`
            : undefined,
        );
        const ok = await uploadOne(file);
        if (cancelled.current) return;
        if (!ok) break;
        uploaded++;
      }
      if (uploaded > 0) {
        setStatus(
          "Uploaded. We're writing out the transcript; this page updates by itself.",
        );
        toast.success(
          uploaded === 1
            ? "Upload complete. We're writing the transcript."
            : `${uploaded} recordings uploaded. We're writing the transcripts.`,
        );
        onDone?.();
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    cancelled.current = true;
    if (current.current && !resume)
      await deleteMediaAction(workspaceId, current.current);
    setProgress(undefined);
    setEta(undefined);
    setStatus("Upload cancelled.");
    toast("Upload cancelled.");
    setBusy(false);
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    if (busy || !ready) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void start(files);
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
    <div className={cn(compact ? "space-y-2" : "space-y-4")}>
      {!resume ? (
        <div
          className={
            compact ? "flex flex-wrap items-center gap-x-2 gap-y-1" : undefined
          }
        >
          <Label
            htmlFor="rec-person"
            className={
              compact
                ? "text-xs font-medium text-muted-foreground"
                : "mb-1.5 block text-xs font-medium text-muted-foreground"
            }
          >
            Who is speaking?
          </Label>
          <div className={compact ? "w-full max-w-xs" : undefined}>
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
            "flex cursor-pointer border border-dashed transition-colors focus-within:ring-3 focus-within:ring-ring/20",
            compact
              ? "flex-row items-center gap-3 rounded-lg px-3 py-2.5"
              : "flex-col items-center justify-center gap-1.5 rounded-lg px-4 py-8 text-center",
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
            multiple={!resume}
            disabled={disabled}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void start(files);
            }}
            className="sr-only"
          />
          <span className="sr-only">{label}</span>
          <span
            aria-hidden="true"
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground shadow-xs ring-1 ring-border",
              compact ? "size-8" : "size-10",
            )}
          >
            <UploadCloud className={compact ? "size-4" : "size-5"} />
          </span>
          {compact ? (
            <>
              <span className="min-w-0 text-sm font-medium">
                {resume
                  ? `Choose ${resume.filename} again to continue`
                  : "Add recordings"}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                MP3, M4A, WAV, MP4, OGG, FLAC or WebM · up to 25 MB
              </span>
              <span className="ml-auto shrink-0 text-sm font-medium text-link">
                Choose file
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-medium">
                {resume
                  ? `Choose ${resume.filename} again to continue`
                  : "Drag recordings here, or choose files"}
              </span>
              <span className="text-xs text-muted-foreground">
                MP3, WAV, M4A, MP4, OGG, FLAC or WebM, up to 25 MB
              </span>
            </>
          )}
        </label>
      </div>

      {compact ? null : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Up to 25 MB, about 90 minutes as an MP3 or M4A. Longer calls need
          splitting.{" "}
          {!resume ? (
            <Link
              href={`/w/${workspaceId}/add`}
              className="text-link underline underline-offset-4"
            >
              Paste a transcript instead
            </Link>
          ) : null}
        </p>
      )}

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
            <span role="status" className="tabular-nums">
              {fileSize(progress.sent)} of {fileSize(progress.total)}
              {eta ? ` · about ${eta} left` : ""}
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

/** A rough "about 12 seconds left", from the bytes already sent and the time taken so far. */
function estimateLeft(
  progress: { sent: number; total: number },
  startedAt: number,
): string | undefined {
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed < 1 || progress.sent <= 0) return undefined;
  const perSecond = progress.sent / elapsed;
  if (perSecond <= 0) return undefined;
  const seconds = Math.round((progress.total - progress.sent) / perSecond);
  if (seconds < 1) return undefined;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}
