"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LocalTime } from "@/components/local-time";

export type QuoteHit = {
  kind: "evidence" | "highlight";
  id: string;
  text: string;
  sourceItemId: string;
  sourceTitle: string;
  sourceKind: string;
  at: string;
  score: number;
};

/** The meaning-search result list, on its own until the search is cleared. */
export function QuoteSearchResults({
  workspaceId,
  hits,
}: {
  workspaceId: string;
  hits: QuoteHit[];
}) {
  return (
    <ul className="space-y-2" aria-label="Quotes closest in meaning">
      {hits.map((h) => (
        <Card key={h.kind + h.id} asChild className="gap-0 py-3">
          <li className="space-y-2 px-4 text-sm">
            <p>“{h.text}”</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Link
                href={`/w/${workspaceId}/sources/${h.sourceItemId}`}
                className="hover:underline"
              >
                {h.sourceTitle || "A source"}
              </Link>
              <span>·</span>
              <LocalTime iso={h.at} />
              <span className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(
                        `“${h.text}” — ${h.sourceTitle || "a source"}, ${new Date(h.at).toLocaleDateString()}`,
                      )
                      .then(() => toast.success("Quote copied."))
                      .catch(() => toast.error("Your browser would not let us copy."))
                  }
                >
                  <Copy aria-hidden="true" /> Copy
                </Button>
                <Button asChild variant="ghost" size="xs">
                  <Link href={`/w/${workspaceId}/sources/${h.sourceItemId}`}>
                    <ExternalLink aria-hidden="true" /> Source
                  </Link>
                </Button>
              </span>
            </div>
          </li>
        </Card>
      ))}
    </ul>
  );
}
