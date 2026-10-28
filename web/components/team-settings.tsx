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
import { btn, btnPrimary, field } from "./ui";
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
              <label htmlFor={`role-${m.userId}`} className="sr-only">
                Role of {who}
              </label>
              <select
                id={`role-${m.userId}`}
                value={m.role}
                disabled={pending}
                onChange={(e) =>
                  start(async () => {
                    const r = await setRoleAction(
                      workspaceId,
                      m.userId,
                      e.target.value as Role,
                    );
                    setError(r?.error);
                  })
                }
                className={`${field} w-44!`}
              >
                {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="text-muted-foreground">{m.role}</span>
          )}
          {canManage || m.isMe ? (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() => {
                const msg = m.isMe
                  ? "Leave this workspace? You will lose access to it."
                  : `Remove ${who} from this workspace? They lose access at once; what they wrote stays.`;
                if (!window.confirm(msg)) return;
                start(async () => {
                  const r = await removeMemberAction(
                    workspaceId,
                    m.userId,
                    m.isMe,
                  );
                  setError(r?.error);
                });
              }}
            >
              {m.isMe ? "Leave" : "Remove"}
              <span className="sr-only"> {who}</span>
            </button>
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
          <button
            type="button"
            className={btn}
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
          </button>
          <button
            type="button"
            className={btn}
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
          </button>
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await revokeInviteAction(workspaceId, i.id);
                setError(r?.error);
              })
            }
          >
            Cancel<span className="sr-only"> the invitation to {i.email}</span>
          </button>
        </span>
      </div>
      <label htmlFor={`link-${i.id}`} className="sr-only">
        Invitation link for {i.email}
      </label>
      <input
        id={`link-${i.id}`}
        readOnly
        value={i.link}
        className={`${field} font-mono text-xs`}
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
                <label
                  htmlFor="invite-email"
                  className="mb-1 block text-sm font-medium"
                >
                  Email address
                </label>
                <input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  maxLength={320}
                  autoComplete="off"
                  className={`${field} w-72`}
                />
              </div>
              <div>
                <label
                  htmlFor="invite-role"
                  className="mb-1 block text-sm font-medium"
                >
                  Role
                </label>
                <select
                  id="invite-role"
                  name="role"
                  defaultValue="member"
                  className={field}
                >
                  {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_HELP[r]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className={btnPrimary} disabled={pending}>
                Send invitation
              </button>
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
              <label htmlFor="invite-new-link" className="sr-only">
                Invitation link
              </label>
              <input
                id="invite-new-link"
                readOnly
                value={state.link}
                className={`${field} font-mono text-xs`}
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
