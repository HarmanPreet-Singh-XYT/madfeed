import Link from "next/link";
import { link } from "@/components/ui";
import { StandaloneFrame } from "@/components/app/standalone-frame";

export default function NotFound() {
  return (
    <StandaloneFrame>
      <div className="space-y-3 py-8">
        <h1 className="font-display text-2xl font-bold">
          We couldn&apos;t find that
        </h1>
        <p className="text-muted-foreground">
          It may have been removed, or you may not have access to it.
        </p>
        <Link href="/" className={link}>
          Back to your workspaces
        </Link>
      </div>
    </StandaloneFrame>
  );
}
