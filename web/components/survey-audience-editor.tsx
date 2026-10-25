"use client";

import { useState, useTransition } from "react";
import {
  previewAudienceAction,
  saveAudienceAction,
  type Preview,
} from "@/app/(app)/w/[workspaceId]/surveys/actions";
import {
  FIELDS,
  describe,
  fromRule,
  inputOf,
  toRule,
  type Cond,
  type Draft,
  type Rule,
} from "@/lib/audience";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

const blank = (): Cond => ({
  field: "account_plan",
  op: "eq",
  value: "",
  not: false,
});

export function SurveyAudienceEditor({
  workspaceId,
  surveyId,
  saved,
  requests,
  canEdit,
}: {
  workspaceId: string;
  surveyId: string;
  saved?: Rule;
  requests: { id: string; title: string }[];
  canEdit: boolean;
}) {
  const parsed = fromRule(saved);
  const advanced = saved !== undefined && parsed === null;
  const [draft, setDraft] = useState<Draft>(
    parsed ?? { mode: "match", match: "all", conds: [blank()] },
  );
  const [chosen, setChosen] = useState(saved !== undefined);
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [pending, start] = useTransition();

  const patch = (i: number, p: Partial<Cond>) => {
    setNote(undefined);
    setDraft({
      ...draft,
      conds: draft.conds.map((c, j) => (j === i ? { ...c, ...p } : c)),
    });
  };

  if (advanced && !replace)
    return (
      <div className="space-y-3">
        <p className="text-sm">
          This audience was set up outside the form, with rules the form cannot
          show. It still works.
        </p>
        {canEdit ? (
          <button
            type="button"
            className={btn}
            onClick={() => setReplace(true)}
          >
            Replace it with one made here
          </button>
        ) : null}
      </div>
    );

  if (!canEdit)
    return (
      <p className="text-sm">
        {chosen && parsed
          ? describe(parsed, requests)
          : "No audience has been chosen yet."}
      </p>
    );

  const run = (kind: "save" | "preview") => {
    setError(undefined);
    setNote(undefined);
    let rule: Rule;
    try {
      rule = toRule(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the audience.");
      return;
    }
    start(async () => {
      if (kind === "save") {
        const r = await saveAudienceAction(workspaceId, surveyId, rule);
        setError(r?.error);
        if (!r?.error) {
          setChosen(true);
          setNote("Audience saved.");
        }
      } else {
        const r = await previewAudienceAction(workspaceId, surveyId, rule);
        setError(r.error);
        setPreview(r.preview);
      }
    });
  };

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who is it for?</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="aud-mode"
            className="size-5"
            checked={draft.mode === "everyone"}
            onChange={() => setDraft({ ...draft, mode: "everyone" })}
          />
          Everyone in People who has an email address
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="aud-mode"
            className="size-5"
            checked={draft.mode === "match"}
            onChange={() =>
              setDraft({
                ...draft,
                mode: "match",
                conds: draft.conds.length ? draft.conds : [blank()],
              })
            }
          />
          Only people who match…
        </label>
      </fieldset>
      {draft.mode === "match" ? (
        <div className="space-y-3">
          {draft.conds.length > 1 ? (
            <div>
              <label
                htmlFor="aud-match"
                className="mb-1 block text-sm font-medium"
              >
                A person is included when they match
              </label>
              <select
                id="aud-match"
                value={draft.match}
                onChange={(e) =>
                  setDraft({ ...draft, match: e.target.value as "all" | "any" })
                }
                className={`${field} max-w-xs`}
              >
                <option value="all">all of these</option>
                <option value="any">any of these</option>
              </select>
            </div>
          ) : null}
          <ul className="space-y-3">
            {draft.conds.map((c, i) => {
              const f = FIELDS.find((x) => x.id === c.field)!;
              const kind = inputOf(c.field, c.op);
              return (
                <li
                  key={i}
                  className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[auto_1fr_1fr_1.5fr_auto]"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={c.not}
                      onChange={(e) => patch(i, { not: e.target.checked })}
                    />
                    Not
                    <span className="sr-only"> (rule {i + 1})</span>
                  </label>
                  <div>
                    <label htmlFor={`c-${i}-f`} className="sr-only">
                      Rule {i + 1}: what to look at
                    </label>
                    <select
                      id={`c-${i}-f`}
                      value={c.field}
                      onChange={(e) => {
                        const nf = FIELDS.find((x) => x.id === e.target.value)!;
                        patch(i, {
                          field: nf.id,
                          op: nf.ops[0].id,
                          value: nf.ops[0].input === "bool" ? "yes" : "",
                        });
                      }}
                      className={field}
                    >
                      {FIELDS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`c-${i}-o`} className="sr-only">
                      Rule {i + 1}: how to compare
                    </label>
                    <select
                      id={`c-${i}-o`}
                      value={c.op}
                      onChange={(e) =>
                        patch(i, {
                          op: e.target.value as Cond["op"],
                          value:
                            inputOf(c.field, e.target.value) === "bool"
                              ? "yes"
                              : c.value,
                        })
                      }
                      className={field}
                    >
                      {f.ops.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`c-${i}-v`} className="sr-only">
                      Rule {i + 1}: value
                    </label>
                    {kind === "bool" ? (
                      <select
                        id={`c-${i}-v`}
                        value={c.value === "no" ? "no" : "yes"}
                        onChange={(e) => patch(i, { value: e.target.value })}
                        className={field}
                      >
                        <option value="yes">yes</option>
                        <option value="no">no</option>
                      </select>
                    ) : kind === "request" ? (
                      <select
                        id={`c-${i}-v`}
                        value={c.value}
                        onChange={(e) => patch(i, { value: e.target.value })}
                        className={field}
                      >
                        <option value="">Choose a request…</option>
                        {requests.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.title}
                          </option>
                        ))}
                      </select>
                    ) : kind === "list" ? (
                      <textarea
                        id={`c-${i}-v`}
                        rows={2}
                        value={c.value}
                        placeholder="one or more, separated by commas"
                        onChange={(e) => patch(i, { value: e.target.value })}
                        className={field}
                      />
                    ) : (
                      <input
                        id={`c-${i}-v`}
                        value={c.value}
                        inputMode={
                          kind === "number" || kind === "days"
                            ? "decimal"
                            : undefined
                        }
                        placeholder={
                          kind === "date"
                            ? "2026-12-31"
                            : kind === "number"
                              ? "for example 5000"
                              : undefined
                        }
                        onChange={(e) => patch(i, { value: e.target.value })}
                        className={field}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    className={btn}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        conds: draft.conds.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove<span className="sr-only"> rule {i + 1}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className={btn}
            disabled={draft.conds.length >= 25}
            onClick={() =>
              setDraft({ ...draft, conds: [...draft.conds, blank()] })
            }
          >
            Add a rule
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={() => run("preview")}
        >
          Count who this picks
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={pending}
          onClick={() => run("save")}
        >
          Save audience
        </button>
      </div>
      <FormError message={error} />
      {note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
      {preview ? (
        <div role="status" className="space-y-1 text-sm">
          <p>
            <strong>{preview.total}</strong>{" "}
            {preview.total === 1 ? "person matches" : "people match"};{" "}
            <strong>{preview.withEmail}</strong> can be emailed.
            {preview.alreadyInvited > 0
              ? ` ${preview.alreadyInvited} already ${preview.alreadyInvited === 1 ? "has an invitation" : "have invitations"}.`
              : ""}
          </p>
          {preview.sample.length > 0 ? (
            <p className="text-muted-foreground">
              For example: {preview.sample.map((p) => p.name).join(", ")}
              {preview.withEmail > preview.sample.length ? "…" : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
