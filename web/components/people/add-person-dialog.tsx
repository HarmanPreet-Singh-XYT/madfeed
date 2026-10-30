"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createPersonAction } from "@/app/(app)/w/[workspaceId]/people/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

/** A Radix Select cannot use an empty string as a value; this stands in for "no company". */
const NONE = "__none";

export function AddPersonDialog({
  workspaceId,
  accounts,
  trigger,
}: {
  workspaceId: string;
  accounts: { id: string; name: string }[];
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [accountId, setAccountId] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    start(async () => {
      const data = new FormData();
      data.set("name", name);
      data.set("email", email);
      data.set("accountId", accountId);
      const r = await createPersonAction(workspaceId, undefined, data);
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Person added.");
      setName("");
      setEmail("");
      setAccountId("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>
            A name or an email is enough. The company decides which account
            their requests count towards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="add-person-name" className="mb-1 block text-sm font-medium">
                Name
              </Label>
              <Input
                id="add-person-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="add-person-email" className="mb-1 block text-sm font-medium">
                Email
              </Label>
              <Input
                id="add-person-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={320}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="add-person-company" className="mb-1 block text-sm font-medium">
                Company
              </Label>
              <Select
                value={accountId || NONE}
                onValueChange={(v) => setAccountId(v === NONE ? "" : v)}
              >
                <SelectTrigger id="add-person-company" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No company</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || (!name.trim() && !email.trim())}>
              {pending ? "Adding…" : "Add person"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
