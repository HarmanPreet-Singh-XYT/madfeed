"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// While the server is still reading the conversation, ask Next.js to re-render
// the page every couple of seconds. Stops as soon as it is finished.
export function SourceStatus({
  state,
  children,
}: {
  state: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const working = state === "pending" || state === "processing";
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [working, router]);
  return (
    <div role="status" aria-live="polite">
      {children}
    </div>
  );
}
