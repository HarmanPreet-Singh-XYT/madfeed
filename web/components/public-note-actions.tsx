"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { link } from "@/components/ui";

/** Share and follow, for a reader who is not signed in. */
export function PublicNoteActions({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The address bar still has it; nothing to recover from.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4 text-sm">
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? (
          <Check aria-hidden="true" />
        ) : (
          <Link2 aria-hidden="true" />
        )}
        {copied ? "Link copied" : "Copy link"}
      </Button>
      <a href={`/r/${slug}/feed.xml`} className={link}>
        Subscribe (RSS)
      </a>
      <Link href={`/r/${slug}`} className={`${link} ml-auto`}>
        All updates
      </Link>
    </div>
  );
}
