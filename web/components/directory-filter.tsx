"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  searchAccountsAction,
  searchPeopleAction,
  type DirectoryOption,
} from "@/lib/server/directory-actions";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";

/**
 * A person or company filter that searches the directory as you type instead of
 * making you scroll a long list. Once chosen it folds down to a chip, so the
 * filter panel stays short.
 */
export function DirectoryFilter({
  workspaceId,
  kind,
  value,
  label,
  onChange,
}: {
  workspaceId: string;
  kind: "person" | "account";
  value: string;
  label: string;
  onChange: (id: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<DirectoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const noun = kind === "person" ? "person" : "account";
  const article = kind === "person" ? "a" : "an";

  useEffect(() => {
    if (!picking) return;
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      const load =
        kind === "person" ? searchPeopleAction : searchAccountsAction;
      load(workspaceId, query.trim())
        .then((rows) => {
          if (!live) return;
          setOptions(rows);
          setError(false);
        })
        .catch(() => {
          if (live) setError(true);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [picking, query, workspaceId, kind]);

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">
        {kind === "person" ? "Person" : "Account"}
      </Label>
      {value && !picking ? (
        <span className="flex items-center gap-1">
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
            <span className="truncate">{label || `A ${noun}`}</span>
            <button
              type="button"
              aria-label={`Remove the ${noun} filter`}
              onClick={() => onChange("")}
              className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setPicking(true)}>
            Change
          </Button>
        </span>
      ) : (
        <Command shouldFilter={false} className="rounded-lg border border-border">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={`Find ${article} ${noun} by name`}
            aria-label={`Find ${article} ${noun}`}
          />
          <CommandList className="max-h-40">
            <CommandEmpty>
              {loading ? (
                <span className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 aria-hidden="true" className="size-3 animate-spin" /> Searching…
                </span>
              ) : error ? (
                "The directory could not be searched."
              ) : (
                `No ${noun} matches.`
              )}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem value="any" onSelect={() => { onChange(""); setQuery(""); setPicking(false); }}>
                Any {noun}
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={`${o.name} ${o.hint ?? ""}`}
                  onSelect={() => {
                    onChange(o.id);
                    setQuery("");
                    setPicking(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{o.name}</span>
                    {o.hint ? (
                      <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </div>
  );
}
