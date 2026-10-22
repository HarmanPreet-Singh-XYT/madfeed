import { Suspense } from "react";
import { publicApi } from "@/lib/server/api";
import { Loading } from "@/components/loading";
import { UnsubscribeForm } from "@/components/unsubscribe-form";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

export default function UnsubscribePage(props: Props) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-16"
    >
      <Suspense fallback={<Loading />}>
        <Content {...props} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: Props) {
  const { token } = await params;
  // Opening this page changes nothing (mail scanners open links); only the button does.
  const valid = /^[A-Za-z0-9_-]{20,600}$/.test(token);
  const res = valid
    ? await publicApi().GET("/v1/public/unsubscribe/{token}", {
        params: { path: { token } },
        cache: "no-store",
      })
    : undefined;
  if (!res?.data) {
    return (
      <>
        <h1 className="text-2xl font-semibold">This link isn&apos;t valid</h1>
        <p className="text-muted">
          It may be incomplete or out of date. If you still get emails you
          don&apos;t want, reply to one and ask to be removed.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold">Stop these emails?</h1>
      <p className="text-muted">
        We&apos;ll stop sending product update emails to{" "}
        <strong>{res.data.maskedEmail}</strong>. You can still use the product
        as normal.
      </p>
      <UnsubscribeForm token={token} />
    </>
  );
}
