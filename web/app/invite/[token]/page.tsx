import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Loading } from "@/components/loading";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { InviteActions } from "@/components/invite-actions";
import { api } from "@/lib/server/api";
import { sessionToken } from "@/lib/server/transport";

export const metadata = { title: "Join a workspace", robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default function InvitePage(props: Props) {
  return (
    <AuthShell
      title="Join a workspace"
      lead="You have been invited to work with a team here."
    >
      <Suspense fallback={<Loading />}>
        <Invite {...props} />
      </Suspense>
    </AuthShell>
  );
}

async function Invite({ params }: Props) {
  const { token } = await params;
  if (!(await sessionToken()))
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const res = await (
    await api()
  ).GET("/v1/invitations/{token}", {
    params: { path: { token } },
  });
  if (res.response.status === 401)
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const p = res.data;
  if (!p)
    return (
      <div className="space-y-3">
        <p className="font-medium">This invitation link isn&apos;t valid</p>
        <p className="text-muted-foreground">
          Check that you opened the whole link, or ask the person who invited
          you to send a new one.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  if (p.state === "accepted" || p.alreadyMember)
    return (
      <div className="space-y-3">
        <p className="font-medium">
          {p.alreadyMember
            ? `You are already in ${p.workspaceName}`
            : "This invitation has already been used"}
        </p>
        <p className="text-muted-foreground">
          {p.alreadyMember
            ? "Open it from your workspaces."
            : "Ask an admin to send you a new one if you still need access."}
        </p>
        <Button asChild className="w-full">
          <Link href="/home">Go to your workspaces</Link>
        </Button>
      </div>
    );
  if (p.state === "expired")
    return (
      <div className="space-y-3">
        <p className="font-medium">This invitation has expired</p>
        <p className="text-muted-foreground">
          The invitation to <strong>{p.workspaceName}</strong> can no longer be
          used. Ask an admin to send you a new one.
        </p>
      </div>
    );
  if (p.state === "revoked")
    return (
      <div className="space-y-3">
        <p className="font-medium">This invitation was cancelled</p>
        <p className="text-muted-foreground">
          The invitation to <strong>{p.workspaceName}</strong> was withdrawn. Ask
          an admin if you think that is a mistake.
        </p>
      </div>
    );
  return (
    <InviteActions
      token={token}
      workspace={p.workspaceName}
      role={p.role}
      email={p.email}
      canAccept={p.canAccept}
    />
  );
}
