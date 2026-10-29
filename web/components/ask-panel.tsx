"use client";

import Link from "next/link";
import { Fragment, useRef, useState, useTransition } from "react";
import {
  askAction,
  rateAction,
  type AnswerResult,
} from "@/app/(app)/w/[workspaceId]/research/actions";
import { FormError } from "./form-message";
import { LocalTime } from "./local-time";
import { link } from "./ui";
import {
  BarChart3,
  Check,
  Copy,
  MessageSquareQuote,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/app/empty-state";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Cite = {
  number: number;
  kind: string;
  id: string;
  sourceItemId: string;
  spanStart: number;
  spanEnd: number;
  quote: string;
};
export type AnswerView = {
  id: string;
  question: string;
  outcome: string;
  text: string;
  reason: string;
  rating?: string;
  citations: Cite[];
  createdAt: string;
};

/** Turns "[2]" markers in an answer into links to the quote they cite. */
function withCitations(answerId: string, text: string, cites: Cite[]) {
  const known = new Set(cites.map((c) => c.number));
  return text.split(/(\[\d{1,2}\])/).map((part, i) => {
    const m = /^\[(\d{1,2})\]$/.exec(part);
    if (m && known.has(Number(m[1]))) {
      return (
        <a
          key={i}
          href={`#cite-${answerId}-${m[1]}`}
          className="mx-0.5 align-super text-xs font-medium text-link underline"
          aria-label={`Source ${m[1]}`}
        >
          {m[1]}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function copyText(answer: AnswerView, workspaceId: string): string {
  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  const sources = answer.citations
    .map(
      (c) =>
        `${c.number}. “${c.quote}” — ${origin}/w/${workspaceId}/sources/${c.sourceItemId}?s=${c.spanStart}&e=${c.spanEnd}#quote`,
    )
    .join("\n");
  if (answer.outcome !== "answered") {
    return `Q: ${answer.question}\n\nNo evidence: ${answer.reason}`;
  }
  return `Q: ${answer.question}\n\n${answer.text}\n\nSources:\n${sources}`;
}

export function AnswerCard({
  workspaceId,
  answer,
  canRate = true,
}: {
  workspaceId: string;
  answer: AnswerView;
  canRate?: boolean;
}) {
  const [rating, setRating] = useState(answer.rating);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const answered = answer.outcome === "answered";

  function rate(r: "good" | "wrong") {
    setError(undefined);
    start(async () => {
      const res = await rateAction(workspaceId, answer.id, r);
      if (res.error) setError(res.error);
      else setRating(r);
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyText(answer, workspaceId));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the answer and copy it by hand.");
    }
  }

  return (
    <Card asChild className="[--card-spacing:0px] overflow-hidden">
      <article aria-label={`Answer to: ${answer.question}`}>
        <header className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border bg-muted/25 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-semibold text-balance">
              {answer.question}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Asked <LocalTime iso={answer.createdAt} relative />
            </p>
          </div>
          <Badge variant={answered ? "tint-teal" : "tint-amber"}>
            {answered ? "Answered" : "No evidence"}
          </Badge>
        </header>

        <div className="space-y-4 px-4 py-4">
          {answered ? (
            <p className="max-w-[72ch] leading-7">
              {withCitations(answer.id, answer.text, answer.citations)}
            </p>
          ) : (
            <div className="max-w-[72ch] space-y-1 rounded-lg bg-tint-amber px-3 py-2.5">
              <p className="text-sm font-medium">
                Not enough evidence to answer that.
              </p>
              <p className="text-sm text-muted-foreground">{answer.reason}</p>
              <p className="text-sm text-muted-foreground">
                Try a narrower question, or read the words yourself in{" "}
                <Link href={`/w/${workspaceId}/quotes`} className={link}>
                  Quotes
                </Link>
                .
              </p>
            </div>
          )}

          {answer.citations.length > 0 ? (
            <ol aria-label="Sources" className="space-y-2">
              {answer.citations.map((c) => (
                <li
                  key={c.number}
                  id={`cite-${answer.id}-${c.number}`}
                  className="flex gap-2 rounded-r-lg border-l-2 border-border bg-muted/40 py-2 pr-3 pl-3 text-sm"
                >
                  <span className="shrink-0 font-medium text-muted-foreground tabular-nums">
                    {c.number}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <blockquote className="leading-6 text-pretty">
                      “{c.quote}”
                    </blockquote>
                    <Link
                      href={`/w/${workspaceId}/sources/${c.sourceItemId}?s=${c.spanStart}&e=${c.spanEnd}#quote`}
                      className={cn(link, "text-xs")}
                    >
                      See it in the conversation
                    </Link>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 py-2">
          {canRate ? (
            <>
              <span className="text-xs text-muted-foreground">
                Was this right?
              </span>
              <Button
                type="button"
                variant={rating === "good" ? "secondary" : "ghost"}
                size="sm"
                disabled={pending}
                aria-pressed={rating === "good"}
                onClick={() => rate("good")}
              >
                <ThumbsUp aria-hidden="true" />
                Yes
              </Button>
              <Button
                type="button"
                variant={rating === "wrong" ? "secondary" : "ghost"}
                size="sm"
                disabled={pending}
                aria-pressed={rating === "wrong"}
                onClick={() => rate("wrong")}
              >
                <ThumbsDown aria-hidden="true" />
                No
              </Button>
              {rating ? (
                <span
                  role="status"
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                >
                  <Check aria-hidden="true" className="size-3.5" />
                  Thanks, noted.
                </span>
              ) : null}
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={copy}
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </footer>
        <FormError message={error} />
      </article>
    </Card>
  );
}

function PendingAnswer() {
  return (
    <Card className="[--card-spacing:0px] space-y-3 p-4" role="status">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles aria-hidden="true" className="size-4 animate-pulse" />
        Reading what customers said…
      </p>
      <div className="max-w-[72ch] space-y-2" aria-hidden="true">
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    </Card>
  );
}

export function AskPanel({
  workspaceId,
  enabled,
  history,
  suggestions,
}: {
  workspaceId: string;
  enabled: boolean;
  history: AnswerView[];
  suggestions: string[];
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AnswerResult>();
  const [pending, start] = useTransition();
  const [asked, setAsked] = useState<AnswerView[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || pending) return;
    start(async () => {
      const r = await askAction(workspaceId, question);
      setResult(r);
      if (r.answer) {
        setAsked((a) => [r.answer as AnswerView, ...a]);
        setQuestion("");
      }
    });
  }

  function trySuggestion(s: string) {
    setQuestion(s);
    box.current?.focus();
  }

  const shown = new Set(asked.map((a) => a.id));
  const earlier = history.filter((h) => !shown.has(h.id));
  const empty = asked.length === 0 && earlier.length === 0;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-5">
        <Card className="[--card-spacing:0px] overflow-hidden">
          <form onSubmit={ask}>
            <div className="px-4 py-3">
              <Label htmlFor="question" className="sr-only">
                Your question
              </Label>
              <Textarea
                ref={box}
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={3}
                maxLength={500}
                disabled={!enabled}
                placeholder="For example: Why do customers want single sign-on?"
                className="min-h-24 resize-none text-base"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-4 py-2.5">
              <p className="text-xs text-muted-foreground">
                Enter asks · Shift+Enter starts a new line
              </p>
              <div className="ml-auto flex items-center gap-2">
                {question.length > 400 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {question.length}/500
                  </span>
                ) : null}
                <Button
                  type="submit"
                  disabled={pending || !enabled || !question.trim()}
                >
                  {pending ? "Reading quotes…" : "Ask"}
                </Button>
              </div>
            </div>
          </form>
        </Card>

        {!enabled ? (
          <p className="text-sm text-muted-foreground">
            Questions are switched off until an AI provider is set up.
          </p>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">
              Try asking
            </span>
            {suggestions.map((s) => (
              <Button
                key={s}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto max-w-full py-1 text-left text-xs font-normal whitespace-normal"
                disabled={!enabled}
                onClick={() => trySuggestion(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        ) : null}

        <FormError message={result?.error} />

        <div aria-live="polite" className="space-y-4">
          {pending ? <PendingAnswer /> : null}
          {asked.map((a) => (
            <AnswerCard key={a.id} workspaceId={workspaceId} answer={a} />
          ))}
        </div>

        {empty && !pending ? (
          <EmptyState
            icon={MessageSquareQuote}
            title="No questions yet"
          >
            Ask what customers said about pricing, a feature or a complaint.
            The answer quotes them, or says it cannot.
          </EmptyState>
        ) : null}

        {earlier.length > 0 ? (
          <section aria-label="Earlier questions" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">
                Earlier questions
              </h2>
              <span className="text-xs text-muted-foreground">
                {plural(earlier.length, "question")}
              </span>
            </div>
            <div className="space-y-4">
              {earlier.map((a) => (
                <AnswerCard key={a.id} workspaceId={workspaceId} answer={a} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <aside className="space-y-4">
        <Card className="[--card-spacing:0px] overflow-hidden">
          <h2 className="border-b border-border px-4 py-3 text-sm font-medium">
            How answers work
          </h2>
          <ul className="space-y-3 px-4 py-3 text-sm">
            <li className="flex gap-2.5">
              <MessageSquareQuote
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span>
                Every sentence points at the words behind it, so you can read
                the evidence instead of trusting the summary.
              </span>
            </li>
            <li className="flex gap-2.5">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span>
                When the quotes do not answer the question, it says so rather
                than guessing.
              </span>
            </li>
            <li className="flex gap-2.5">
              <BarChart3
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span>
                It cannot count people or tell you how common something is.{" "}
                <Link href={`/w/${workspaceId}/requests`} className={link}>
                  Requests
                </Link>{" "}
                does that.
              </span>
            </li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}
