import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { PublicSurvey } from "@/components/public-survey";

export const metadata = {
  title: "Survey",
  robots: { index: false, follow: false },
  // The link is the credential: do not pass it on to other sites.
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

export default function SurveyLinkPage({ params }: Props) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-12"
    >
      <Suspense fallback={<Loading />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}

async function Body({ params }: Props) {
  const { token } = await params;
  return <PublicSurvey token={token} />;
}
