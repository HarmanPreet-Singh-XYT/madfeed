"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import {
  askAction,
  rateAction,
  type AnswerResult,
} from "@/app/(app)/w/[workspaceId]/research/actions";
import { FormError } from "./form-message";
import { Sparkles } from "lucide-react";
import { link } from "./ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

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
  const [pending, start] = useTransition();
  function rate(r: "good" | "wrong") {
    setError(undefined);
    start(async () => {
      const res = await rateAction(workspaceId, answer.id, r);
      if (res.error) setError(res.error);
      else setRating(r);
    });
  }
  return (
    <Card asChild className="[--card-spacing:0px] space-y-3 p-4">
      <article aria-label={`Answer to: ${answer.question}`}>
        <h3 className="flex items-start gap-2 text-sm font-semibold">
          <Sparkles
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-link"
          />
          {answer.question}
        </h3>
        {answer.outcome === "answered" ? (
          <>
            <p className="leading-6">
              {withCitations(answer.id, answer.text, answer.citations)}
            </p>
            <ol className="space-y-1.5 text-sm">
              {answer.citations.map((c) => (
                <li
                  key={c.number}
                  id={`cite-${answer.id}-${c.number}`}
                  className="rounded-xl bg-muted/50 px-3 py-2"
                >
                  <span className="font-medium">{c.number}.</span> “{c.quote}”{" "}
                  <Link
                    href={`/w/${workspaceId}/sources/${c.sourceItemId}?s=${c.spanStart}&e=${c.spanEnd}#quote`}
                    className={link}
                  >
                    See it in the conversation
                  </Link>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="space-y-1 rounded-xl border border-dashed border-input px-3 py-2.5">
            <p className="font-medium">Not enough evidence to answer that.</p>
            <p className="text-muted-foreground">{answer.reason}</p>
          </div>
        )}
        {canRate ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Was this right?
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              aria-pressed={rating === "good"}
              onClick={() => rate("good")}
            >
              Yes
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              aria-pressed={rating === "wrong"}
              onClick={() => rate("wrong")}
            >
              No, it&apos;s wrong
            </Button>
            {rating ? (
              <span role="status" className="text-sm text-muted-foreground">
                Thanks, noted.
              </span>
            ) : null}
          </div>
        ) : null}
        <FormError message={error} />
      </article>
    </Card>
  );
}

export function AskPanel({
  workspaceId,
  enabled,
  history,
}: {
  workspaceId: string;
  enabled: boolean;
  history: AnswerView[];
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AnswerResult>();
  const [pending, start] = useTransition();
  const [asked, setAsked] = useState<AnswerView[]>([]);

  function ask(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await askAction(workspaceId, question);
      setResult(r);
      if (r.answer) {
        setAsked((a) => [r.answer as AnswerView, ...a]);
        setQuestion("");
      }
    });
  }
  const shown = new Set(asked.map((a) => a.id));
  return (
    <div className="max-w-3xl space-y-6">
      <form onSubmit={ask} className="space-y-2">
        <label htmlFor="question" className="block text-sm font-medium">
          Your question
        </label>
        <div className="rounded-lg border border-input bg-card focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            maxLength={500}
            required
            disabled={!enabled}
            placeholder="For example: Why do customers want single sign-on?"
            className="min-h-0 resize-none rounded-lg border-0 bg-transparent px-3 py-2.5 text-sm focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-3 border-t border-border px-2 py-1.5">
            <span className="px-1 text-xs text-muted-foreground">
              Answers cite quotes, or say there is no evidence.
            </span>
            <Button type="submit" disabled={pending || !enabled}>
              {pending ? "Looking through what customers said…" : "Ask"}
            </Button>
          </div>
        </div>
        {!enabled ? (
          <p className="text-sm text-muted-foreground">
            Questions are switched off until an AI provider is set up.
          </p>
        ) : null}
        <FormError message={result?.error} />
      </form>
      <div aria-live="polite" className="space-y-4">
        {asked.map((a) => (
          <AnswerCard key={a.id} workspaceId={workspaceId} answer={a} />
        ))}
      </div>
      {history.filter((h) => !shown.has(h.id)).length > 0 ? (
        <section aria-label="Earlier questions" className="space-y-4">
          <h2>Earlier questions</h2>
          {history
            .filter((h) => !shown.has(h.id))
            .map((a) => (
              <AnswerCard key={a.id} workspaceId={workspaceId} answer={a} />
            ))}
        </section>
      ) : null}
    </div>
  );
}
