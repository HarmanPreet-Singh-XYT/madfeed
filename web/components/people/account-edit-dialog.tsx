"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateAccountFields } from "@/app/(app)/w/[workspaceId]/people/actions";
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
import type { AccountRow } from "./types";

/** The company's name, value and renewal, in a dialog: the list stays where it was. */
export function AccountEditDialog({
  workspaceId,
  account,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  account: (AccountRow & { plan?: string; renewalDate?: string; domain?: string }) | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(account?.name ?? "");
  const [domain, setDomain] = useState(account?.domain ?? "");
  const [revenue, setRevenue] = useState(account?.revenue ?? "");
  const [plan, setPlan] = useState(account?.plan ?? "");
  const [renewalDate, setRenewalDate] = useState(account?.renewalDate ?? "");
  const [seen, setSeen] = useState(account?.id ?? "");
  if (account && seen !== account.id) {
    setSeen(account.id);
    setName(account.name);
    setDomain(account.domain ?? "");
    setRevenue(account.revenue ?? "");
    setPlan(account.plan ?? "");
    setRenewalDate(account.renewalDate ?? "");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    start(async () => {
      const r = await updateAccountFields(workspaceId, account.id, {
        name,
        domain,
        revenue,
        plan,
        renewalDate,
      });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.notice ?? "Saved.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit company</DialogTitle>
          <DialogDescription>
            Revenue is what a request from this company is worth, counted once
            per account, so impact can be ranked by money as well as by votes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="company-name" className="mb-1 block text-sm font-medium">
                Company name
              </Label>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>
            <div>
              <Label htmlFor="company-domain" className="mb-1 block text-sm font-medium">
                Domain
              </Label>
              <Input
                id="company-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                maxLength={200}
                placeholder="example.com"
              />
            </div>
            <div>
              <Label htmlFor="company-revenue" className="mb-1 block text-sm font-medium">
                Revenue
              </Label>
              <Input
                id="company-revenue"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                inputMode="decimal"
                placeholder="48000"
              />
            </div>
            <div>
              <Label htmlFor="company-plan" className="mb-1 block text-sm font-medium">
                Plan
              </Label>
              <Input
                id="company-plan"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                maxLength={100}
                placeholder="Annual"
              />
            </div>
            <div>
              <Label htmlFor="company-renewal" className="mb-1 block text-sm font-medium">
                Renewal date
              </Label>
              <Input
                id="company-renewal"
                type="date"
                value={renewalDate}
                onChange={(e) => setRenewalDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
