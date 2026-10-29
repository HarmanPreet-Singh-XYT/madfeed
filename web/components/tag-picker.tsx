"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "./form-message";

export type TagLite = { id: string; name: string; color: string };

const DOT: Record<string, string> = {
  gray: "bg-gray-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
};

/** The colour is only a hint; the name always carries the meaning. */
export function TagChip({
  tag,
  onRemove,
}: {
  tag: TagLite;
  /** When set, the chip can be taken off in place, without opening a panel. */
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-2.5 text-xs font-medium">
      <span
        aria-hidden
        className={`size-2 rounded-full ${DOT[tag.color] ?? DOT.gray}`}
      />
      {tag.name}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove the tag ${tag.name}`}
          title={`Remove ${tag.name}`}
          onClick={onRemove}
          className="-mr-1.5 ml-0.5 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span aria-hidden>×</span>
        </button>
      ) : null}
    </span>
  );
}

/**
 * A list of tags to tick. With `onCreate` the same panel can add a tag, so
 * tagging never sends someone to another screen and back.
 */
export function TagPicker({
  legend,
  tags,
  selected,
  onChange,
  disabled,
  onCreate,
}: {
  legend: string;
  tags: TagLite[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  onCreate?: (name: string) => Promise<{ error?: string; tag?: TagLite }>;
}) {
  const [find, setFind] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const needle = find.trim().toLowerCase();
  const shown = needle
    ? tags.filter((t) => t.name.toLowerCase().includes(needle))
    : tags;

  async function create() {
    const clean = name.trim();
    if (!clean || !onCreate) return;
    setError(undefined);
    setSaving(true);
    const r = await onCreate(clean);
    setSaving(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.tag && !selected.includes(r.tag.id)) onChange([...selected, r.tag.id]);
    setName("");
    setFind("");
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      {tags.length === 0 && !onCreate ? (
        <p className="text-sm text-muted-foreground">
          There are no tags yet. Add some under Research, Manage tags.
        </p>
      ) : null}
      {tags.length > 6 ? (
        <Input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Find a tag…"
          aria-label="Find a tag"
          className="min-h-11"
        />
      ) : null}
      {shown.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {shown.map((t) => {
            const on = selected.includes(t.id);
            return (
              <Label
                key={t.id}
                htmlFor={`tag-${t.id}`}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${on ? "border-foreground bg-muted font-medium" : "border-border"}`}
              >
                <Checkbox
                  id={`tag-${t.id}`}
                  checked={on}
                  onCheckedChange={() =>
                    onChange(
                      on
                        ? selected.filter((i) => i !== t.id)
                        : [...selected, t.id],
                    )
                  }
                />
                <TagChip tag={t} />
              </Label>
            );
          })}
        </div>
      ) : null}
      {onCreate ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <Label htmlFor="new-tag" className="text-sm">
              New tag
            </Label>
            <Input
              id="new-tag"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
              }}
              placeholder="For example: Onboarding"
              className="min-h-11"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={saving || name.trim() === ""}
            onClick={() => void create()}
          >
            {saving ? "Adding…" : "Create tag"}
          </Button>
        </div>
      ) : null}
      <FormError message={error} />
    </fieldset>
  );
}
