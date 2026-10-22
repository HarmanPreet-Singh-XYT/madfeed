import Link from "next/link";
import { link } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="space-y-3 py-8">
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that</h1>
      <p className="text-muted">
        It may have been removed, or you may not have access to it.
      </p>
      <Link href="/" className={link}>
        Back to your workspaces
      </Link>
    </div>
  );
}
