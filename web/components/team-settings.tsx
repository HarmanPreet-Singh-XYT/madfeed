"use client";

import { useActionState, useState, useTransition } from "react";
import {
  inviteAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
  setRoleAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocalTime } from "./local-time";

type Role = "admin" | "member" | "viewer";
type Member = { userId: string; name: string; role: Role; isMe: boolean };
type Invite = {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  link: string;
};

const ROLE_HELP: Record<Role, string> = {
  admin: "Admin: everything, including billing, connections and the team",
  member: "Member: add, review, reply and edit",
  viewer: "Viewer: read and search only",
};

function MemberRow({
  workspaceId,
  m,
  canManage,
}: {
  workspaceId: string;
  m: Member;
  canManage: boolean;
}) {
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const who = m.name || "A teammate who has not chosen a name";
  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong>{who}</strong>
          {m.isMe ? (
            <span className="text-muted-foreground"> (you)</span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <>
              <Label htmlFor={`role-${m.userId}`} className="sr-only">
                Role of {who}
              </Label>
              <Select
                value={m.role}
                disabled={pending}
                onValueChange={(value) =>
                  start(async () => {
                    const r = await setRoleAction(
                      workspaceId,
                      m.userId,
                      value as Role,
                    );
                    setError(r?.error);
                  })
                }
              >
                <SelectTrigger id={`role-${m.userId}`} className="w-44!">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <span className="text-muted-foreground">{m.role}</span>
          )}
          {canManage || m.isMe ? (
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  {m.isMe ? "Leave" : "Remove"}
                  <span className="sr-only"> {who}</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {m.isMe
                      ? "Leave this workspace?"
                      : `Remove ${who} from this workspace?`}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {m.isMe
                      ? "You will lose access to it."
                      : "They lose access at once; what they wrote stays."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>
                    Keep it
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={pending}
                    onClick={(event) => {
                      event.preventDefault();
                      start(async () => {
                        const r = await removeMemberAction(
                          workspaceId,
                          m.userId,
                          m.isMe,
                        );
                        setError(r?.error);
                        setConfirming(false);
                      });
                    }}
                  >
                    {m.isMe ? "Leave" : "Remove"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </span>
      </div>
      <FormError message={error} />
    </li>
  );
}

function InviteRow({ workspaceId, i }: { workspaceId: string; i: Invite }) {
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong>{i.email}</strong> as {i.role}
          <span className="block text-muted-foreground">
            Expires <LocalTime iso={i.expiresAt} />
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await navigator.clipboard.writeText(i.link);
                  setNote("Link copied.");
                } catch {
                  setNote("Copy the link from the box below.");
                }
              })
            }
          >
            Copy link<span className="sr-only"> for {i.email}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await resendInviteAction(workspaceId, i.id);
                setError(r.error);
                setNote(
                  r.error
                    ? undefined
                    : r.emailQueued
                      ? "Sent again, and extended by 7 days."
                      : "Extended by 7 days. Email is not set up here, so copy the link and send it yourself.",
                );
              })
            }
          >
            Send again<span className="sr-only"> to {i.email}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await revokeInviteAction(workspaceId, i.id);
                setError(r?.error);
              })
            }
          >
            Cancel<span className="sr-only"> the invitation to {i.email}</span>
          </Button>
        </span>
      </div>
      <Label htmlFor={`link-${i.id}`} className="sr-only">
        Invitation link for {i.email}
      </Label>
      <Input
        id={`link-${i.id}`}
        readOnly
        value={i.link}
        className="font-mono text-xs"
      />
      <FormError message={error} />
      {note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
    </li>
  );
}

export function TeamSettings({
  workspaceId,
  members,
  invites,
  emailEnabled,
  isAdmin,
}: {
  workspaceId: string;
  members: Member[];
  invites: Invite[];
  emailEnabled: boolean;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(
    inviteAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Everyone here can see this workspace&apos;s customer conversations, as
        far as their role allows.
        {isAdmin
          ? " Invite people by email; they join when they sign in with that address."
          : " Only admins can invite people or change roles."}
      </p>
      <ul
        className="divide-y divide-border rounded-xl border border-border px-4 text-sm"
        aria-label="Team members"
      >
        {members.map((m) => (
          <MemberRow
            key={m.userId}
            workspaceId={workspaceId}
            m={m}
            canManage={isAdmin}
          />
        ))}
      </ul>
      {isAdmin ? (
        <>
          <form method="post" onSubmit={keepForm(action)} className="space-y-3">
            <p className="text-sm font-medium">Invite someone</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label
                  id="invite-email-label"
                  htmlFor="invite-email"
                  className="mb-1 block text-sm font-medium"
                >
                  Email address
                </Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  maxLength={320}
                  autoComplete="off"
                  className="w-72"
                />
              </div>
              <div>
                <Label
                  id="invite-role-label"
                  htmlFor="invite-role"
                  className="mb-1 block text-sm font-medium"
                >
                  Role
                </Label>
                <Select name="role" defaultValue="member">
                  <SelectTrigger
                    id="invite-role"
                    aria-labelledby="invite-role-label"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_HELP[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={pending}>
                Send invitation
              </Button>
            </div>
            <FormError message={state?.error} />
          </form>
          {state?.link ? (
            <div
              role="status"
              className="space-y-2 rounded-xl border border-border p-3"
            >
              <p className="text-sm font-medium">
                {state.emailQueued
                  ? `An email is on its way to ${state.email}.`
                  : `Email isn't set up here, so nothing was sent. Copy this link and send it to ${state.email} yourself.`}
              </p>
              <Label
                id="invite-new-link-label"
                htmlFor="invite-new-link"
                className="sr-only"
              >
                Invitation link
              </Label>
              <Input
                id="invite-new-link"
                readOnly
                value={state.link}
                className="font-mono text-xs"
              />
              <p className="text-sm text-muted-foreground">
                The link works for 7 days and only for someone who signs in with
                that exact, confirmed email address.
              </p>
            </div>
          ) : null}
          <div>
            <h3 className="text-sm font-medium">Waiting to be used</h3>
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open invitations.
              </p>
            ) : (
              <ul
                className="divide-y divide-border text-sm"
                aria-label="Open invitations"
              >
                {invites.map((i) => (
                  <InviteRow key={i.id} workspaceId={workspaceId} i={i} />
                ))}
              </ul>
            )}
            {!emailEnabled ? (
              <p className="mt-2 text-sm text-muted-foreground">
                This server can&apos;t send email yet, so invitations are not
                emailed: copy each link and send it yourself.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
