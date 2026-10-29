"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpRight,
  CircleCheck,
  ExternalLink,
  GripVertical,
  Inbox,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import type { components } from "@/lib/api/schema.gen";
import { formatValue, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  moveRoadmapCard,
  reorderRoadmap,
} from "@/app/(app)/w/[workspaceId]/roadmap/actions";
import { StatusPill } from "@/components/app/status-pill";
import { TagChip } from "@/components/tag-picker";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Summary = components["schemas"]["RequestSummary"];
type Status = components["schemas"]["Status"];
type Bucket = "open" | "active" | "done";

const ANY = "__any";

const COLUMNS: {
  bucket: Bucket;
  title: string;
  dot: string;
  icon: typeof Inbox;
  empty: string;
}[] = [
  {
    bucket: "open",
    title: "New",
    dot: "bg-hue-blue",
    icon: Inbox,
    empty: "Nothing new to triage.",
  },
  {
    bucket: "active",
    title: "In progress",
    dot: "bg-hue-amber",
    icon: LoaderCircle,
    empty: "Nothing in progress right now.",
  },
  {
    bucket: "done",
    title: "Shipped",
    dot: "bg-hue-teal",
    icon: CircleCheck,
    empty: "Nothing shipped yet.",
  },
];

type Sort = "manual" | "value" | "people" | "newest" | "title";

function valueOf(r: Summary) {
  return Number(r.impact.totalValue) || 0;
}

function meta(r: Summary) {
  return `${plural(r.impact.peopleCount, "person", "people")} · ${plural(
    r.impact.accountCount,
    "account",
  )}`;
}

function ranksOf(list: Summary[]) {
  const out: Record<string, number> = {};
  for (const r of list)
    if (r.roadmapPosition != null) out[r.id] = r.roadmapPosition;
  return out;
}

/**
 * The roadmap board. Cards can be dragged between stages or up and down within
 * one; the Move menu does the same from the keyboard. Every drop is saved, not
 * just painted, and moving into Shipped asks first because it starts drafts.
 */
export function RoadmapBoard({
  workspaceId,
  requests,
  publicHref,
  statuses,
  canEdit,
}: {
  workspaceId: string;
  requests: Summary[];
  publicHref?: string;
  statuses: Status[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Summary[]>(requests);
  const [ranks, setRanks] = useState<Record<string, number>>(() =>
    ranksOf(requests),
  );
  const [q, setQ] = useState("");
  const [tagId, setTagId] = useState("");
  const [sort, setSort] = useState<Sort>("manual");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ bucket: Bucket; index: number } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<{
    id: string;
    toBucket: Bucket;
    toIndex: number;
  } | null>(null);
  const [, start] = useTransition();

  // Follow new server data (a refresh after a move) without remounting.
  const signature = requests
    .map((r) => `${r.id}:${r.status.id}:${r.roadmapPosition ?? ""}`)
    .join("|");
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setItems(requests);
    setRanks(ranksOf(requests));
  }

  const defaultStatus = useMemo(() => {
    const map: Partial<Record<Bucket, Status>> = {};
    for (const s of [...statuses].sort((a, b) => a.position - b.position)) {
      if (s.bucket === "open" || s.bucket === "active" || s.bucket === "done") {
        if (!map[s.bucket]) map[s.bucket] = s;
      }
    }
    return map;
  }, [statuses]);

  const tags = useMemo(() => {
    const seenTags = new Map<
      string,
      { id: string; name: string; color: string }
    >();
    for (const r of requests)
      for (const t of r.tags) if (!seenTags.has(t.id)) seenTags.set(t.id, t);
    return [...seenTags.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [requests]);

  const filtered = Boolean(q.trim() || tagId);
  const canDrag = canEdit && !filtered;

  const matches = (r: Summary) => {
    const needle = q.trim().toLowerCase();
    return (
      (!needle || r.title.toLowerCase().includes(needle)) &&
      (!tagId || r.tags.some((t) => t.id === tagId))
    );
  };

  const rankOf = (r: Summary) => ranks[r.id] ?? r.roadmapPosition ?? null;

  function compare(a: Summary, b: Summary) {
    switch (sort) {
      case "manual": {
        const ra = rankOf(a);
        const rb = rankOf(b);
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return valueOf(b) - valueOf(a);
      }
      case "people":
        return b.impact.peopleCount - a.impact.peopleCount;
      case "newest":
        return b.createdAt.localeCompare(a.createdAt);
      case "title":
        return a.title.localeCompare(b.title);
      default:
        return valueOf(b) - valueOf(a);
    }
  }

  function displayed(bucket: Bucket) {
    return items
      .filter((r) => r.status.bucket === bucket && matches(r))
      .sort(compare);
  }

  function perform(id: string, toBucket: Bucket, toIndex: number) {
    const item = items.find((r) => r.id === id);
    if (!item) return;
    const fromBucket = item.status.bucket as Bucket;
    const target = defaultStatus[toBucket];
    if (toBucket !== fromBucket && !target) {
      toast.error("That stage has no status to move into yet.");
      return;
    }

    const beforeItems = items;
    const beforeRanks = ranks;

    const targetIds = displayed(toBucket)
      .filter((r) => r.id !== id)
      .map((r) => r.id);
    targetIds.splice(Math.min(Math.max(toIndex, 0), targetIds.length), 0, id);
    const nextRanks: Record<string, number> = { ...ranks };
    targetIds.forEach((rid, i) => (nextRanks[rid] = i));

    const nextItems =
      toBucket !== fromBucket && target
        ? items.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: {
                    id: target.id,
                    name: target.name,
                    bucket: target.bucket,
                  },
                }
              : r,
          )
        : items;

    setItems(nextItems);
    setRanks(nextRanks);
    setSort("manual");

    start(async () => {
      if (toBucket !== fromBucket && target) {
        const moved = await moveRoadmapCard(workspaceId, id, target.id);
        if (moved.error) {
          setItems(beforeItems);
          setRanks(beforeRanks);
          toast.error(moved.error);
          return;
        }
        if (moved.notice)
          toast.success(moved.notice, {
            action: moved.batchId
              ? {
                  label: "Review drafts",
                  onClick: () =>
                    router.push(`/w/${workspaceId}/outreach/${moved.batchId}`),
                }
              : undefined,
          });
      }
      const saved = await reorderRoadmap(workspaceId, targetIds);
      if (saved.error) {
        setItems(beforeItems);
        setRanks(beforeRanks);
        toast.error(saved.error);
        return;
      }
      router.refresh();
    });
  }

  function requestMove(id: string, toBucket: Bucket, toIndex: number) {
    const item = items.find((r) => r.id === id);
    if (!item) return;
    if (toBucket === "done" && item.status.bucket !== "done") {
      setConfirm({ id, toBucket, toIndex });
      return;
    }
    perform(id, toBucket, toIndex);
  }

  function onDragStart(e: React.DragEvent, id: string) {
    if (!canDrag) {
      e.preventDefault();
      return;
    }
    setDragging(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function onCardDragOver(
    e: React.DragEvent<HTMLDivElement>,
    bucket: Bucket,
    index: number,
  ) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setOver({ bucket, index: index + (after ? 1 : 0) });
  }

  function onColumnDragOver(e: React.DragEvent, bucket: Bucket) {
    if (!dragging) return;
    e.preventDefault();
    setOver({ bucket, index: displayed(bucket).length });
  }

  function onDrop(e: React.DragEvent, bucket: Bucket) {
    e.preventDefault();
    const id = dragging;
    setDragging(null);
    const target =
      over?.bucket === bucket ? over.index : displayed(bucket).length;
    setOver(null);
    if (id) requestMove(id, bucket, target);
  }

  const closed = requests.filter((r) => r.status.bucket === "closed").length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 p-2.5">
          <div className="relative min-w-48 flex-1">
            <label htmlFor="roadmap-search" className="sr-only">
              Search requests
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="roadmap-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search requests"
              className="w-full bg-transparent pl-8"
            />
          </div>
          <Select
            value={tagId || ANY}
            onValueChange={(v) => setTagId(v === ANY ? "" : v)}
          >
            <SelectTrigger aria-label="Tag" className="w-40">
              <SelectValue placeholder="Any tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any tag</SelectItem>
              {tags.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger aria-label="Order by" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual order</SelectItem>
              <SelectItem value="value">Most revenue first</SelectItem>
              <SelectItem value="people">Most people first</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="title">Title A to Z</SelectItem>
            </SelectContent>
          </Select>
          {publicHref ? (
            <Button asChild variant="outline" size="sm">
              <a href={publicHref} target="_blank" rel="noreferrer">
                Public roadmap
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          ) : null}
        </div>
        {filtered ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-2.5 py-2 text-xs text-muted-foreground">
            <span>
              Showing {items.filter(matches).length} of {items.length}. Clear
              the filters to reorder.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setQ("");
                setTagId("");
              }}
            >
              <X aria-hidden="true" />
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((c) => {
          const list = displayed(c.bucket);
          const total = list.reduce((n, r) => n + valueOf(r), 0);
          const Icon = c.icon;
          return (
            <section
              key={c.bucket}
              aria-labelledby={`roadmap-${c.bucket}`}
              onDragOver={(e) => onColumnDragOver(e, c.bucket)}
              onDrop={(e) => onDrop(e, c.bucket)}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-muted/30"
            >
              <header className="flex items-center gap-2 border-b border-border bg-card px-3.5 py-3">
                <span
                  aria-hidden="true"
                  className={`size-2.5 rounded-full ${c.dot}`}
                />
                <h2
                  id={`roadmap-${c.bucket}`}
                  className="text-sm font-semibold"
                >
                  {c.title}
                </h2>
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                  {list.length}
                </span>
                {total > 0 ? (
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {formatValue(String(total))}
                  </span>
                ) : null}
              </header>

              <ul className="flex-1 space-y-2 p-2.5">
                {list.length === 0 ? (
                  <li className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input/50 px-4 py-8 text-center">
                    <Icon
                      aria-hidden="true"
                      className="size-5 text-muted-foreground/60"
                    />
                    <p className="text-xs text-muted-foreground">{c.empty}</p>
                    {canDrag ? (
                      <p className="text-[0.6875rem] text-muted-foreground">
                        Drag a card here
                      </p>
                    ) : null}
                  </li>
                ) : (
                  list.map((r, index) => (
                    <li key={r.id}>
                      {over?.bucket === c.bucket && over.index === index ? (
                        <div
                          aria-hidden="true"
                          className="mb-2 h-0.5 rounded-full bg-primary"
                        />
                      ) : null}
                      <div
                        draggable={canDrag}
                        onDragStart={(e) => onDragStart(e, r.id)}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        onDragOver={(e) => onCardDragOver(e, c.bucket, index)}
                        className={cn(
                          "group relative rounded-lg border border-border bg-card shadow-xs transition-all hover:border-ring/40 hover:shadow-card",
                          canDrag && "cursor-grab active:cursor-grabbing",
                          dragging === r.id && "opacity-50",
                        )}
                      >
                        <Link
                          href={`/w/${workspaceId}/requests/${r.id}`}
                          draggable={false}
                          className="block rounded-lg p-3 pr-8 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium leading-snug transition-colors group-hover:text-link">
                              {r.title}
                            </span>
                            <ArrowUpRight
                              aria-hidden="true"
                              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                            />
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-1.5">
                            <StatusPill
                              name={r.status.name}
                              bucket={r.status.bucket}
                            />
                            {r.tags.slice(0, 2).map((t) => (
                              <TagChip key={t.id} tag={t} />
                            ))}
                            {r.tags.length > 2 ? (
                              <span className="text-xs text-muted-foreground">
                                +{r.tags.length - 2}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{meta(r)}</span>
                            {r.impact.accountsWithValue > 0 ? (
                              <span className="font-semibold tabular-nums text-foreground">
                                {formatValue(r.impact.totalValue)}
                              </span>
                            ) : null}
                          </span>
                        </Link>

                        {canEdit ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Move ${r.title}`}
                                title="Move this card"
                                className="absolute top-1.5 right-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                              >
                                <GripVertical aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Order</DropdownMenuLabel>
                              <DropdownMenuItem
                                disabled={!canDrag || index === 0}
                                onSelect={() =>
                                  requestMove(r.id, c.bucket, index - 1)
                                }
                              >
                                Move up
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={!canDrag || index === list.length - 1}
                                onSelect={() =>
                                  requestMove(r.id, c.bucket, index + 1)
                                }
                              >
                                Move down
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {COLUMNS.filter((x) => x.bucket !== c.bucket).map(
                                (x) => (
                                  <DropdownMenuItem
                                    key={x.bucket}
                                    disabled={
                                      !canDrag || !defaultStatus[x.bucket]
                                    }
                                    onSelect={() =>
                                      requestMove(
                                        r.id,
                                        x.bucket,
                                        displayed(x.bucket).length,
                                      )
                                    }
                                  >
                                    Move to {x.title}
                                  </DropdownMenuItem>
                                ),
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </li>
                  ))
                )}
                {over?.bucket === c.bucket && over.index === list.length ? (
                  <li
                    aria-hidden="true"
                    className="h-0.5 rounded-full bg-primary"
                  />
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>

      {closed > 0 ? (
        <p className="text-xs text-muted-foreground">
          {plural(closed, "request")} marked “Won&apos;t do”{" "}
          {closed === 1 ? "is" : "are"} left off the roadmap.
        </p>
      ) : null}

      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to Shipped?</AlertDialogTitle>
            <AlertDialogDescription>
              Moving this request to shipped starts personal drafts for the
              people who asked. You review and approve every one before anything
              is sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it where it is</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm)
                  perform(confirm.id, confirm.toBucket, confirm.toIndex);
                setConfirm(null);
              }}
            >
              Move to Shipped
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
