"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  CopyPlus,
  FileDown,
  History,
  Link2,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  autosaveFindingAction,
  deleteFindingAction,
  duplicateFindingAction,
  findQuotesAction,
  listFindingVersionsAction,
  restoreFindingVersionAction,
  publishFindingAction,
  saveFindingAction,
  unpublishFindingAction,
  type BlockDraft,
  type FindingVersion,
  type FoundQuote,
} from "@/app/(app)/w/[workspaceId]/findings/actions";
import { ConfirmDelete } from "./confirm-delete";
import { FormError } from "./form-message";
import { LocalTime } from "./local-time";
import { link } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { plural } from "@/lib/format";

export type EditorBlock =
  | { key: string; kind: "text"; body: string }
  | { key: string; kind: "heading"; body: string }
  | {
      key: string;
      kind: "quote";
      body: string;
      id?: string; // the saved card
      quoteKind?: "evidence" | "highlight";
      quoteId?: string;
      removed: boolean;
      quote: string;
      sourceTitle: string;
      sourceItemId?: string;
      requestTitle?: string;
    };

let counter = 0;
const nextKey = () => `n${++counter}`;

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function FindingEditor({
  workspaceId,
  docId,
  title: initialTitle,
  state,
  publicLink,
  updatedAt,
  publishedAt,
  shareExpiresAt,
  passwordProtected,
  initial,
  canWrite,
  isAdmin,
}: {
  workspaceId: string;
  docId: string;
  title: string;
  state: "draft" | "published";
  publicLink?: string;
  updatedAt: string;
  publishedAt?: string;
  shareExpiresAt?: string;
  passwordProtected?: boolean;
  initial: EditorBlock[];
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [blocks, setBlocks] = useState(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false); // changes not saved yet
  const [saving, setSaving] = useState(false);
  const version = useRef(0);
  const [found, setFound] = useState<FoundQuote[]>();
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [password, setPassword] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<FindingVersion[]>();
  const [historyError, setHistoryError] = useState<string>();
  const [mode, setMode] = useState<"read" | "write">(
    state === "published" || !canWrite ? "read" : "write",
  );
  const [pending, start] = useTransition();
  const published = state === "published";
  const editable = canWrite && !published;
  const currentTitle = title.trim() || "Untitled document";
  const removedCount = blocks.filter(
    (b) => b.kind === "quote" && b.removed,
  ).length;
  const textBlocks = blocks.filter((b) => b.kind === "text").length;
  const quoteBlocks = blocks.filter((b) => b.kind === "quote").length;
  const headings = blocks.filter(
    (b) => b.kind === "heading" && b.body.trim() !== "",
  );
  const words = blocks.reduce(
    (n, b) =>
      n +
      (b.kind === "quote"
        ? (b.body.trim().split(/\s+/).filter(Boolean).length ?? 0) +
          b.quote.trim().split(/\s+/).filter(Boolean).length
        : b.body.trim().split(/\s+/).filter(Boolean).length),
    0,
  );
  const minutes = Math.max(1, Math.ceil(words / 200));

  const change = (next: EditorBlock[]) => {
    version.current += 1;
    setSaved(false);
    setDirty(true);
    setBlocks(next);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const toDraft = (): BlockDraft[] =>
    blocks.map((b) =>
      b.kind === "quote"
        ? {
            kind: "quote",
            body: b.body,
            ...(b.id ? { id: b.id } : {}),
            ...(!b.id && b.quoteKind && b.quoteId
              ? { quoteKind: b.quoteKind, quoteId: b.quoteId }
              : {}),
          }
        : { kind: b.kind, body: b.body },
    );
  const run = (
    fn: () => Promise<{ error?: string } | undefined>,
    ok?: () => void,
  ) =>
    start(async () => {
      const r = await fn();
      setError(r?.error);
      if (!r?.error) ok?.();
    });

  const save = () =>
    run(
      () => saveFindingAction(workspaceId, docId, title, toDraft()),
      () => {
        setSaved(true);
        setDirty(false);
        setError(undefined);
      },
    );

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error("Could not copy. Select the text and copy it yourself.");
    }
  }

  function asMarkdown() {
    const lines = [`# ${currentTitle}`, ""];
    for (const b of blocks) {
      if (b.kind === "heading") {
        if (b.body.trim()) lines.push(`## ${b.body.trim()}`, "");
        continue;
      }
      if (b.kind === "text") {
        if (b.body.trim()) lines.push(b.body.trim(), "");
        continue;
      }
      if (b.removed) continue;
      lines.push(
        b.quote
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      );
      lines.push(">", `> — ${b.sourceTitle || "a source"}`);
      if (b.body.trim()) lines.push("", b.body.trim());
      lines.push("");
    }
    return lines.join("\n").trim() + "\n";
  }

  function printDocument() {
    const body = blocks
      .filter((b) => !(b.kind === "quote" && b.removed))
      .map((b) =>
        b.kind === "heading"
          ? `<h2>${escapeHtml(b.body)}</h2>`
          : b.kind === "text"
            ? `<p>${escapeHtml(b.body).replace(/\n/g, "<br>")}</p>`
            : `<figure><blockquote>“${escapeHtml(b.quote)}”</blockquote>${
                b.body.trim()
                  ? `<figcaption>${escapeHtml(b.body)}</figcaption>`
                  : ""
              }<p class="source">From ${escapeHtml(b.sourceTitle || "a source")}</p></figure>`,
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      currentTitle,
    )}</title><style>
      @page { margin: 22mm; }
      body { font: 16px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; max-width: 44rem; margin: 0 auto; }
      h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 .4rem; }
      h2 { font-size: 1.35rem; line-height: 1.3; margin: 2rem 0 .6rem; break-after: avoid; }
      .meta { color: #666; font-size: .85rem; margin-bottom: 2rem; }
      p { margin: 0 0 1.1rem; white-space: normal; }
      figure { margin: 0 0 1.4rem; padding: .2rem 0 .2rem 1rem; border-left: 4px solid #0b57a4; }
      blockquote { margin: 0; font-size: 1.15rem; line-height: 1.6; }
      figcaption { margin-top: .5rem; color: #555; font-size: .9rem; }
      .source { margin: .5rem 0 0; color: #777; font-size: .8rem; }
      @media print { a { color: inherit; text-decoration: none; } }
    </style></head><body><h1>${escapeHtml(currentTitle)}</h1><p class="meta">${
      published && publishedAt
        ? `Shared ${new Date(publishedAt).toLocaleDateString()}`
        : "Findings"
    }</p>${body}</body></html>`;
    const url = URL.createObjectURL(
      new Blob([html], { type: "text/html;charset=utf-8" }),
    );
    const win = window.open(url, "_blank", "width=900,height=1000");
    if (!win) {
      URL.revokeObjectURL(url);
      toast.error("Allow pop-ups to print this document.");
      return;
    }
    let printed = false;
    const go = () => {
      if (printed) return;
      printed = true;
      win.focus();
      win.print();
      URL.revokeObjectURL(url);
    };
    win.addEventListener("load", go, { once: true });
    window.setTimeout(go, 1200);
  }

  function downloadMarkdown() {
    const url = URL.createObjectURL(
      new Blob([asMarkdown()], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${
      currentTitle
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "findings"
    }.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function find() {
    start(async () => {
      const r = await findQuotesAction(workspaceId, search);
      setError(r.error);
      setFound(r.quotes);
    });
  }

  function openHistory() {
    setHistoryOpen(true);
    setVersions(undefined);
    setHistoryError(undefined);
    start(async () => {
      const r = await listFindingVersionsAction(workspaceId, docId);
      setHistoryError(r.error);
      setVersions(r.versions ?? []);
    });
  }

  function restoreVersion(versionId: string) {
    setHistoryError(undefined);
    start(async () => {
      const r = await restoreFindingVersionAction(
        workspaceId,
        docId,
        versionId,
      );
      if (r?.error) {
        setHistoryError(r.error);
        return;
      }
      setHistoryOpen(false);
      window.location.reload();
    });
  }

  function duplicate() {
    setError(undefined);
    start(async () => {
      const r = await duplicateFindingAction(workspaceId, docId);
      if (r?.error) setError(r.error);
    });
  }

  useEffect(() => {
    if (!editable || !dirty || !title.trim()) return;
    const at = version.current;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      const payload = blocks.map((b) =>
        b.kind === "quote"
          ? {
              kind: "quote" as const,
              body: b.body,
              ...(b.id ? { id: b.id } : {}),
              ...(!b.id && b.quoteKind && b.quoteId
                ? { quoteKind: b.quoteKind, quoteId: b.quoteId }
                : {}),
            }
          : { kind: b.kind, body: b.body },
      );
      const r = await autosaveFindingAction(workspaceId, docId, title, payload);
      setSaving(false);
      if (cancelled) return;
      if (r?.error) {
        setError(r.error);
        return;
      }
      if (at === version.current) {
        setError(undefined);
        setSaved(true);
        setDirty(false);
      }
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [title, blocks, editable, dirty, workspaceId, docId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && editable && !pending) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={published ? "tint-teal" : "muted"}
            className="h-6 px-2.5"
          >
            {published ? "Shared by link" : "Draft"}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {plural(blocks.length, "block")} · {textBlocks} text · {quoteBlocks}{" "}
            quote{quoteBlocks === 1 ? "" : "s"} · {headings.length} heading
            {headings.length === 1 ? "" : "s"} · {words} words · {minutes} min
            read · changed <LocalTime iso={updatedAt} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <div
              role="group"
              aria-label="View"
              className="flex rounded-lg bg-secondary p-1"
            >
              <Button
                type="button"
                size="sm"
                variant={mode === "write" ? "secondary" : "ghost"}
                aria-pressed={mode === "write"}
                onClick={() => setMode("write")}
              >
                Write
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "read" ? "secondary" : "ghost"}
                aria-pressed={mode === "read"}
                onClick={() => setMode("read")}
              >
                Read
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copyText(asMarkdown(), "Markdown copied")}
          >
            <Copy aria-hidden="true" />
            Copy Markdown
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={downloadMarkdown}
          >
            <FileDown aria-hidden="true" />
            Download .md
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={printDocument}
          >
            <Printer aria-hidden="true" />
            Print / PDF
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openHistory}
          >
            <History aria-hidden="true" />
            History
          </Button>
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={duplicate}
            >
              <CopyPlus aria-hidden="true" />
              Duplicate
            </Button>
          ) : null}
        </div>
      </div>

      {published ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-tint-amber p-3 text-sm"
        >
          This document is shared by link, so it cannot be edited. What the link
          shows must not change without anyone confirming it.{" "}
          {isAdmin
            ? "Take it down in Sharing to edit it, then publish it again."
            : "An admin can take it down if it needs a change."}
        </p>
      ) : null}

      {mode === "read" || !editable ? (
        <article className="space-y-6">
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {editable
                ? "Nothing here yet. Switch to Write to add a paragraph or a quote."
                : "This document is empty."}
            </p>
          ) : (
            <>
              {headings.length > 1 ? (
                <nav
                  aria-label="Contents"
                  className="max-w-[46rem] rounded-xl border border-border bg-muted/30 p-4"
                >
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Contents
                  </p>
                  <ol className="mt-2 space-y-1 text-sm">
                    {headings.map((h) => (
                      <li key={h.key}>
                        <a
                          href={`#section-${h.key}`}
                          className="text-link underline-offset-4 hover:underline"
                        >
                          {h.body}
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
              ) : null}
              <div className="max-w-[46rem] space-y-5">
                {blocks.map((b) =>
                  b.kind === "heading" ? (
                    <h2
                      key={b.key}
                      id={`section-${b.key}`}
                      className="scroll-mt-6 pt-4 font-display text-2xl font-bold tracking-tight"
                    >
                      {b.body}
                    </h2>
                  ) : b.kind === "text" ? (
                    <p
                      key={b.key}
                      className="whitespace-pre-wrap text-[1.0625rem] leading-8 text-foreground/90"
                    >
                      {b.body}
                    </p>
                  ) : b.removed ? (
                    <p key={b.key} className="text-sm text-muted-foreground">
                      A quote card here pointed at a quote that was deleted.
                    </p>
                  ) : (
                    <figure
                      key={b.key}
                      className="rounded-r-xl border-s-4 border-s-brand-2 bg-muted/40 py-4 pr-4 pl-5"
                    >
                      <blockquote className="text-lg leading-8">
                        “{b.quote}”
                      </blockquote>
                      {b.body.trim() ? (
                        <figcaption className="mt-3 text-sm text-muted-foreground">
                          {b.body}
                        </figcaption>
                      ) : null}
                      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>From {b.sourceTitle || "a source"}</span>
                        {b.requestTitle ? (
                          <span>· About “{b.requestTitle}”</span>
                        ) : null}
                        {b.sourceItemId ? (
                          <Link
                            href={`/w/${workspaceId}/sources/${b.sourceItemId}`}
                            className={link}
                          >
                            Open source
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className="text-link underline-offset-4 hover:underline"
                          onClick={() =>
                            void copyText(
                              `“${b.quote}” — ${b.sourceTitle || "a source"}`,
                              "Quote copied",
                            )
                          }
                        >
                          Copy quote
                        </button>
                      </div>
                    </figure>
                  ),
                )}
              </div>
            </>
          )}
        </article>
      ) : (
        <div className="space-y-5">
          <div>
            <Label
              id="doc-name-label"
              htmlFor="doc-name"
              className="mb-1 block text-sm font-medium"
            >
              Title
            </Label>
            <Input
              id="doc-name"
              value={title}
              maxLength={200}
              onChange={(e) => {
                setSaved(false);
                setDirty(true);
                setTitle(e.target.value);
              }}
            />
          </div>

          <ol className="space-y-4" aria-label="Document contents">
            {blocks.map((b, i) => (
              <li
                key={b.key}
                className="space-y-2 rounded-xl border border-border p-4"
              >
                {b.kind === "heading" ? (
                  <>
                    <Label
                      htmlFor={`b-${b.key}`}
                      className="block text-sm font-medium"
                    >
                      Heading
                    </Label>
                    <Input
                      id={`b-${b.key}`}
                      value={b.body}
                      maxLength={200}
                      onChange={(e) =>
                        change(
                          blocks.map((x, j) =>
                            j === i ? { ...b, body: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </>
                ) : b.kind === "text" ? (
                  <>
                    <Label
                      htmlFor={`b-${b.key}`}
                      className="block text-sm font-medium"
                    >
                      Paragraph
                    </Label>
                    <Textarea
                      id={`b-${b.key}`}
                      rows={4}
                      value={b.body}
                      maxLength={5000}
                      onChange={(e) =>
                        change(
                          blocks.map((x, j) =>
                            j === i ? { ...b, body: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </>
                ) : b.removed ? (
                  <p className="text-sm">
                    <strong>Quote removed.</strong>{" "}
                    <span className="text-muted-foreground">
                      The customer quote this card pointed at was deleted.
                    </span>
                  </p>
                ) : (
                  <>
                    <blockquote className="border-s-4 border-s-brand-2 pl-3 text-[1.0625rem] leading-7">
                      “{b.quote}”
                    </blockquote>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>From {b.sourceTitle || "a source"}</span>
                      {b.requestTitle ? (
                        <span>· About “{b.requestTitle}”</span>
                      ) : null}
                      {b.sourceItemId ? (
                        <Link
                          href={`/w/${workspaceId}/sources/${b.sourceItemId}`}
                          className={link}
                        >
                          Open source
                        </Link>
                      ) : null}
                    </div>
                    <Label
                      htmlFor={`b-${b.key}`}
                      className="block text-sm font-medium"
                    >
                      Your note under this quote (optional)
                    </Label>
                    <Input
                      id={`b-${b.key}`}
                      value={b.body}
                      maxLength={1000}
                      onChange={(e) =>
                        change(
                          blocks.map((x, j) =>
                            j === i ? { ...b, body: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </>
                )}
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`Move block ${i + 1} up`}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === blocks.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`Move block ${i + 1} down`}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => change(blocks.filter((_, j) => j !== i))}
                    aria-label={`Remove block ${i + 1}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Add a paragraph or a quote.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={blocks.length >= 200}
              onClick={() =>
                change([
                  ...blocks,
                  { key: nextKey(), kind: "heading", body: "" },
                ])
              }
            >
              <Plus aria-hidden="true" />
              Add a heading
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={blocks.length >= 200}
              onClick={() =>
                change([...blocks, { key: nextKey(), kind: "text", body: "" }])
              }
            >
              <Plus aria-hidden="true" />
              Add a paragraph
            </Button>
          </div>

          <div className="space-y-2 rounded-xl border border-border p-4">
            <Label
              id="quote-search-label"
              htmlFor="quote-search"
              className="block text-sm font-medium"
            >
              Add a quote: search what customers said
            </Label>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void find();
              }}
            >
              <Input
                id="quote-search"
                value={search}
                maxLength={200}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
                placeholder="a word or two, or leave empty for the newest"
              />
              <Button type="submit" variant="outline" disabled={pending}>
                Find quotes
              </Button>
            </form>
            {found ? (
              found.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No quotes match.
                </p>
              ) : (
                <ul
                  className="divide-y divide-border text-sm"
                  aria-label="Quotes found"
                >
                  {found.map((q) => (
                    <li
                      key={q.kind + q.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2"
                    >
                      <span>
                        “{q.text}”
                        <span className="block text-muted-foreground">
                          {q.sourceTitle}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          change([
                            ...blocks,
                            {
                              key: nextKey(),
                              kind: "quote",
                              body: "",
                              quoteKind: q.kind,
                              quoteId: q.id,
                              removed: false,
                              quote: q.text,
                              sourceTitle: q.sourceTitle,
                            },
                          ])
                        }
                      >
                        Add this quote
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </div>
      )}

      {removedCount > 0 ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-tint-amber p-3 text-sm"
        >
          {removedCount} {removedCount === 1 ? "card points" : "cards point"} at
          a quote that was deleted. {removedCount === 1 ? "It is" : "They are"}{" "}
          marked, and {removedCount === 1 ? "it" : "they"} must be removed
          before the document can be shared.
        </p>
      ) : null}

      <FormError message={error} />

      {editable && (dirty || saving) ? (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-card backdrop-blur">
          <p role="status" className="text-sm text-muted-foreground">
            {saving ? (
              "Saving…"
            ) : (
              <>
                Unsaved changes.{" "}
                <span className="hidden sm:inline">⌘S also saves.</span>
              </>
            )}
          </p>
          <Button type="button" onClick={save} disabled={pending || saving}>
            {pending ? "Saving…" : "Save the document"}
          </Button>
        </div>
      ) : null}

      {saved && !dirty ? (
        <p
          role="status"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Check aria-hidden="true" className="size-4 text-hue-teal" />
          Saved.
        </p>
      ) : null}

      {isAdmin ? (
        <section
          className="space-y-3 rounded-xl border border-border p-4"
          aria-labelledby="sharing-h"
        >
          <h2 id="sharing-h" className="text-lg font-medium">
            Sharing
          </h2>
          {published ? (
            <>
              <Label
                id="share-link-label"
                htmlFor="share-link"
                className="block text-sm font-medium"
              >
                Anyone with this link can read the document
              </Label>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge
                  variant={passwordProtected ? "tint-amber" : "muted"}
                  className="h-6 px-2.5"
                >
                  {passwordProtected ? "Password protected" : "No password"}
                </Badge>
                {shareExpiresAt ? (
                  <span>
                    Stops working <LocalTime iso={shareExpiresAt} time />
                  </span>
                ) : (
                  <span>No expiry</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="share-link"
                  readOnly
                  value={publicLink ?? ""}
                  className="min-w-0 flex-1 font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyText(publicLink ?? "", "Link copied")}
                >
                  <Link2 aria-hidden="true" />
                  Copy link
                </Button>
                {publicLink ? (
                  <Button asChild variant="outline">
                    <a href={publicLink} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </Button>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {publishedAt ? (
                  <>
                    Shared <LocalTime iso={publishedAt} time />.{" "}
                  </>
                ) : null}
                Taking it down stops the link at once, and it never works again,
                even if you publish the document again.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => unpublishFindingAction(workspaceId, docId))
                }
              >
                Take it down now
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                A shared document shows its title, paragraphs and the customers’
                words, exactly as stored. It shows no names, no source titles
                and nothing else from your workspace. Customers’ words can still
                name people or companies, so read each quote first.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label
                    htmlFor="share-expires"
                    className="mb-1 block text-sm font-medium"
                  >
                    Link expires (optional)
                  </Label>
                  <Input
                    id="share-expires"
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </div>
                <div>
                  <Label
                    htmlFor="share-password"
                    className="mb-1 block text-sm font-medium"
                  >
                    Password (optional)
                  </Label>
                  <Input
                    id="share-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    maxLength={200}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    At least 8 characters. Readers enter it once per visit.
                  </p>
                </div>
              </div>
              <Label
                id="finding-confirmed-label"
                htmlFor="finding-confirmed"
                className="flex items-start gap-2 text-sm"
              >
                <Checkbox
                  id="finding-confirmed"
                  className="mt-0.5"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                I have read every quote in this document and it is fine to
                share.
              </Label>
              <Button
                type="button"
                disabled={
                  pending ||
                  !confirmed ||
                  blocks.length === 0 ||
                  removedCount > 0 ||
                  dirty ||
                  saving ||
                  (password.length > 0 && password.length < 8)
                }
                onClick={() =>
                  run(
                    () =>
                      publishFindingAction(
                        workspaceId,
                        docId,
                        confirmed,
                        expiresAt || undefined,
                        password || undefined,
                      ),
                    () => {
                      setPassword("");
                      setExpiresAt("");
                    },
                  )
                }
              >
                Publish with a link
              </Button>
              {password.length > 0 && password.length < 8 ? (
                <p className="text-sm text-muted-foreground">
                  Use a password of at least 8 characters.
                </p>
              ) : null}
              {dirty ? (
                <p className="text-sm text-muted-foreground">
                  Save your changes before publishing.
                </p>
              ) : null}
            </>
          )}
          <div className="border-t border-border pt-4">
            <ConfirmDelete
              label="Delete this document"
              consequences="This moves the document to Recently deleted and ends its link. You can restore it from the list; the quotes themselves are not deleted."
              confirmLabel="Yes, delete the document"
              thenGo={`/w/${workspaceId}/findings?state=deleted`}
              action={async () =>
                (await deleteFindingAction(workspaceId, docId)) ?? {}
              }
            />
          </div>
        </section>
      ) : null}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>History</DialogTitle>
            <DialogDescription>
              A saved copy is kept at most once a minute, and the newest fifty
              are kept. Restoring saves the current state first, so it can be
              undone.
            </DialogDescription>
          </DialogHeader>
          {!editable ? (
            <p className="text-sm text-muted-foreground">
              Restore is available on a draft. Take the link down first to
              change this document.
            </p>
          ) : null}
          <FormError message={historyError} />
          {versions === undefined ? (
            <p className="text-sm text-muted-foreground">Loading versions…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved versions yet. One appears after the next save.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{v.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {plural(v.blocks, "block")} ·{" "}
                      <LocalTime iso={v.createdAt} time />
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || !editable}
                    onClick={() => restoreVersion(v.id)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
