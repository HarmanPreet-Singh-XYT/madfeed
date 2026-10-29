"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updatePersonFields } from "@/app/(app)/w/[workspaceId]/people/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AccountRow, PersonRow } from "./types";

const NONE = "__none";

export function PersonEditDialog({
  workspaceId,
  person,
  accounts,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  person: PersonRow | null;
  accounts: AccountRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [accountId, setAccountId] = useState(person?.accountId ?? "");
  const [seen, setSeen] = useState(person?.id ?? "");
  if (person && seen !== person.id) {
    setSeen(person.id);
    setName(person.name);
    setEmail(person.email ?? "");
    setAccountId(person.accountId ?? "");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit person</DialogTitle>
          <DialogDescription>
            The name and email are used when messages are written to them; the
            company decides which account their requests count towards.
          </DialogDescription>
        </DialogHeader>
        {person ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await updatePersonFields(workspaceId, person.id, {
                  name,
                  email,
                  accountId,
                });
                if (r.error) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Saved.");
                onOpenChange(false);
                router.refresh();
              });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="person-name">Name</Label>
              <Input
                id="person-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="person-email">Email</Label>
              <Input
                id="person-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={320}
                placeholder="No email yet"
              />
              <p className="text-xs text-muted-foreground">
                With an email, they can be written to and matched to verified
                votes.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="person-account">Company</Label>
              <Select
                value={accountId || NONE}
                onValueChange={(v) => setAccountId(v === NONE ? "" : v)}
              >
                <SelectTrigger id="person-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>(none)</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
