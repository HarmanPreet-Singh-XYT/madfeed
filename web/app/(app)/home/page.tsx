import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { getWorkspaces } from "@/lib/server/queries";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import { Loading } from "@/components/loading";
import { StandaloneFrame } from "@/components/app/standalone-frame";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Workspaces" };

export default function Home() {
  return (
    <StandaloneFrame>
      <Suspense fallback={<Loading />}>
        <Workspaces />
      </Suspense>
    </StandaloneFrame>
  );
}

const STEPS = [
  [
    "Paste a customer conversation",
    "A call, an email, a chat. Anything with customers talking.",
  ],
  [
    "Review what it found",
    "Each suggestion shows the customer's exact words. Accept the real ones.",
  ],
  [
    "See what matters",
    "Requests are weighed by the accounts behind them, each counted once.",
  ],
];

async function Workspaces() {
  const list = await getWorkspaces();
  if (list.length === 1) redirect(`/w/${list[0].id}`);

  if (list.length === 0) {
    return (
      <div className="grid gap-8 md:grid-cols-[1fr_1fr] md:gap-12">
        <div className="space-y-6">
          <PageHeader
            title="Welcome"
            description="Create a workspace for your team. Then paste a customer conversation and we'll find what they asked for."
          />
          <Card className="[--card-spacing:0px] p-6">
            <CreateWorkspaceForm />
          </Card>
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            What happens next
          </p>
          <ol className="space-y-3">
            {STEPS.map(([t, b], i) => (
              <Card
                key={t}
                asChild
                className="[--card-spacing:0px] flex-row items-start gap-4 p-4"
              >
                <li>
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-sm font-bold text-link"
                  >
                    {i + 1}
                  </span>
                  <span>
                    <span className="block font-display font-semibold">
                      {t}
                    </span>
                    <span className="text-sm text-muted-foreground">{b}</span>
                  </span>
                </li>
              </Card>
            ))}
          </ol>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check aria-hidden="true" className="size-4 text-hue-teal" />
            Nothing is sent to a customer without your approval.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <PageHeader
        title="Your workspaces"
        description="Pick up where you left off."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((w) => (
          <li key={w.id}>
            <Card
              asChild
              className="[--card-spacing:0px] p-0 shadow-card transition-[translate,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-raised"
            >
              <Link
                href={`/w/${w.id}`}
                className="group flex items-center gap-4 p-5"
              >
                <span
                  aria-hidden="true"
                  className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 font-display text-lg font-bold text-on-brand"
                >
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display font-semibold">
                    {w.name}
                  </span>
                  <span className="text-sm text-muted-foreground capitalize">
                    {w.role}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
