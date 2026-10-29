"use client";

import { useState, useTransition } from "react";
import { createPersonLookup } from "@/app/(app)/w/[workspaceId]/people/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";

export type PersonOption = { id: string; label: string };

/**
 * A person picker that searches instead of scrolling a long list, and can add
 * someone the moment they are not there yet. The trigger keeps the id the form
 * label points at, so it stays one labelled control.
 */
export function PersonCombobox({
  id,
  workspaceId,
  people,
  value,
  onChange,
  noneLabel,
  disabled,
  describedBy,
}: {
  id: string;
  workspaceId: string;
  people: PersonOption[];
  value: string;
  onChange: (id: string) => void;
  /** The option that stands for "not sure / more than one person". */
  noneLabel: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(people);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const selected = options.find((p) => p.id === value);
  const name = query.trim();
  const exists = options.some(
    (p) => p.label.toLowerCase() === name.toLowerCase(),
  );

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  function add() {
    if (!name) return;
    setError(undefined);
    start(async () => {
      const res = await createPersonLookup(workspaceId, name);
      if (!res.id) {
        setError(res.error ?? "Could not add that person.");
        return;
      }
      const person = { id: res.id, label: name };
      setOptions((prev) => [...prev, person]);
      pick(res.id);
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-describedby={describedBy}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {selected ? selected.label : noneLabel}
          </span>
          <ChevronsUpDownIcon className="shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
      >
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search people…"
          />
          <CommandList>
            <CommandEmpty>No one by that name.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={noneLabel} onSelect={() => pick("")}>
                {noneLabel}
              </CommandItem>
              {options.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.label}
                  onSelect={() => pick(p.id)}
                >
                  {p.label}
                  {p.id === value ? (
                    <CheckIcon className="ml-auto" aria-hidden="true" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {name && !exists ? (
          <div className="border-t border-border p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              disabled={pending}
              onClick={add}
            >
              <PlusIcon aria-hidden="true" />
              {pending ? "Adding…" : `Add “${name}”`}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="px-2 pb-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
