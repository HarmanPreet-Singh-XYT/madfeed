"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { mergePersonAction } from "@/app/(app)/w/[workspaceId]/people/actions";
import { searchPeopleAction, type DirectoryOption } from "@/lib/server/directory-actions";
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
import { avatarTint, initials, type PersonRow } from "./types";

/**
 * Merging two rows that are the same person. The one you opened is folded in and
 * deleted; the one you choose survives. Nothing happens until the warning is
 * acknowledged, and the API refuses if a send record would be lost.
 */
export function MergePersonDialog({
  workspaceId,
  source,
  suggestions,
  open,
  onOpenChange,
  onMerged,
}: {
  workspaceId: string;
  source: PersonRow | null;
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
      searchPeopleAction(workspaceId, term)
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

  // Before anything is typed, offer the people already on screen; typing searches the whole directory.
  const term = query.trim().toLowerCase();
  const shown = (
    results ??
    suggestions.filter(
      (o) =>
        o.id !== source?.id &&
        (!term ||
          o.name.toLowerCase().includes(term) ||
          (o.hint ?? "").toLowerCase().includes(term)),
    )
  ).filter((o) => o.id !== source?.id);

  function reset() {
    setQuery("");
    setResults(null);
    setTarget(null);
    setConfirmed(false);
    setError(undefined);
  }

  const card = (name: string, email?: string, note?: string) => (
    <div className="min-w-0 flex-1 rounded-xl border border-border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTint(name)}`}
        >
          {initials(name)}
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm font-medium break-words">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {email || "No email"}
          </span>
        </span>
      </div>
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
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
          <DialogTitle>Merge into another person</DialogTitle>
          <DialogDescription>
            Everything they said, voted on, were invited to and talked to us in
            moves to the surviving person. Then this one is deleted. This cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        {source ? (
          <div className="space-y-3">
            <div className="flex items-stretch gap-2">
              {card(
                source.name,
                source.email,
                `${source.quoteCount ?? 0} quote${source.quoteCount === 1 ? "" : "s"} will move`,
              )}
              <span className="flex items-center" aria-hidden="true">
                <ArrowRight className="size-4 text-muted-foreground" />
              </span>
              {target ? (
                card(target.name, target.email, "stays, with all of it")
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
                  placeholder="Search for the other person"
                  aria-label="Search for the person who survives"
                />
                <CommandList className="max-h-44">
                  <CommandEmpty>
                    {searching ? (
                      <span className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 aria-hidden="true" className="size-3 animate-spin" /> Searching…
                      </span>
                    ) : (
                      "No other person matches."
                    )}
                  </CommandEmpty>
                  <CommandGroup>
                    {shown.map((o) => (
                      <CommandItem
                        key={o.id}
                        value={`${o.name} ${o.hint ?? ""}`}
                        onSelect={() => setTarget(o)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{o.name}</span>
                          {o.hint ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {o.hint}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            ) : null}

            <Alert>
              <AlertTitle>What happens to the rest</AlertTitle>
              <AlertDescription>
                Claims, votes, survey invitations and conversations move. If both
                people were told about the same request, the merge is refused so no
                send record is lost — nothing is changed in that case.
              </AlertDescription>
            </Alert>

            {target ? (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="merge-confirm"
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                />
                <Label htmlFor="merge-confirm" className="text-sm font-normal">
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
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!source || !target || !confirmed || pending}
            onClick={() => {
              if (!source || !target) return;
              start(async () => {
                const r = await mergePersonAction(workspaceId, source.id, target.id);
                if (r.error) {
                  setError(r.error);
                  return;
                }
                toast.success(r.notice ?? "People merged.");
                onOpenChange(false);
                onMerged?.();
                router.refresh();
              });
            }}
          >
            {pending ? "Merging…" : "Merge people"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
