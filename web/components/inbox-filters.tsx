"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ANY = "any";
const NOBODY = "nobody";

/** Channel and handler narrow the queue; both live in the URL so a link keeps them. */
export function InboxFilters({
  base,
  view,
  q,
  channel,
  assignee,
  members,
}: {
  base: string;
  view: string;
  q: string;
  channel: string;
  assignee: string;
  members: { id: string; name: string }[];
}) {
  const router = useRouter();

  function go(next: { channel?: string; assignee?: string }) {
    const ch = next.channel ?? channel;
    const who = next.assignee ?? assignee;
    const p = new URLSearchParams();
    if (view !== "open") p.set("view", view);
    if (q) p.set("q", q);
    if (ch) p.set("channel", ch);
    if (who) p.set("assignee", who);
    const s = p.toString();
    router.push(s ? `${base}?${s}` : base);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={channel || ANY}
        onValueChange={(v) => go({ channel: v === ANY ? "" : v })}
      >
        <SelectTrigger className="min-h-11 w-40" aria-label="Which channel">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Every channel</SelectItem>
          <SelectItem value="chat">Website chat</SelectItem>
          <SelectItem value="email">Email</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={assignee || ANY}
        onValueChange={(v) => go({ assignee: v === ANY ? "" : v })}
      >
        <SelectTrigger className="min-h-11 w-44" aria-label="Who has it">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Anyone</SelectItem>
          <SelectItem value={NOBODY}>Nobody yet</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
