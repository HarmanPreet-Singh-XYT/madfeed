import { Suspense } from "react";
import { headers } from "next/headers";
import { publicApi } from "@/lib/server/api";
import { Loading } from "@/components/loading";
import { ChatWindow } from "@/components/chat-window";

export const metadata = {
  title: "Chat",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ o?: string }>;
};

const TOKEN = /^[A-Za-z0-9._-]{20,120}$/;

export default function ChatPage(props: Props) {
  return (
    <main id="main" className="flex-1">
      <Suspense fallback={<Loading />}>
        <Body {...props} />
      </Suspense>
    </main>
  );
}

// The site that shows the chat is read from the browser's own Referer when it sends one; the widget script also
// says which site it is on, for browsers that hide the Referer. The API checks it against the workspace's list.
async function showingSite(o?: string): Promise<string> {
  const ref = (await headers()).get("referer");
  if (ref) {
    try {
      return new URL(ref).origin;
    } catch {
      /* fall through */
    }
  }
  return typeof o === "string" ? o.slice(0, 255) : "";
}

async function Body({ params, searchParams }: Props) {
  const { token } = await params;
  const origin = await showingSite((await searchParams).o);
  const res =
    TOKEN.test(token) && origin
      ? await publicApi().GET("/v1/public/chat/{token}/config", {
          params: { path: { token }, query: { origin } },
          cache: "no-store",
        })
      : undefined;
  if (!res?.data)
    return (
      <p role="status" className="p-6 text-muted">
        This chat is not available on this page.
      </p>
    );
  return (
    <ChatWindow
      token={token}
      origin={origin}
      workspaceName={res.data.workspaceName}
      greeting={res.data.greeting}
    />
  );
}
