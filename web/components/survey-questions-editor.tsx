"use client";

import { useState, useTransition } from "react";
import {
  saveQuestionsAction,
  type QuestionDraft,
} from "@/app/(app)/w/[workspaceId]/surveys/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

const KINDS: Record<QuestionDraft["kind"], string> = {
  nps: "Recommend, 0 to 10 (NPS)",
  csat: "Satisfaction, 1 to 5 (CSAT)",
  choice: "Pick one answer",
  text: "Free text",
};

export function SurveyQuestionsEditor({
  workspaceId,
  surveyId,
  initial,
  editable,
}: {
  workspaceId: string;
  surveyId: string;
  initial: QuestionDraft[];
  editable: boolean;
}) {
  const [qs, setQs] = useState<QuestionDraft[]>(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<QuestionDraft>) => {
    setSaved(false);
    setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    const next = [...qs];
    [next[i], next[j]] = [next[j], next[i]];
    setSaved(false);
    setQs(next);
  };

  if (!editable)
    return (
      <div className="space-y-2">
        {qs.length === 0 ? (
          <p className="text-sm text-muted">No questions.</p>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {qs.map((q, i) => (
              <li key={i}>
                {q.prompt}{" "}
                <span className="text-muted">
                  ({KINDS[q.kind]}
                  {q.required ? ", required" : ""}
                  {q.kind === "choice" ? `: ${q.options.join(", ")}` : ""})
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-sm text-muted">
          Questions are fixed once a survey has opened, so answers keep their
          meaning.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {qs.map((q, i) => (
          <li key={i} className="space-y-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
              <div>
                <label
                  htmlFor={`q-${i}-prompt`}
                  className="mb-1 block text-sm font-medium"
                >
                  Question {i + 1}
                </label>
                <input
                  id={`q-${i}-prompt`}
                  value={q.prompt}
                  maxLength={300}
                  onChange={(e) => set(i, { prompt: e.target.value })}
                  className={field}
                />
              </div>
              <div>
                <label
                  htmlFor={`q-${i}-kind`}
                  className="mb-1 block text-sm font-medium"
                >
                  Type of answer
                </label>
                <select
                  id={`q-${i}-kind`}
                  value={q.kind}
                  onChange={(e) =>
                    set(i, {
                      kind: e.target.value as QuestionDraft["kind"],
                      options:
                        e.target.value === "choice" && q.options.length === 0
                          ? ["", ""]
                          : q.options,
                    })
                  }
                  className={field}
                >
                  {Object.entries(KINDS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {q.kind === "choice" ? (
              <div>
                <label
                  htmlFor={`q-${i}-opts`}
                  className="mb-1 block text-sm font-medium"
                >
                  Answers to choose from (one per line, 2 to 10)
                </label>
                <textarea
                  id={`q-${i}-opts`}
                  rows={4}
                  value={q.options.join("\n")}
                  onChange={(e) =>
                    set(i, { options: e.target.value.split("\n") })
                  }
                  className={field}
                />
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={q.required}
                  onChange={(e) => set(i, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                className={btn}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                Move up<span className="sr-only"> question {i + 1}</span>
              </button>
              <button
                type="button"
                className={btn}
                disabled={i === qs.length - 1}
                onClick={() => move(i, 1)}
              >
                Move down<span className="sr-only"> question {i + 1}</span>
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setSaved(false);
                  setQs(qs.filter((_, j) => j !== i));
                }}
              >
                Remove<span className="sr-only"> question {i + 1}</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
      {qs.length === 0 ? (
        <p className="text-sm text-muted">Add a question to begin.</p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={btn}
          disabled={qs.length >= 30}
          onClick={() => {
            setSaved(false);
            setQs([
              ...qs,
              { kind: "text", prompt: "", required: false, options: [] },
            ]);
          }}
        >
          Add a question
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const cleaned = qs.map((q) => ({
                ...q,
                options: q.options.map((o) => o.trim()).filter(Boolean),
              }));
              const r = await saveQuestionsAction(
                workspaceId,
                surveyId,
                cleaned,
              );
              setError(r?.error);
              setSaved(!r?.error);
            })
          }
        >
          {pending ? "Saving…" : "Save questions"}
        </button>
      </div>
      <FormError message={error} />
      {saved ? (
        <p role="status" className="text-sm text-muted">
          Questions saved.
        </p>
      ) : null}
    </div>
  );
}
