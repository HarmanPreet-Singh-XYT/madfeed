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
  mode,
}: {
  workspaceId: string;
  surveyId: string;
  initial: QuestionDraft[];
  /** full: draft; wording: opened (only the words may change); readonly: a viewer */
  mode: "full" | "wording" | "readonly";
}) {
  const [qs, setQs] = useState<QuestionDraft[]>(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<QuestionDraft>) => {
    setSaved(false);
    setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  };
  // Conditions point at a position, so they are re-pointed (or dropped) when questions move or go.
  const renumber = (
    next: QuestionDraft[],
    where: (oldPos: number) => number | null,
  ) =>
    next.map((q) => {
      if (!q.showWhen) return q;
      const conditions = q.showWhen.conditions.flatMap((c) => {
        const to = where(c.question);
        return to === null ? [] : [{ ...c, question: to }];
      });
      return conditions.length === 0
        ? { ...q, showWhen: undefined }
        : { ...q, showWhen: { ...q.showWhen, conditions } };
    });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    const next = [...qs];
    [next[i], next[j]] = [next[j], next[i]];
    setSaved(false);
    // a question can only depend on ones before it: moving across a parent drops that condition
    const fixed = renumber(next, (p) => (p === i ? j : p === j ? i : p)).map(
      (q, k) => {
        if (!q.showWhen) return q;
        const conditions = q.showWhen.conditions.filter((c) => c.question < k);
        return conditions.length === 0
          ? { ...q, showWhen: undefined }
          : { ...q, showWhen: { ...q.showWhen, conditions } };
      },
    );
    setQs(fixed);
  };
  const remove = (i: number) => {
    setSaved(false);
    const next = qs.filter((_, j) => j !== i);
    setQs(renumber(next, (p) => (p === i ? null : p > i ? p - 1 : p)));
  };

  const describeCond = (q: QuestionDraft) => {
    if (!q.showWhen) return "";
    const parts = q.showWhen.conditions.map((c) => {
      const src = qs[c.question];
      const w = {
        eq: "is",
        ne: "is not",
        lte: "is at most",
        gte: "is at least",
      }[c.op];
      return `“${src?.prompt || `question ${c.question + 1}`}” ${w} ${c.number ?? c.choice}`;
    });
    return ` Shown only when ${parts.join(q.showWhen.match === "any" ? " or " : " and ")}.`;
  };

  if (mode === "readonly")
    return (
      <div className="space-y-2">
        {qs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions.</p>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {qs.map((q, i) => (
              <li key={i}>
                {q.prompt}{" "}
                <span className="text-muted-foreground">
                  ({KINDS[q.kind]}
                  {q.required ? ", required" : ""}
                  {q.kind === "choice" ? `: ${q.options.join(", ")}` : ""})
                  {describeCond(q)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    );

  if (mode === "wording")
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The survey is open, so the questions, their types and conditions are
          fixed and answers keep their meaning. You can still fix the wording.
        </p>
        <ol className="space-y-3">
          {qs.map((q, i) => (
            <li key={i}>
              <label
                htmlFor={`q-${i}-prompt`}
                className="mb-1 block text-sm font-medium"
              >
                Question {i + 1}{" "}
                <span className="font-normal text-muted-foreground">
                  ({KINDS[q.kind]}
                  {q.required ? ", required" : ""})
                </span>
              </label>
              <input
                id={`q-${i}-prompt`}
                value={q.prompt}
                maxLength={300}
                onChange={(e) => set(i, { prompt: e.target.value })}
                className={field}
              />
              {q.showWhen ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {describeCond(q).trim()}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveQuestionsAction(workspaceId, surveyId, qs);
              setError(r?.error);
              setSaved(!r?.error);
            })
          }
        >
          {pending ? "Saving…" : "Save wording"}
        </button>
        <FormError message={error} />
        {saved ? (
          <p role="status" className="text-sm text-muted-foreground">
            Wording saved.
          </p>
        ) : null}
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
            {i > 0 ? (
              <ConditionEditor
                qs={qs}
                i={i}
                value={q.showWhen}
                onChange={(showWhen) => set(i, { showWhen })}
              />
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
              <button type="button" className={btn} onClick={() => remove(i)}>
                Remove<span className="sr-only"> question {i + 1}</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
      {qs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add a question to begin.</p>
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
        <p role="status" className="text-sm text-muted-foreground">
          Questions saved.
        </p>
      ) : null}
    </div>
  );
}

type Cond = NonNullable<QuestionDraft["showWhen"]>["conditions"][number];

/** A fresh condition on question p, with a sensible starting value. */
function startingCondition(qs: QuestionDraft[], p: number): Cond {
  const src = qs[p];
  return src.kind === "choice"
    ? {
        question: p,
        op: "eq",
        choice: src.options.map((o) => o.trim()).filter(Boolean)[0] ?? "",
      }
    : src.kind === "csat"
      ? { question: p, op: "lte", number: 3 }
      : { question: p, op: "lte", number: 6 };
}

/** Up to four conditions on earlier ratings or choices, combined with "all" or "any". */
function ConditionEditor({
  qs,
  i,
  value,
  onChange,
}: {
  qs: QuestionDraft[];
  i: number;
  value: QuestionDraft["showWhen"];
  onChange: (v: QuestionDraft["showWhen"]) => void;
}) {
  const conds = value?.conditions ?? [];
  const match = value?.match ?? "all";
  const firstUsable = qs.findIndex((e, p) => p < i && e.kind !== "text");
  const put = (c: number, cond: Cond | undefined) => {
    const next = conds.flatMap((x, k) =>
      k === c ? (cond ? [cond] : []) : [x],
    );
    onChange(next.length === 0 ? undefined : { match, conditions: next });
  };
  return (
    <div className="space-y-3">
      {(conds.length === 0 ? [undefined] : conds).map((cond, c) => (
        <div
          key={c}
          className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
          role="group"
          aria-label={`Condition ${c + 1} for question ${i + 1}`}
        >
          <div>
            <label
              htmlFor={`q-${i}-when-${c}`}
              className="mb-1 block text-sm font-medium"
            >
              {c === 0
                ? "When is this question shown?"
                : "And another condition"}
            </label>
            <select
              id={`q-${i}-when-${c}`}
              className={field}
              value={cond ? String(cond.question) : ""}
              onChange={(e) => {
                if (e.target.value === "") return put(c, undefined);
                const p = Number(e.target.value);
                if (c === 0 && conds.length === 0)
                  return onChange({
                    match,
                    conditions: [startingCondition(qs, p)],
                  });
                put(c, startingCondition(qs, p));
              }}
            >
              <option value="">
                {c === 0 ? "Always" : "Remove this condition"}
              </option>
              {qs.slice(0, i).map((e, p) =>
                e.kind === "text" ? null : (
                  <option key={p} value={p}>
                    Only if the answer to question {p + 1} …
                  </option>
                ),
              )}
            </select>
          </div>
          {cond ? (
            <>
              <div>
                <label
                  htmlFor={`q-${i}-op-${c}`}
                  className="mb-1 block text-sm font-medium"
                >
                  Comparison
                </label>
                <select
                  id={`q-${i}-op-${c}`}
                  className={field}
                  value={cond.op}
                  onChange={(e) =>
                    put(c, {
                      ...cond,
                      op: e.target.value as "eq" | "ne" | "lte" | "gte",
                    })
                  }
                >
                  <option value="eq">is</option>
                  <option value="ne">is not</option>
                  {qs[cond.question].kind !== "choice" ? (
                    <>
                      <option value="lte">is at most</option>
                      <option value="gte">is at least</option>
                    </>
                  ) : null}
                </select>
              </div>
              <div>
                <label
                  htmlFor={`q-${i}-val-${c}`}
                  className="mb-1 block text-sm font-medium"
                >
                  Value
                </label>
                {qs[cond.question].kind === "choice" ? (
                  <select
                    id={`q-${i}-val-${c}`}
                    className={field}
                    value={cond.choice ?? ""}
                    onChange={(e) =>
                      put(c, { ...cond, choice: e.target.value })
                    }
                  >
                    {qs[cond.question].options
                      .map((o) => o.trim())
                      .filter(Boolean)
                      .map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    id={`q-${i}-val-${c}`}
                    type="number"
                    min={qs[cond.question].kind === "csat" ? 1 : 0}
                    max={qs[cond.question].kind === "csat" ? 5 : 10}
                    className={field}
                    value={cond.number ?? ""}
                    onChange={(e) =>
                      put(c, {
                        ...cond,
                        number:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                  />
                )}
              </div>
            </>
          ) : null}
        </div>
      ))}
      {conds.length >= 1 && conds.length < 4 && firstUsable >= 0 ? (
        <button
          type="button"
          className={btn}
          onClick={() =>
            onChange({
              match,
              conditions: [...conds, startingCondition(qs, firstUsable)],
            })
          }
        >
          Add a condition<span className="sr-only"> to question {i + 1}</span>
        </button>
      ) : null}
      {conds.length >= 2 ? (
        <div>
          <label
            htmlFor={`q-${i}-match`}
            className="mb-1 block text-sm font-medium"
          >
            How the conditions combine
          </label>
          <select
            id={`q-${i}-match`}
            className={field}
            value={match}
            onChange={(e) =>
              onChange({
                match: e.target.value as "all" | "any",
                conditions: conds,
              })
            }
          >
            <option value="all">Show it when all of them hold</option>
            <option value="any">Show it when any one of them holds</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}
