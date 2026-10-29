"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { Check, Link2, Search } from "lucide-react";
import { toast } from "sonner";
import {
  publishNoteAction,
  saveNoteAction,
  unpublishNoteAction,
  unscheduleNoteAction,
} from "@/app/(app)/w/[workspaceId]/releases/actions";
import type { components } from "@/lib/api/schema.gen";
import { browserTimeZone, instantToLocal } from "@/lib/time";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { link } from "./ui";
import { NoteStatus } from "./note-status";
import { LocalTime } from "./local-time";
import { SchedulePicker } from "./schedule-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

type Note = components["schemas"]["ReleaseNote"];

const noSubscribe = () => () => {};

/** The next occurrence of `hour`:00 in the viewer's zone, used for the two quick schedule presets. */
function nextAt(hour: number, timeZone: string, weekday?: number): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(hour);
  if (d.getTime() < Date.now() + 60_000) d.setDate(d.getDate() + 1);
  if (weekday !== undefined) {
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  }
  return instantToLocal(d, timeZone);
}

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const quietField =
  "border-transparent bg-transparent shadow-none hover:border-border focus-visible:border-border";

export function ReleaseEditor({
  workspaceId,
  note,
  requests,
  publicPath,
  canEdit,
}: {
  workspaceId: string;
  note: Note;
  requests: { id: string; title: string; people: number }[];
  publicPath?: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saveState, save] = useActionState(
    saveNoteAction.bind(null, workspaceId, note.id),
    undefined,
  );
  const [dirty, setDirty] = useState(false);
  const [body, setBody] = useState(note.body);
  const [selected, setSelected] = useState(
    () => new Set(note.requests.map((r) => r.id)),
  );
  const [message, setMessage] = useState<{ error?: string; notice?: string }>();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  // Null until the person edits the field; until then it shows the note's own time in their zone.
  const [editedWhen, setEditedWhen] = useState<string | null>(null);

  // Times are shown and entered in the viewer's own time zone, which only the browser knows.
  const zone = useSyncExternalStore(noSubscribe, browserTimeZone, () => "UTC");

  const when =
    editedWhen ??
    (note.state === "scheduled" && note.scheduledFor
      ? instantToLocal(new Date(note.scheduledFor), zone)
      : "");

  // Leaving with unsaved changes asks first. Not a hard block: the browser owns this dialog.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Checkboxes are never unmounted by the filter: an unmounted box would submit nothing and quietly
  // remove that link on the next save. The filter only hides rows.
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (title: string) => !needle || title.toLowerCase().includes(needle);
  }, [q]);
  const shownCount = requests.filter((r) => matches(r.title)).length;
  const chosenPeople = requests
    .filter((r) => selected.has(r.id))
    .reduce((n, r) => n + r.people, 0);

  function run(fn: () => Promise<{ error?: string; notice?: string }>) {
    setMessage(undefined);
    start(async () => {
      const r = await fn();
      setMessage(r);
      if (r.error) toast.error(r.error);
      else {
        if (r.notice) toast.success(r.notice);
        router.refresh();
      }
    });
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setDirty(true);
  }

  async function copyLink() {
    if (!publicPath) return;
    try {
      await navigator.clipboard.writeText(
        new URL(publicPath, window.location.origin).toString(),
      );
      toast.success("Public link copied.");
    } catch {
      toast.error("Could not copy the link.");
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <form
          id="note-form"
          action={save}
          onInput={() => setDirty(true)}
          className="space-y-4"
        >
          <Card className="[--card-spacing:0px] overflow-hidden">
            <div className="space-y-3 px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Label htmlFor="body" className="text-sm font-medium">
                  What changed
                </Label>
                <div className="w-32">
                  <Label
                    htmlFor="type"
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                  >
                    Kind
                  </Label>
                  <Select
                    name="type"
                    defaultValue={note.type}
                    disabled={!canEdit}
                    onValueChange={() => setDirty(true)}
                  >
                    <SelectTrigger id="type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="improved">Improved</SelectItem>
                      <SelectItem value="fixed">Fixed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="max-w-[72ch]">
                <Textarea
                  id="body"
                  name="body"
                  defaultValue={note.body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={20000}
                  disabled={!canEdit}
                  placeholder="What changed, in the words customers will read. A blank line starts a new paragraph."
                  aria-describedby="body-help"
                  className={cn(
                    "min-h-72 resize-y px-0 text-base leading-7",
                    quietField,
                  )}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <p id="body-help">
                    Plain text, no customer names. This is public once
                    published.
                  </p>
                  <p className="tabular-nums">{plural(words(body), "word")}</p>
                </div>
              </div>
            </div>

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/30 px-5 py-3 sm:px-6">
                <p
                  role="status"
                  aria-live="polite"
                  className="text-sm text-muted-foreground"
                >
                  {dirty ? (
                    "Unsaved changes"
                  ) : (
                    <>
                      Saved · last edited{" "}
                      <LocalTime iso={note.updatedAt} time relative />
                    </>
                  )}
                </p>
                <FormError message={saveState?.error} />
                <div className="ml-auto">
                  <SubmitButton pendingLabel="Saving…" disabled={!dirty}>
                    Save
                  </SubmitButton>
                </div>
              </div>
            ) : null}
          </Card>
        </form>

        {requests.length > 0 ? (
          <Card asChild className="[--card-spacing:0px] overflow-hidden">
            <fieldset>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                <legend className="text-sm font-medium">
                  Requests this closes
                </legend>
                <p className="text-xs text-muted-foreground">
                  {selected.size} of {requests.length} chosen
                  {chosenPeople > 0
                    ? ` · ${plural(chosenPeople, "person", "people")} behind them`
                    : ""}
                </p>
              </div>
              <div className="space-y-2 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Only your team sees these links. They also let the messages to
                  the people who asked mention this note.
                </p>
                <div className="relative">
                  <label htmlFor="req-q" className="sr-only">
                    Find a request
                  </label>
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="req-q"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Find among ${plural(requests.length, "request")}`}
                    className="pl-8"
                  />
                </div>
                <ul className="-mx-2 max-h-72 space-y-0.5 overflow-y-auto">
                  {requests.map((r) => (
                    <li key={r.id} hidden={!matches(r.title)}>
                      <div className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/50">
                        <Checkbox
                          id={`request-${r.id}`}
                          name="requestIds"
                          form="note-form"
                          value={r.id}
                          checked={selected.has(r.id)}
                          disabled={!canEdit}
                          onCheckedChange={(v) => toggle(r.id, v === true)}
                        />
                        <Label
                          htmlFor={`request-${r.id}`}
                          className="min-h-9 min-w-0 flex-1 truncate font-normal"
                        >
                          {r.title}
                        </Label>
                        {r.people > 0 ? (
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {plural(r.people, "person", "people")}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                  {shownCount === 0 ? (
                    <li className="px-2 py-3 text-sm text-muted-foreground">
                      No request title contains “{q}”.
                    </li>
                  ) : null}
                </ul>
              </div>
            </fieldset>
          </Card>
        ) : null}
      </div>

      <aside className="space-y-4">
        <Card className="[--card-spacing:0px] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 id="publish-h" className="text-sm font-medium">
              Publishing
            </h2>
            <NoteStatus state={note.state} />
          </div>

          <div className="space-y-3 px-4 py-4">
            {note.state === "scheduled" && note.scheduledFor ? (
              <p className="text-sm">
                Goes live{" "}
                <LocalTime iso={note.scheduledFor} time relative />
              </p>
            ) : null}

            {note.liveNow && publicPath ? (
              <div className="space-y-1.5">
                <Link href={publicPath} className={cn(link, "text-sm")}>
                  View the public page
                </Link>
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={copyLink}
                  >
                    <Link2 aria-hidden="true" />
                    Copy public link
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Only your team can see this until it is published.
              </p>
            )}

            {!publicPath ? (
              <p className="rounded-lg bg-tint-amber p-2.5 text-xs">
                No public address yet, so a published note has nowhere to appear.
                Set one in Settings.
              </p>
            ) : null}

            {canEdit && note.state === "scheduled" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() => unscheduleNoteAction(workspaceId, note.id))
                  }
                >
                  Cancel schedule
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() => unpublishNoteAction(workspaceId, note.id))
                  }
                >
                  Take it down
                </Button>
              </div>
            ) : null}

            {canEdit && note.state !== "published" ? (
              <div className="space-y-2.5 border-t border-border pt-3">
                <Label
                  id="when-label"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  {note.state === "scheduled"
                    ? "Change the time"
                    : "Or publish at"}
                </Label>
                <SchedulePicker
                  value={when}
                  onChange={setEditedWhen}
                  zone={zone}
                  label={
                    note.state === "scheduled"
                      ? "Change the time"
                      : "Or publish at"
                  }
                />
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditedWhen(nextAt(9, zone))}
                  >
                    Tomorrow 9:00
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditedWhen(nextAt(9, zone, 1))}
                  >
                    Next Monday 9:00
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={pending || !when}
                  onClick={() =>
                    run(() =>
                      publishNoteAction(workspaceId, note.id, {
                        local: when,
                        timeZone: zone,
                      }),
                    )
                  }
                >
                  {note.state === "scheduled"
                    ? "Change the schedule"
                    : "Schedule"}
                </Button>
              </div>
            ) : null}

            {canEdit && note.state === "published" ? (
              <p className="text-xs text-muted-foreground">
                It is live. Saving changes the public page straight away.
              </p>
            ) : null}

            <FormError message={message?.error} />
            {message?.notice ? (
              <p
                role="status"
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <Check aria-hidden="true" className="size-4" />
                {message.notice}
              </p>
            ) : null}
          </div>

          <dl className="space-y-1.5 border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3">
              <dt>Created</dt>
              <dd>
                <LocalTime iso={note.createdAt} time />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Last edited</dt>
              <dd>
                <LocalTime iso={note.updatedAt} time relative />
              </dd>
            </div>
            {note.publishedAt ? (
              <div className="flex justify-between gap-3">
                <dt>First published</dt>
                <dd>
                  <LocalTime iso={note.publishedAt} time />
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt>Closes</dt>
              <dd>{plural(note.requests.length, "request")}</dd>
            </div>
          </dl>
        </Card>
      </aside>
    </div>
  );
}
