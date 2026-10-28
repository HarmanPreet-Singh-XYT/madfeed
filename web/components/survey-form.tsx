"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  loadSavedAction,
  submitAnswersAction,
  type Answer,
} from "@/app/s/actions";
import { visibleIds, type ShowIf, type ShowWhen } from "@/lib/survey-logic";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

type Question = {
  id: string;
  kind: "nps" | "csat" | "choice" | "text";
  prompt: string;
  required: boolean;
  options: string[];
  showIf?: ShowIf;
  showWhen?: ShowWhen;
};

type Value = { number?: number; choice?: string; text?: string };

function newKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A key this browser keeps so a public link takes one answer per browser. Falls back to this visit only. */
function browserKey(token: string): string {
  const name = `survey-browser-${token.slice(0, 40)}`;
  try {
    const have = localStorage.getItem(name);
    if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have;
    const k = newKey();
    localStorage.setItem(name, k);
    return k;
  } catch {
    return newKey();
  }
}

function Scale({
  id,
  from,
  to,
  value,
  onChange,
  lowLabel,
  highLabel,
  legend,
  required,
}: {
  id: string;
  from: number;
  to: number;
  value?: number;
  onChange: (n: number) => void;
  lowLabel: string;
  highLabel: string;
  legend: string;
  required: boolean;
}) {
  const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <fieldset className="space-y-2">
      <legend className="text-base font-medium">
        {legend}
        {required ? (
          <span className="text-muted-foreground"> (required)</span>
        ) : null}
      </legend>
      <RadioGroup
        value={value === undefined ? "" : String(value)}
        onValueChange={(next) => onChange(Number(next))}
        className="flex flex-wrap gap-2"
      >
        {nums.map((n) => (
          <Label key={n} htmlFor={`${id}-${n}`} className="relative">
            <RadioGroupItem
              id={`${id}-${n}`}
              value={String(n)}
              className="peer sr-only"
            />
            <span className="inline-flex size-11 cursor-pointer items-center justify-center rounded-xl border border-border text-sm font-medium peer-data-[state=checked]:border-transparent peer-data-[state=checked]:bg-primary peer-data-[state=checked]:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
              {n}
            </span>
          </Label>
        ))}
      </RadioGroup>
      <div className="flex justify-between text-sm text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </fieldset>
  );
}

export function SurveyForm({
  token,
  title,
  intro,
  questions,
  saved,
}: {
  token: string;
  title: string;
  intro: string;
  questions: Question[];
  saved: Answer[];
}) {
  const isPublicLink = token.startsWith("o.");
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(
      saved.map((a) => [
        a.questionId,
        { number: a.number, choice: a.choice, text: a.text },
      ]),
    ),
  );
  const respondent = useRef(""); // this browser's id on a public link
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [done, setDone] = useState<{ message: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!isPublicLink) return;
    const key = browserKey(token);
    respondent.current = key;
    loadSavedAction(token, key).then((s) => {
      if (s.answered)
        setDone({
          message: "You have already answered this survey. Thank you.",
        });
      else if (s.answers.length > 0)
        setValues(
          Object.fromEntries(
            s.answers.map((a) => [
              a.questionId,
              { number: a.number, choice: a.choice, text: a.text },
            ]),
          ),
        );
    });
  }, [isPublicLink, token]);

  const shown = visibleIds(questions, values);
  const set = (id: string, v: Value) => {
    setNotice(undefined);
    setValues((cur) => ({ ...cur, [id]: v }));
  };

  const collect = (): Answer[] => {
    const out: Answer[] = [];
    for (const q of questions) {
      const v = values[q.id];
      if (!v || !shown.has(q.id)) continue;
      if ((q.kind === "nps" || q.kind === "csat") && v.number !== undefined)
        out.push({ questionId: q.id, number: v.number });
      else if (q.kind === "choice" && v.choice)
        out.push({ questionId: q.id, choice: v.choice });
      else if (q.kind === "text" && v.text && v.text.trim())
        out.push({ questionId: q.id, text: v.text });
    }
    return out;
  };

  const send = (complete: boolean) => {
    setError(undefined);
    setNotice(undefined);
    const answers = collect();
    if (complete) {
      const missing = questions.filter(
        (q) =>
          q.required &&
          shown.has(q.id) &&
          !answers.some((a) => a.questionId === q.id),
      );
      if (missing.length > 0) {
        setError(
          `Please answer: ${missing.map((q) => `“${q.prompt}”`).join(", ")}.`,
        );
        return;
      }
      if (answers.length === 0) {
        setError("Answer at least one question first.");
        return;
      }
    }
    start(async () => {
      const r = await submitAnswersAction(
        token,
        respondent.current,
        answers,
        complete,
        website,
      );
      if (r.error) setError(r.error);
      else if (r.complete)
        setDone({
          message: r.alreadyAnswered
            ? "You have already answered this survey. Thank you."
            : r.thankYou || "Thank you. Your answers were sent.",
        });
      else
        setNotice(
          "Saved. You can close this page and come back to the same link to finish.",
        );
    });
  };

  if (done)
    return (
      <div role="status" className="space-y-2">
        <h2 className="text-xl font-semibold">Thank you</h2>
        <p>{done.message}</p>
      </div>
    );

  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        send(true);
      }}
      className="space-y-8"
      noValidate
    >
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {intro ? (
          <p className="whitespace-pre-wrap text-muted-foreground">{intro}</p>
        ) : null}
      </div>
      {questions.map((q) => {
        if (!shown.has(q.id)) return null;
        const v = values[q.id] ?? {};
        if (q.kind === "nps")
          return (
            <Scale
              key={q.id}
              id={`q-${q.id}`}
              from={0}
              to={10}
              value={v.number}
              onChange={(n) => set(q.id, { number: n })}
              lowLabel="0 = not at all likely"
              highLabel="10 = extremely likely"
              legend={q.prompt}
              required={q.required}
            />
          );
        if (q.kind === "csat")
          return (
            <Scale
              key={q.id}
              id={`q-${q.id}`}
              from={1}
              to={5}
              value={v.number}
              onChange={(n) => set(q.id, { number: n })}
              lowLabel="1 = very unsatisfied"
              highLabel="5 = very satisfied"
              legend={q.prompt}
              required={q.required}
            />
          );
        if (q.kind === "choice")
          return (
            <fieldset key={q.id} className="space-y-2">
              <legend className="text-base font-medium">
                {q.prompt}
                {q.required ? (
                  <span className="text-muted-foreground"> (required)</span>
                ) : null}
              </legend>
              <RadioGroup
                value={v.choice ?? ""}
                onValueChange={(choice) => set(q.id, { choice })}
              >
                {q.options.map((o, k) => (
                  <Label
                    key={o}
                    htmlFor={`q-${q.id}-opt-${k}`}
                    className="flex min-h-11 items-center gap-3"
                  >
                    <RadioGroupItem
                      id={`q-${q.id}-opt-${k}`}
                      value={o}
                      className="size-5"
                    />
                    {o}
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
          );
        return (
          <div key={q.id} className="space-y-2">
            <Label
              htmlFor={`q-${q.id}`}
              className="block text-base font-medium"
            >
              {q.prompt}
              {q.required ? (
                <span className="text-muted-foreground"> (required)</span>
              ) : null}
            </Label>
            <Textarea
              id={`q-${q.id}`}
              rows={4}
              maxLength={2000}
              value={v.text ?? ""}
              onChange={(e) => set(q.id, { text: e.target.value })}
            />
          </div>
        );
      })}
      {/* A box people never see. Bots that fill every field give themselves away. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
      >
        <Input
          tabIndex={-1}
          autoComplete="off"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send my answers"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => send(false)}
        >
          Save and finish later
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Your answers are used by the team that sent you this survey. Written
        answers may be read by them and added to their feedback.
      </p>
    </form>
  );
}
