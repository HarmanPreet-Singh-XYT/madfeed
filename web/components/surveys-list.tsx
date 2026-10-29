"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, Copy, Search } from "lucide-react";
import {
  closeSurveyAction,
  deleteSurveyAction,
  duplicateSurveyAction,
  loadOlderSurveysAction,
} from "@/app/(app)/w/[workspaceId]/surveys/actions";
import type { components } from "@/lib/api/schema.gen";
import { plural } from "@/lib/format";
import { LocalTime } from "./local-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormError } from "./form-message";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Survey = components["schemas"]["SurveyRow"];
type Filter = "all" | "draft" | "open" | "closed";

const STATE: Record<
  Survey["state"],
  { label: string; variant: "tint-amber" | "tint-teal" | "muted"; dot: string }
> = {
  draft: { label: "Draft", variant: "tint-amber", dot: "bg-hue-amber" },
  open: { label: "Open", variant: "tint-teal", dot: "bg-hue-teal" },
  closed: { label: "Closed", variant: "muted", dot: "bg-muted-foreground" },
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "draft", label: "Draft" },
  { id: "closed", label: "Closed" },
];

type Sort = "newest" | "oldest" | "answers";

const SORT_LABEL: Record<Sort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  answers: "Most answers",
};

const matches = (s: Survey, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || s.title.toLowerCase().includes(q);
};

export function SurveysList({
  workspaceId,
  surveys,
  nextCursor,
  canWrite,
  isAdmin,
}: {
  workspaceId: string;
  surveys: Survey[];
  nextCursor?: string;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  // Older pages are appended here; a new first page from the server clears them.
  const signature = surveys
    .map((s) => `${s.id}:${s.state}:${s.title}:${s.responses}:${s.questions}`)
    .join("|");
  const [seen, setSeen] = useState(signature);
  const [extra, setExtra] = useState<Survey[]>([]);
  const [cursor, setCursor] = useState(nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  if (signature !== seen) {
    setSeen(signature);
    setExtra([]);
    setCursor(nextCursor);
  }
  const all = useMemo(() => {
    const ids = new Set(surveys.map((s) => s.id));
    return [...surveys, ...extra.filter((s) => !ids.has(s.id))];
  }, [surveys, extra]);

  async function loadOlder() {
    if (!cursor || loadingMore) return;
    setLoadError(undefined);
    setLoadingMore(true);
    try {
      const r = await loadOlderSurveysAction(workspaceId, cursor);
      if (r.error) {
        setLoadError(r.error);
        return;
      }
      setExtra((prev) => [...prev, ...r.surveys]);
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

  function bulkClose() {
    const ids = all
      .filter((s) => selected.has(s.id) && s.state === "open")
      .map((s) => s.id);
    if (ids.length === 0) return;
    start(async () => {
      let failed = 0;
      for (const id of ids) {
        const r = await closeSurveyAction(workspaceId, id);
        if (r?.error) failed++;
      }
      if (failed > 0) toast.error(`${failed} could not be closed.`);
      else
        toast.success(
          `Closed ${ids.length === 1 ? "1 survey" : `${ids.length} surveys`}.`,
        );
      setSelected(new Set());
      router.refresh();
    });
  }

  function bulkDelete() {
    const ids = [...selected];
    setConfirmDelete(false);
    start(async () => {
      let failed = 0;
      for (const id of ids) {
        const r = await deleteSurveyAction(workspaceId, id);
        if (r?.error) failed++;
      }
      if (failed > 0) toast.error(`${failed} could not be deleted.`);
      else
        toast.success(
          `Deleted ${ids.length === 1 ? "1 survey" : `${ids.length} surveys`}.`,
        );
      setSelected(new Set());
      router.refresh();
    });
  }

  function duplicate(id: string) {
    start(async () => {
      const r = await duplicateSurveyAction(workspaceId, id);
      if (r.error || !r.id) {
        toast.error(r.error ?? "Could not duplicate this survey.");
        return;
      }
      toast.success("Duplicated as a new draft.");
      router.push(`/w/${workspaceId}/surveys/${r.id}`);
    });
  }

  // "/" jumps to search, as on the other libraries.
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

  const counts = useMemo(
    () => ({
      draft: all.filter((s) => s.state === "draft").length,
      open: all.filter((s) => s.state === "open").length,
      closed: all.filter((s) => s.state === "closed").length,
    }),
    [all],
  );

  const shown = all.filter(
    (s) => (filter === "all" || s.state === filter) && matches(s, query),
  );

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
            placeholder="Search surveys"
            aria-label="Search surveys"
            aria-keyshortcuts="/"
            className="pl-9"
          />
        </div>
        <div
          role="group"
          aria-label="Filter surveys"
          className="flex w-full flex-wrap items-center gap-1 sm:w-auto"
        >
          {FILTERS.map((f) => {
            const n = f.id === "all" ? all.length : counts[f.id];
            return (
              <Button
                key={f.id}
                type="button"
                size="sm"
                variant={filter === f.id ? "secondary" : "ghost"}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {n}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="ml-auto w-full sm:w-44">
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger aria-label="Sort surveys" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABEL) as Sort[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SORT_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected.size > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary px-3 py-2 text-sm"
        >
          <span className="font-medium tabular-nums">
            {selected.size === 1
              ? "1 survey selected"
              : `${selected.size} surveys selected`}
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
              disabled={
                pending ||
                !surveys.some((s) => selected.has(s.id) && s.state === "open")
              }
              onClick={bulkClose}
            >
              Close
            </Button>
            {isAdmin ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <Card className="[--card-spacing:0px] px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing matches
            {query.trim() ? ` “${query.trim()}”` : " this filter"}.
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
            {canWrite ? (
              <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2">
                <Checkbox
                  aria-label={
                    selected.size === shown.length && shown.length > 0
                      ? "Clear selection of all surveys"
                      : "Select all surveys"
                  }
                  checked={shown.length > 0 && selected.size === shown.length}
                  onCheckedChange={(v) =>
                    setSelected(
                      v === true ? new Set(shown.map((s) => s.id)) : new Set(),
                    )
                  }
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {shown.length > 0 && selected.size === shown.length
                    ? "Clear selection"
                    : "Select all"}
                </span>
              </div>
            ) : null}
            <ul className="divide-y divide-border">
              {shown.map((s) => {
                const tone = STATE[s.state];
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-start gap-x-3 gap-y-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    {canWrite ? (
                      <Checkbox
                        aria-label={`Select ${s.title}`}
                        checked={selected.has(s.id)}
                        onCheckedChange={() => toggle(s.id)}
                        className="mt-1 shrink-0"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          href={`/w/${workspaceId}/surveys/${s.id}`}
                          className="truncate font-medium underline-offset-2 hover:underline"
                        >
                          {s.title}
                        </Link>
                        <Badge variant={tone.variant} className="gap-1.5">
                          <span
                            aria-hidden="true"
                            className={`size-1.5 rounded-full ${tone.dot}`}
                          />
                          {tone.label}
                        </Badge>
                      </div>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>
                          {s.delivery === "open"
                            ? "One public link"
                            : "Personal links"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {s.questions === 0
                            ? "No questions yet"
                            : plural(s.questions, "question")}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Started <LocalTime iso={s.createdAt} />
                        </span>
                        {s.delivery === "invited" && s.invitesSent > 0 ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{s.invitesSent} sent</span>
                            {s.responses > 0 ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>
                                  {Math.round(
                                    (s.responses * 100) / s.invitesSent,
                                  )}
                                  % replied
                                </span>
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </p>
                    </div>

                    <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end sm:gap-4">
                      <div className="text-left sm:text-right">
                        <p className="text-lg font-semibold tabular-nums">
                          {s.responses}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.partial > 0
                            ? `${plural(s.partial, "start")} unfinished`
                            : s.responses === 1
                              ? "answer"
                              : "answers"}
                        </p>
                      </div>
                      {s.state === "draft" ? (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/w/${workspaceId}/surveys/${s.id}`}>
                            Finish setup
                            <ArrowRight
                              aria-hidden="true"
                              className="size-3.5"
                            />
                          </Link>
                        </Button>
                      ) : (
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/w/${workspaceId}/surveys/${s.id}/results`}
                          >
                            Results
                            <ArrowRight
                              aria-hidden="true"
                              className="size-3.5"
                            />
                          </Link>
                        </Button>
                      )}
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Duplicate ${s.title}`}
                          title={`Duplicate ${s.title}`}
                          disabled={pending}
                          onClick={() => duplicate(s.id)}
                          className="shrink-0 text-muted-foreground"
                        >
                          <Copy aria-hidden="true" className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
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
            {loadingMore ? "Loading…" : "Load older surveys"}
          </Button>
          <FormError message={loadError} />
        </div>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{" "}
              {selected.size === 1 ? "1 survey" : `${selected.size} surveys`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each survey goes with its invitations and answers. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep them</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                bulkDelete();
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
