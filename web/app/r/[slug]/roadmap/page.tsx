import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { optionalApi, publicApi } from "@/lib/server/api";
import { VoteButton } from "@/components/vote-button";
import { Loading } from "@/components/loading";
import { link } from "@/components/ui";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ vt?: string }>;
};

const TOKEN = /^v1\.[A-Za-z0-9_-]{1,500}\.[A-Za-z0-9_-]{1,100}$/;

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `Roadmap · ${slug}` };
}

export default function PublicRoadmap(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Page {...props} />
    </Suspense>
  );
}

const columns = [
  { bucket: "active", title: "In progress" },
  { bucket: "open", title: "Planned" },
  { bucket: "done", title: "Shipped" },
] as const;

async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  const { vt } = await searchParams;
  const res = await publicApi().GET("/v1/public/sites/{slug}/roadmap", {
    params: { path: { slug } },
    cache: "no-store",
  });
  if (res.response.status === 404 || !res.data) notFound();
  const { workspaceName, items } = res.data;
  // Voting needs an account. Signed-in visitors see which ones they voted for.
  // A link signed by the company's own app (?vt=) lets its users vote without an account.
  let token: string | undefined;
  let linkExpired = false;
  let voted = new Set<string>();
  if (vt && TOKEN.test(vt)) {
    const mine = await publicApi().POST(
      "/v1/public/sites/{slug}/signed/votes",
      {
        params: { path: { slug } },
        body: { token: vt },
        cache: "no-store",
      },
    );
    if (mine.data) {
      token = vt;
      voted = new Set(mine.data.requestIds);
    } else linkExpired = true;
  }
  const client = token ? undefined : await optionalApi();
  let verifiedAccount = false;
  if (client) {
    const mine = await client.GET("/v1/sites/{slug}/votes", {
      params: { path: { slug } },
    });
    if (mine.data) {
      voted = new Set(mine.data.requestIds);
      verifiedAccount = mine.data.verified;
    }
  }
  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">
          What we&apos;re working on at {workspaceName}
        </h1>
        <p className="text-muted">
          <Link href={`/r/${slug}`} className={link}>
            See what&apos;s new
          </Link>
        </p>
      </header>
      {linkExpired ? (
        <p role="status" className="rounded-md border border-border px-3 py-2">
          This voting link has expired. Open the roadmap again from the app to
          vote.
        </p>
      ) : null}
      {token ? (
        <p role="status" className="text-sm text-muted">
          You&apos;re voting as a verified customer.
        </p>
      ) : null}
      {verifiedAccount ? (
        <p role="status" className="text-sm text-muted">
          Your email matches a customer, so your votes count as verified.
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-muted">Nothing is on the roadmap yet.</p>
      ) : (
        columns.map((c) => {
          const group = items.filter((i) => i.bucket === c.bucket);
          if (group.length === 0) return null;
          return (
            <section key={c.bucket} className="space-y-4">
              <h2 className="text-xl font-semibold">{c.title}</h2>
              <ul className="space-y-6">
                {group.map((i) => (
                  <li key={i.id} className="space-y-1">
                    <h3 className="text-lg font-medium">{i.title}</h3>
                    <p className="text-sm text-muted">{i.status}</p>
                    {i.summary ? <p>{i.summary}</p> : null}
                    {client || token ? (
                      <VoteButton
                        slug={slug}
                        requestId={i.id}
                        title={i.title}
                        votes={i.votes}
                        verifiedVotes={i.verifiedVotes}
                        voted={voted.has(i.id)}
                        token={token}
                      />
                    ) : (
                      <p className="text-sm text-muted">
                        {i.votes} {i.votes === 1 ? "vote" : "votes"}
                        {i.verifiedVotes > 0
                          ? ` (${i.verifiedVotes} from verified customers)`
                          : ""}{" "}
                        ·{" "}
                        <Link
                          href={`/login?next=/r/${slug}/roadmap`}
                          className={link}
                        >
                          Sign in to vote
                        </Link>{" "}
                        or{" "}
                        <Link
                          href={`/signup?next=/r/${slug}/roadmap`}
                          className={link}
                        >
                          create an account
                        </Link>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
