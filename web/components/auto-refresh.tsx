"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Asks the server for fresh data now and then while the page is open and in view. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
