"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteMediaAction,
  loadOlderMediaAction,
  renameMediaAction,
  restoreMediaAction,
  retryMediaAction,
  type MediaInfo,
} from "@/app/(app)/w/[workspaceId]/recordings/actions";
import { clock, fileSize, plural } from "@/lib/format";
import { dayGroup, filterOf, matches } from "@/lib/recordings";
import { FormError } from "./form-message";
import { LocalTime } from "./local-time";
import { RecordingUpload } from "./recording-upload";
import { Download, FileAudio, Pencil, Search, Trash2 } from "lucide-react";
import { link } from "./ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATE: Record<string, string> = {
  uploading: "Upload not finished",
  uploaded: "Waiting to be transcribed",
  transcribing: "Writing the transcript…",
  done: "Transcript ready",
  failed: "Couldn't be transcribed",
};

const TONE: Record<string, string> = {
  done: "bg-tint-teal",
  uploaded: "bg-tint-amber",
  transcribing: "bg-tint-amber",
  failed: "bg-tint-coral",
  uploading: "bg-tint-blue",
};

const DOT: Record<string, string> = {
  done: "bg-hue-teal",
  uploaded: "bg-hue-amber",
  transcribing: "bg-hue-amber",
  failed: "bg-hue-coral",
  uploading: "bg-hue-blue",
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "done", label: "Ready" },
  { id: "processing", label: "Processing" },
  { id: "attention", label: "Needs attention" },
] as const;

type Filter = (typeof FILTERS)[number]["id"];

/** What a person calls this recording: the name they gave it, or the file. */
const nameOf = (m: MediaInfo) => m.title?.trim() || m.filename;

export function RecordingsList({
  workspaceId,
  items,
  nextCursor,
  people,
  canEdit,
}: {
  workspaceId: string;
  items: MediaInfo[];
  nextCursor?: string;
  people: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  // Older pages are appended here. When the server sends a new first page (a
  // rename, a delete, a finished upload), the extras go: they may be stale.
  const signature = items
    .map((m) => `${m.id}:${m.state}:${m.title ?? ""}`)
    .join("|");
  const [seen, setSeen] = useState(signature);
  const [extra, setExtra] = useState<MediaInfo[]>([]);
  const [cursor, setCursor] = useState(nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  if (signature !== seen) {
    setSeen(signature);
    setExtra([]);
    setCursor(nextCursor);
  }

  // "/" jumps to search, as it does in most tool-shaped apps; it stays out of the way while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const names = useMemo(
    () => new Map(people.map((p) => [p.id, p.name])),
    [people],
  );

  const all = useMemo(() => {
    const seenIDs = new Set(items.map((m) => m.id));
    return [...items, ...extra.filter((m) => !seenIDs.has(m.id))];
  }, [items, extra]);

  const shown = all.filter((m) => {
    if (filter !== "all" && filterOf(m) !== filter) return false;
    return matches(m, m.personId ? names.get(m.personId) : undefined, query);
  });

  const groups = new Map<string, MediaInfo[]>();
  for (const m of shown) {
    const key = dayGroup(m.createdAt);
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }

  async function loadOlder() {
    if (!cursor || loadingMore) return;
    setLoadError(undefined);
    setLoadingMore(true);
    try {
      const r = await loadOlderMediaAction(workspaceId, cursor, query);
      if (r.error) {
        setLoadError(r.error);
        return;
      }
      setExtra((prev) => [...prev, ...r.media]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deleteSelected() {
    const ids = [...selected];
    setConfirmBulk(false);
    start(async () => {
      let failed = 0;
      for (const id of ids) {
        const r = await deleteMediaAction(workspaceId, id);
        if (r.error) failed++;
      }
      setSelected(new Set());
      if (failed > 0)
        toast.error(
          `${plural(failed, "recording")} could not be deleted. Try again.`,
        );
      else
        toast.success(`Deleted ${plural(ids.length, "recording")}.`, {
          duration: 12_000,
          action: {
            label: "Undo",
            onClick: async () => {
              let missed = 0;
              for (const id of ids) {
                const r = await restoreMediaAction(workspaceId, id);
                if (r.error) missed++;
              }
              if (missed > 0) toast.error("Some could not be brought back.");
              else toast.success("Bringing them back.");
              router.refresh();
            },
          },
        });
      router.refresh();
    });
  }

  const allSelected = shown.length > 0 && selected.size === shown.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 sm:w-auto sm:max-w-xs sm:flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or person"
            aria-label="Search recordings"
            aria-keyshortcuts="/"
            className="pl-9"
          />
        </div>
        <div
          role="group"
          aria-label="Filter recordings"
          className="flex w-full flex-wrap items-center gap-1 sm:w-auto"
        >
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              type="button"
              size="sm"
              variant={filter === f.id ? "secondary" : "ghost"}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <p className="ml-auto text-xs text-muted-foreground tabular-nums">
          {shown.length === all.length
            ? plural(all.length, "recording")
            : `${shown.length} of ${plural(all.length, "recording")}`}
        </p>
      </div>

      {selected.size > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary px-3 py-2 text-sm"
        >
          <span className="font-medium tabular-nums">
            {plural(selected.size, "recording")} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmBulk(true)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <Card className="[--card-spacing:0px] px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing matches {query.trim() ? `“${query.trim()}”` : "this filter"}
            .
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Clear search and filters
          </Button>
        </Card>
      ) : (
        <Card asChild className="[--card-spacing:0px] overflow-hidden">
          <div>
            {canEdit ? (
              <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2">
                <Checkbox
                  aria-label={
                    allSelected
                      ? "Clear selection of all recordings"
                      : "Select all recordings"
                  }
                  checked={allSelected}
                  onCheckedChange={(v) =>
                    setSelected(
                      v === true ? new Set(shown.map((m) => m.id)) : new Set(),
                    )
                  }
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {allSelected ? "Clear selection" : "Select all"}
                </span>
              </div>
            ) : null}
            {[...groups.entries()].map(([label, list]) => (
              <section key={label} aria-label={label}>
                <h2 className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  {label}
                </h2>
                <ul className="divide-y divide-border">
                  {list.map((m) => (
                    <Row
                      key={m.id}
                      workspaceId={workspaceId}
                      m={m}
                      personName={
                        m.personId ? names.get(m.personId) : undefined
                      }
                      people={people}
                      canEdit={canEdit}
                      selected={selected.has(m.id)}
                      onToggle={() => toggle(m.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Card>
      )}

      {cursor ? (
        <div className="flex flex-col items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadOlder()}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load older recordings"}
          </Button>
          <FormError message={loadError} />
        </div>
      ) : null}

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {plural(selected.size, "recording")}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The files are removed, along with their transcripts and every
              quote, highlight and tag built on them. You have a few seconds to
              undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep them</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                deleteSelected();
              }}
            >
              {pending ? "Deleting…" : "Yes, delete them"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({
  workspaceId,
  m,
  personName,
  people,
  canEdit,
  selected,
  onToggle,
}: {
  workspaceId: string;
  m: MediaInfo;
  personName?: string;
  people: { id: string; name: string }[];
  canEdit: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = nameOf(m);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [resuming, setResuming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(m.title ?? "");
  const [renameError, setRenameError] = useState<string>();
  const [retrying, startRetry] = useTransition();
  const router = useRouter();

  function remove() {
    setError(undefined);
    start(async () => {
      const r = await deleteMediaAction(workspaceId, m.id);
      if (r.error) {
        setError(r.error);
        return;
      }
      setConfirming(false);
      toast.success(`Deleted ${name}.`, {
        duration: 12_000,
        action: {
          label: "Undo",
          onClick: async () => {
            const back = await restoreMediaAction(workspaceId, m.id);
            if (back.error) toast.error(back.error);
            else {
              toast.success("Brought back.");
              router.refresh();
            }
          },
        },
      });
      router.refresh();
    });
  }

  function saveName() {
    setRenameError(undefined);
    start(async () => {
      const r = await renameMediaAction(workspaceId, m.id, title);
      if (r.error) {
        setRenameError(r.error);
        return;
      }
      setRenaming(false);
      toast.success("Name saved.");
      router.refresh();
    });
  }

  function retry() {
    startRetry(async () => {
      const r = await retryMediaAction(workspaceId, m.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Trying the transcript again.");
      router.refresh();
    });
  }

  return (
    <li className="group flex gap-3 px-4 py-3">
      {canEdit ? (
        <Checkbox
          aria-label={`Select ${name}`}
          checked={selected}
          onCheckedChange={onToggle}
          className="mt-0.5 shrink-0"
        />
      ) : null}

      <span
        aria-hidden="true"
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground"
      >
        <FileAudio className="size-4" />
      </span>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="truncate font-medium">{name}</span>
          {m.title && m.title !== m.filename ? (
            <span className="truncate text-xs text-muted-foreground">
              {m.filename}
            </span>
          ) : null}
          {personName ? (
            <span className="text-xs text-muted-foreground">
              · {personName}
            </span>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums">
          <span>{fileSize(m.sizeBytes)}</span>
          {m.durationMs ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{clock(m.durationMs)}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <LocalTime iso={m.createdAt} />
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[m.state] ?? "bg-muted"}`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${DOT[m.state] ?? "bg-muted-foreground"}`}
            />
            {STATE[m.state]}
            {m.state === "uploading"
              ? ` — ${fileSize(m.receivedBytes)} of ${fileSize(m.sizeBytes)} received`
              : ""}
          </span>
          {m.state === "failed" && m.failureReason ? (
            <span role="alert" className="text-xs text-muted-foreground">
              {m.failureReason}
            </span>
          ) : null}
          {m.state === "done" && m.sourceItemId ? (
            <Link
              href={`/w/${workspaceId}/sources/${m.sourceItemId}`}
              className={link}
            >
              Open the transcript and recording
            </Link>
          ) : null}
          {m.state === "failed" && canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={retry}
            >
              {retrying ? "Trying…" : "Try again"}
            </Button>
          ) : null}
          {m.state === "uploading" && canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setResuming((v) => !v)}
              aria-expanded={resuming}
            >
              Continue this upload
            </Button>
          ) : null}
        </div>

        {resuming ? (
          <RecordingUpload
            workspaceId={workspaceId}
            people={people}
            resume={m}
            onDone={() => setResuming(false)}
          />
        ) : null}
      </div>

      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Rename ${name}`}
          title={`Rename ${name}`}
          className="shrink-0 text-muted-foreground opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
          onClick={() => {
            setTitle(m.title ?? "");
            setRenameError(undefined);
            setRenaming(true);
          }}
        >
          <Pencil aria-hidden="true" className="size-4" />
        </Button>
      ) : null}

      {m.state !== "uploading" ? (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <a
            href={`/api/media/${workspaceId}/${m.id}/file`}
            download
            aria-label={`Download ${name}`}
            title={`Download ${name}`}
          >
            <Download aria-hidden="true" className="size-4" />
          </a>
        </Button>
      ) : null}

      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Delete ${name}`}
          title={`Delete ${name}`}
          className="shrink-0 text-muted-foreground opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive pointer-coarse:opacity-100"
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this recording
              {m.sourceItemId
                ? ", its transcript and every quote, highlight and tag built on it"
                : ""}
              ? The file is removed. You have a few seconds to undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormError message={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
            >
              {pending ? "Deleting…" : "Yes, delete it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename recording</DialogTitle>
            <DialogDescription>
              The name is shown here and on its transcript. The file keeps its
              original name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`rename-${m.id}`}>Name</Label>
            <Input
              id={`rename-${m.id}`}
              value={title}
              maxLength={200}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim() && !pending) saveName();
              }}
            />
            <FormError message={renameError} />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenaming(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveName}
              disabled={pending || !title.trim()}
            >
              {pending ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
