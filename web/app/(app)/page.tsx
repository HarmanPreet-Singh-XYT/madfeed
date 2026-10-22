import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getWorkspaces } from "@/lib/server/queries";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import { Loading } from "@/components/loading";
import { card } from "@/components/ui";

export const metadata = { title: "Workspaces" };

export default function Home() {
  return (
    <Suspense fallback={<Loading />}>
      <Workspaces />
    </Suspense>
  );
}

async function Workspaces() {
  const list = await getWorkspaces();
  if (list.length === 1) redirect(`/w/${list[0].id}`);

  if (list.length === 0) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Welcome</h1>
          <p className="text-muted">
            Create a workspace for your team. Then paste a customer conversation
            and we&apos;ll find what they asked for.
          </p>
        </div>
        <CreateWorkspaceForm />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Your workspaces</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((w) => (
          <li key={w.id} className={card}>
            <Link
              href={`/w/${w.id}`}
              className="block font-medium underline-offset-2 hover:underline"
            >
              {w.name}
            </Link>
            <p className="text-sm text-muted">{w.role}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
