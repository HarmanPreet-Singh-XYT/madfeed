"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createAccountAction } from "@/app/(app)/w/[workspaceId]/people/actions";
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

export function AddAccountDialog({
  workspaceId,
  trigger,
}: {
  workspaceId: string;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [revenue, setRevenue] = useState("");
  const [plan, setPlan] = useState("");
  const [renewalDate, setRenewalDate] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    start(async () => {
      const data = new FormData();
      data.set("name", name);
      data.set("revenue", revenue);
      data.set("plan", plan);
      data.set("renewalDate", renewalDate);
      const r = await createAccountAction(workspaceId, undefined, data);
      if (r?.error) {
        toast.error(r.error);
        return;
      }
      toast.success("Company added.");
      setName("");
      setRevenue("");
      setPlan("");
      setRenewalDate("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a company</DialogTitle>
          <DialogDescription>
            Revenue is optional, and so is everything else besides the name. It
            is what a request from this company is worth when impact is ranked.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="add-company-name" className="mb-1 block text-sm font-medium">
                Company name
              </Label>
              <Input
                id="add-company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="add-company-revenue" className="mb-1 block text-sm font-medium">
                Revenue <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="add-company-revenue"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                inputMode="decimal"
                placeholder="12000"
              />
            </div>
            <div>
              <Label htmlFor="add-company-plan" className="mb-1 block text-sm font-medium">
                Plan <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="add-company-plan"
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="add-company-renewal" className="mb-1 block text-sm font-medium">
                Renewal date <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="add-company-renewal"
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
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Adding…" : "Add company"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
