import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { api, ApiError, toApiError } from "@/lib/server/api";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";

export const metadata = { title: "Connecting Slack", robots: { index: false } };

type Props = {
  searchParams: Promise<{ code?: string; state?: string; error?: string }>;
};

export default function SlackCallback(props: Props) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-16"
    >
      <h1 className="text-2xl font-semibold">Connecting Slack</h1>
      <Suspense fallback={<Loading />}>
        <Finish {...props} />
      </Suspense>
    </main>
  );
}

async function Finish({ searchParams }: Props) {
  const { code, state, error } = await searchParams;
  if (error || !code || !state || code.length > 200 || state.length > 600)
    return (
      <p className="text-muted-foreground">
        Slack did not finish the connection
        {error ? " (you may have cancelled it)" : ""}.{" "}
        <Link href="/" className={link}>
          Go back and try again
        </Link>
        .
      </p>
    );
  let workspaceId: string | undefined;
  let message: string | undefined;
  try {
    const client = await api(); // asks the person to sign in if they are not
    const res = await client.POST("/v1/integrations/slack/complete", {
      body: { code, state },
    });
    if (res.response.ok && res.data) workspaceId = res.data.workspaceId;
    else message = toApiError(res.response.status, res.error).message;
  } catch (e) {
    if (e instanceof ApiError) message = e.message;
    else throw e; // includes the redirect to sign-in
  }
  if (workspaceId) redirect(`/w/${workspaceId}/settings?tab=integrations`);
  return (
    <div className="space-y-2">
      <p role="alert" className="text-destructive">
        {message ?? "Something went wrong."}
      </p>
      <p>
        <Link href="/" className={link}>
          Go back
        </Link>{" "}
        and start again from Settings.
      </p>
    </div>
  );
}
