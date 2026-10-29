"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Says plainly when the browser is offline: the list on screen is the last one
 * loaded, and changes will not save until the connection is back.
 */
export function OfflineNotice() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    queueMicrotask(update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-sm"
    >
      <WifiOff aria-hidden="true" className="size-4 shrink-0" />
      You are offline. This is the last list that loaded; changes will not save
      until the connection is back.
    </p>
  );
}
