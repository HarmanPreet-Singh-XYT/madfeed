"use client";

import { toast } from "sonner";
import { Download, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Saves the transcript as a plain text file, and copies a link back to it. */
export function TranscriptActions({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  const safe =
    title
      .trim()
      .replace(/[^\w\- ]+/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "transcript";

  function download() {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied.");
    } catch {
      toast.error("Your browser wouldn't let us copy. Copy the address bar.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={download}
        className="border-on-brand/30 bg-on-brand/10 text-on-brand hover:bg-on-brand/20 hover:text-on-brand"
      >
        <Download aria-hidden="true" className="size-4" />
        Download text
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copy()}
        className="border-on-brand/30 bg-on-brand/10 text-on-brand hover:bg-on-brand/20 hover:text-on-brand"
      >
        <Link2 aria-hidden="true" className="size-4" />
        Copy link
      </Button>
    </div>
  );
}
