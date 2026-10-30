"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { mergeAccountsAction } from "@/app/(app)/w/[workspaceId]/people/actions";
import { searchAccountsAction, type DirectoryOption } from "@/lib/server/directory-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { formatValue } from "@/lib/format";
import type { CompanyRow } from "./types";

/**
 * Merging two companies that are the same company. The opened one is folded in
 * and deleted; the chosen one survives with its name and value. Missing
 * details are filled from the other. Nothing happens until acknowledged.
 */
export function MergeCompanyDialog({
  workspaceId,
  source,
  suggestions,
  open,
  onOpenChange,
  onMerged,
}: {
  workspaceId: string;
  source: CompanyRow | null;
  suggestions: DirectoryOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<DirectoryOption | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    const term = query.trim();
    if (!open || !term) return;
    let live = true;
    const timer = setTimeout(() => {
      searchAccountsAction(workspaceId, term)
        .then((rows) => {
          if (live) setResults(rows.filter((r) => r.id !== source?.id));
        })
        .catch(() => {
          if (live) setResults([]);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, query, workspaceId, source?.id]);

  const term = query.trim().toLowerCase();
  const shown = (
    results ??
    suggestions.filter(
      (o) =>
        o.id !== source?.id &&
        (!term || o.name.toLowerCase().includes(term)),
    )
  ).filter((o) => o.id !== source?.id);

  function reset() {
    setQuery("");
    setResults(null);
    setTarget(null);
    setConfirmed(false);
    setError(undefined);
  }

  const card = (name: string, note: string, money?: string) => (
    <div className="min-w-0 flex-1 rounded-xl border border-border p-3">
      <p className="line-clamp-2 text-sm font-medium break-words">{name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      {money ? (
        <p className="mt-1 text-sm font-semibold tabular-nums">{formatValue(money)}</p>
      ) : null}
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge into another company</DialogTitle>
          <DialogDescription>
            Its people and saved views move to the surviving company, then this
            one is deleted. The survivor keeps its own name and value; missing
            details come from the other. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {source ? (
          <div className="space-y-3">
            <div className="flex items-stretch gap-2">
              {card(
                source.name,
                `${source.peopleCount} ${source.peopleCount === 1 ? "person" : "people"} will move`,
                source.revenue,
              )}
              <span className="flex items-center" aria-hidden="true">
                <ArrowRight className="size-4 text-muted-foreground" />
              </span>
              {target ? (
                card(target.name, "stays, with everything", undefined)
              ) : (
                <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Choose who survives
                </div>
              )}
            </div>

            {!target ? (
              <Command shouldFilter={false} className="rounded-lg border border-border">
                <CommandInput
                  value={query}
                  onValueChange={(v) => {
                    setQuery(v);
                    setResults(null);
                    setSearching(Boolean(v.trim()));
                  }}
                  placeholder="Search for the other company"
                  aria-label="Search for the company that survives"
                />
                <CommandList className="max-h-44">
                  <CommandEmpty>
                    {searching ? (
                      <span className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 aria-hidden="true" className="size-3 animate-spin" /> Searching…
                      </span>
                    ) : (
                      "No other company matches."
                    )}
                  </CommandEmpty>
                  <CommandGroup>
                    {shown.map((o) => (
                      <CommandItem key={o.id} value={o.name} onSelect={() => setTarget(o)}>
                        {o.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            ) : null}

            <Alert>
              <AlertTitle>What happens to the rest</AlertTitle>
              <AlertDescription>
                People move to the survivor and their requests are re-counted
                against its value. Saved quote views follow their company. The
                merge is refused if either company no longer exists, and nothing
                changes in that case.
              </AlertDescription>
            </Alert>

            {target ? (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="merge-company-confirm"
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                />
                <Label htmlFor="merge-company-confirm" className="text-sm font-normal">
                  I understand {source.name} will be deleted and this cannot be
                  undone.
                </Label>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!source || !target || !confirmed || pending}
            onClick={() => {
              if (!source || !target) return;
              start(async () => {
                const r = await mergeAccountsAction(workspaceId, source.id, target.id);
                if (r.error) {
                  setError(r.error);
                  return;
                }
                toast.success(r.notice ?? "Companies merged.");
                onOpenChange(false);
                onMerged?.();
                router.refresh();
              });
            }}
          >
            {pending ? "Merging…" : "Merge companies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
