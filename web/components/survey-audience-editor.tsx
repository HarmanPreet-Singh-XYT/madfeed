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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
          <Button
            type="button"
            variant="outline"
            onClick={() => setReplace(true)}
          >
            Replace it with one made here
          </Button>
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
        <RadioGroup
          value={draft.mode}
          onValueChange={(mode) => {
            if (mode === "everyone") return setDraft({ ...draft, mode });
            setDraft({
              ...draft,
              mode: "match",
              conds: draft.conds.length ? draft.conds : [blank()],
            });
          }}
        >
          <Label
            id="aud-mode-everyone-label"
            htmlFor="aud-mode-everyone"
            className="flex items-center gap-2 text-sm"
          >
            <RadioGroupItem id="aud-mode-everyone" value="everyone" />
            Everyone in People who has an email address
          </Label>
          <Label
            id="aud-mode-match-label"
            htmlFor="aud-mode-match"
            className="flex items-center gap-2 text-sm"
          >
            <RadioGroupItem id="aud-mode-match" value="match" />
            Only people who match…
          </Label>
        </RadioGroup>
      </fieldset>
      {draft.mode === "match" ? (
        <div className="space-y-3">
          {draft.conds.length > 1 ? (
            <div>
              <Label
                id="aud-match-label"
                htmlFor="aud-match"
                className="mb-1 block text-sm font-medium"
              >
                A person is included when they match
              </Label>
              <Select
                value={draft.match}
                onValueChange={(value) =>
                  setDraft({ ...draft, match: value as "all" | "any" })
                }
              >
                <SelectTrigger
                  id="aud-match"
                  className="w-full max-w-xs"
                  aria-labelledby="aud-match-label"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all of these</SelectItem>
                  <SelectItem value="any">any of these</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <ul className="space-y-3">
            {draft.conds.map((c, i) => {
              const f = FIELDS.find((x) => x.id === c.field)!;
              const kind = inputOf(c.field, c.op);
              return (
                <li
                  key={i}
                  className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[auto_1fr_1fr_1.5fr_auto]"
                >
                  <Label
                    htmlFor={`c-${i}-not`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={`c-${i}-not`}
                      checked={c.not}
                      onCheckedChange={(value) =>
                        patch(i, { not: value === true })
                      }
                    />
                    Not
                    <span className="sr-only"> (rule {i + 1})</span>
                  </Label>
                  <div>
                    <Label htmlFor={`c-${i}-f`} className="sr-only">
                      Rule {i + 1}: what to look at
                    </Label>
                    <Select
                      value={c.field}
                      onValueChange={(value) => {
                        const nf = FIELDS.find((x) => x.id === value)!;
                        patch(i, {
                          field: nf.id,
                          op: nf.ops[0].id,
                          value: nf.ops[0].input === "bool" ? "yes" : "",
                        });
                      }}
                    >
                      <SelectTrigger id={`c-${i}-f`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELDS.map((x) => (
                          <SelectItem key={x.id} value={x.id}>
                            {x.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`c-${i}-o`} className="sr-only">
                      Rule {i + 1}: how to compare
                    </Label>
                    <Select
                      value={c.op}
                      onValueChange={(value) =>
                        patch(i, {
                          op: value as Cond["op"],
                          value:
                            inputOf(c.field, value) === "bool"
                              ? "yes"
                              : c.value,
                        })
                      }
                    >
                      <SelectTrigger id={`c-${i}-o`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {f.ops.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`c-${i}-v`} className="sr-only">
                      Rule {i + 1}: value
                    </Label>
                    {kind === "bool" ? (
                      <Select
                        value={c.value === "no" ? "no" : "yes"}
                        onValueChange={(value) => patch(i, { value })}
                      >
                        <SelectTrigger id={`c-${i}-v`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">yes</SelectItem>
                          <SelectItem value="no">no</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : kind === "request" ? (
                      <Select
                        value={c.value}
                        onValueChange={(value) => patch(i, { value })}
                      >
                        <SelectTrigger id={`c-${i}-v`} className="w-full">
                          <SelectValue placeholder="Choose a request…" />
                        </SelectTrigger>
                        <SelectContent>
                          {requests.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : kind === "list" ? (
                      <Textarea
                        id={`c-${i}-v`}
                        rows={2}
                        value={c.value}
                        placeholder="one or more, separated by commas"
                        onChange={(e) => patch(i, { value: e.target.value })}
                      />
                    ) : (
                      <Input
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
                      />
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        conds: draft.conds.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Remove<span className="sr-only"> rule {i + 1}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            variant="outline"
            disabled={draft.conds.length >= 25}
            onClick={() =>
              setDraft({ ...draft, conds: [...draft.conds, blank()] })
            }
          >
            Add a rule
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => run("preview")}
        >
          Count who this picks
        </Button>
        <Button type="button" disabled={pending} onClick={() => run("save")}>
          Save audience
        </Button>
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
