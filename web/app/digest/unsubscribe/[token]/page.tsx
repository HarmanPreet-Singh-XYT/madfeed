import { Suspense } from "react";
import { publicApi } from "@/lib/server/api";
import { Loading } from "@/components/loading";
import { DigestUnsubscribeForm } from "@/components/digest-unsubscribe-form";

export const metadata = {
  title: "Stop the weekly digest",
  robots: { index: false },
};

type Props = { params: Promise<{ token: string }> };

export default function DigestUnsubscribePage(props: Props) {
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
  const valid = /^[A-Za-z0-9_-]{20,200}$/.test(token);
  const res = valid
    ? await publicApi().GET("/v1/public/digest/unsubscribe/{token}", {
        params: { path: { token } },
        cache: "no-store",
      })
    : undefined;
  if (!res?.data) {
    return (
      <>
        <h1 className="text-2xl font-semibold">This link isn&apos;t valid</h1>
        <p className="text-muted">
          It may be incomplete or out of date. Ask a workspace admin to remove
          you from the weekly digest.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold">Stop the weekly digest?</h1>
      <p className="text-muted">
        We&apos;ll stop sending the weekly digest to{" "}
        <strong>{res.data.maskedEmail}</strong>. Nothing else changes.
      </p>
      <DigestUnsubscribeForm token={token} />
    </>
  );
}
