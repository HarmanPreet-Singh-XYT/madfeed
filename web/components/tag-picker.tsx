"use client";

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
export function TagChip({ tag }: { tag: TagLite }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium">
      <span
        aria-hidden
        className={`size-2 rounded-full ${DOT[tag.color] ?? DOT.gray}`}
      />
      {tag.name}
    </span>
  );
}

export function TagPicker({
  legend,
  tags,
  selected,
  onChange,
  disabled,
}: {
  legend: string;
  tags: TagLite[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  if (tags.length === 0) return null;
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => {
          const on = selected.includes(t.id);
          return (
            <label
              key={t.id}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${on ? "border-foreground bg-muted font-medium" : "border-border"}`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  onChange(
                    on
                      ? selected.filter((i) => i !== t.id)
                      : [...selected, t.id],
                  )
                }
              />
              <TagChip tag={t} />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
