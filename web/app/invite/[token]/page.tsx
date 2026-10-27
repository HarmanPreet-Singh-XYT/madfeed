import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Loading } from "@/components/loading";
import { InviteActions } from "@/components/invite-actions";
import { api } from "@/lib/server/api";
import { sessionToken } from "@/lib/server/transport";
import { link } from "@/components/ui";

export const metadata = { title: "Join a workspace", robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default function InvitePage(props: Props) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Join a workspace</h1>
      <Suspense fallback={<Loading />}>
        <Invite {...props} />
      </Suspense>
    </main>
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
      <p>
        This invitation link isn&apos;t valid. Check that you opened the whole
        link, or ask the person who invited you to send a new one.
      </p>
    );
  if (p.state === "accepted" || p.alreadyMember)
    return (
      <div className="space-y-3">
        <p>
          {p.alreadyMember
            ? `You are already in ${p.workspaceName}.`
            : "This invitation has already been used."}
        </p>
        <Link href="/home" className={link}>
          Go to your workspaces
        </Link>
      </div>
    );
  if (p.state === "expired")
    return (
      <p>
        This invitation to <strong>{p.workspaceName}</strong> has expired. Ask
        an admin to send you a new one.
      </p>
    );
  if (p.state === "revoked")
    return (
      <p>
        This invitation to <strong>{p.workspaceName}</strong> was cancelled. Ask
        an admin if you think that is a mistake.
      </p>
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
