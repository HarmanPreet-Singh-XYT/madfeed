import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { api, ApiError, toApiError } from "@/lib/server/api";
import { sessionToken } from "@/lib/server/transport";
import { Loading } from "@/components/loading";
import { AuthorizeAssistantForm } from "@/components/authorize-assistant-form";
import { SCOPE_TEXT } from "@/lib/scopes";

export const metadata = { title: "Connect an assistant" };

type Search = Record<string, string | string[] | undefined>;

export default function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-lg flex-1 space-y-6 px-4 py-12"
    >
      <h1 className="text-2xl font-semibold">Connect an AI assistant</h1>
      <Suspense fallback={<Loading />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : "";

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-muted-foreground">
      {children}
    </p>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const sp = await searchParams;
  const params = {
    client_id: one(sp.client_id),
    redirect_uri: one(sp.redirect_uri),
    code_challenge: one(sp.code_challenge),
    state: one(sp.state),
    resource: one(sp.resource),
  };
  if (
    !params.client_id ||
    !params.redirect_uri ||
    !params.code_challenge ||
    one(sp.code_challenge_method) !== "S256" ||
    one(sp.response_type) !== "code"
  )
    return (
      <Problem>
        This link is incomplete. Start again from the assistant you want to
        connect.
      </Problem>
    );
  // Sign in first, then come straight back to this exact request.
  if (!(await sessionToken())) {
    const back = new URLSearchParams();
    for (const [k, v] of Object.entries(sp))
      if (typeof v === "string") back.set(k, v);
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${back}`)}`);
  }
  const client = await api();
  const info = await client.GET("/v1/oauth/clients/{clientId}", {
    params: { path: { clientId: params.client_id } },
  });
  if (info.response.status === 401) redirect("/login");
  if (!info.response.ok || !info.data) {
    const e: ApiError = toApiError(info.response.status, info.error);
    return (
      <Problem>
        {info.response.status === 404
          ? "This assistant is not registered with us. Start again from the assistant."
          : e.message}
      </Problem>
    );
  }
  if (
    !info.data.redirectUris.includes(params.redirect_uri) &&
    !isLoopback(params.redirect_uri, info.data.redirectUris)
  )
    return (
      <Problem>
        The assistant asked to return to an address it did not register, so we
        stopped. Nothing was connected.
      </Problem>
    );
  const list = await client.GET("/v1/workspaces");
  if (list.response.status === 401) redirect("/login");
  const admin = (list.data?.workspaces ?? []).filter((w) => w.role === "admin");
  if (admin.length === 0)
    return (
      <Problem>
        Only a workspace admin can connect an assistant, and you are not an
        admin of any workspace.
      </Problem>
    );
  const requested = one(sp.scope)
    .split(/\s+/)
    .filter((s) => s in SCOPE_TEXT);
  return (
    <>
      <p>
        <strong>{info.data.name}</strong> wants to read from your feedback
        workspace. After you approve, you go back to it at{" "}
        <span className="font-mono">{hostOf(params.redirect_uri)}</span>.
      </p>
      <AuthorizeAssistantForm
        params={params}
        clientName={info.data.name}
        workspaces={admin.map((w) => ({ id: w.id, name: w.name }))}
        requested={requested.length > 0 ? requested : ["requests"]}
      />
    </>
  );
}

function hostOf(uri: string) {
  try {
    const u = new URL(uri);
    return u.host || `${u.protocol}//`;
  } catch {
    return "an address we could not read";
  }
}

// A program on this computer may pick its own free port; mirror the API's rule, which is the real check.
function isLoopback(uri: string, registered: string[]) {
  try {
    const u = new URL(uri);
    if (
      u.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    )
      return false;
    return registered.some((r) => {
      const x = new URL(r);
      return (
        x.protocol === "http:" &&
        x.hostname === u.hostname &&
        x.pathname === u.pathname &&
        x.search === u.search
      );
    });
  } catch {
    return false;
  }
}
