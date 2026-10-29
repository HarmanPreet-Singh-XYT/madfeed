import type { ReactNode } from "react";
import type { QuestionDraft } from "@/app/(app)/w/[workspaceId]/surveys/actions";

const NPS = Array.from({ length: 11 }, (_, i) => i);
const CSAT = [1, 2, 3, 4, 5];

function Scale({ values }: { values: number[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((n) => (
        <span
          key={n}
          className="flex size-8 items-center justify-center rounded-full border border-border bg-card text-xs font-medium tabular-nums"
        >
          {n}
        </span>
      ))}
    </div>
  );
}

function Answer({ q }: { q: QuestionDraft }) {
  switch (q.kind) {
    case "nps":
      return (
        <div className="space-y-1">
          <Scale values={NPS} />
          <p className="flex justify-between text-[11px] text-muted-foreground">
            <span>Not likely</span>
            <span>Very likely</span>
          </p>
        </div>
      );
    case "csat":
      return <Scale values={CSAT} />;
    case "choice":
      return (
        <ul className="space-y-1.5">
          {q.options.length === 0 ? (
            <li className="text-xs text-muted-foreground">
              Add some answers to see them here.
            </li>
          ) : (
            q.options.map((o, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
              >
                <span
                  aria-hidden="true"
                  className="size-3.5 shrink-0 rounded-full border border-input"
                />
                {o || <span className="text-muted-foreground">(empty)</span>}
              </li>
            ))
          )}
        </ul>
      );
    case "text":
      return (
        <div className="h-16 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Their answer, in their own words
        </div>
      );
  }
}

/**
 * What the person being asked will see, redrawn as the questions are edited. It is a picture only: nothing in it can be
 * focused or answered. Conditions are marked, not evaluated, because the answers they depend on aren't known here.
 */
export function SurveyPreview({
  questions,
  title,
}: {
  questions: QuestionDraft[];
  title?: ReactNode;
}) {
  return (
    <section
      aria-label="Preview of the survey as a customer sees it"
      className="overflow-hidden rounded-2xl border border-border bg-muted shadow-card"
    >
      <div className="bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 px-4 py-3 text-on-brand">
        <p className="text-[11px] font-semibold tracking-widest uppercase">
          Preview
        </p>
        <p className="font-display text-base font-bold">{title ?? "Survey"}</p>
      </div>
      <div inert className="space-y-4 p-4">
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Questions you add show up here as customers will see them.
          </p>
        ) : (
          questions.map((q, i) => (
            <div key={i} className="space-y-2">
              <p className="text-sm font-medium">
                {q.prompt || (
                  <span className="text-muted-foreground">
                    Question {i + 1} has no wording yet
                  </span>
                )}
                {q.required ? (
                  <span className="text-destructive"> *</span>
                ) : null}
              </p>
              {q.showWhen ? (
                <p className="text-[11px] text-muted-foreground">
                  Only shown for some answers
                </p>
              ) : null}
              <Answer q={q} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
