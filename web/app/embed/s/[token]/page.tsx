import { Suspense } from "react";
import { Loading } from "@/components/loading";
import { PublicSurvey } from "@/components/public-survey";
import { EmbedHeight } from "@/components/embed-height";

export const metadata = {
  title: "Survey",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

// The same survey without the page around it, for showing inside another site's page.
export default function EmbeddedSurveyPage({ params }: Props) {
  return (
    <main id="main" className="w-full space-y-6 p-4">
      <EmbedHeight />
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
