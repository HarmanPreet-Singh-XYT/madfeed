"use server";

import { api, unwrap } from "@/lib/server/api";
import { attempt } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

export type QuoteHit = {
  kind: "evidence" | "highlight";
  id: string;
  text: string;
  sourceItemId: string;
  sourceTitle: string;
};

/**
 * Words in a stored quote, for the command palette. Only the words inside the
 * quote are matched; meaning search stays on the Quotes screen, where it can
 * say when it is not set up.
 */
export async function searchQuotesAction(
  workspaceId: string,
  words: string,
): Promise<{ hits?: QuoteHit[]; error?: string }> {
  if (!isUuid(workspaceId)) return { error: "That link is not valid." };
  const q = words.trim().slice(0, 200);
  if (q.length < 2) return { hits: [] };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/quotes", {
        params: { path: { workspaceId }, query: { q, limit: 5 } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  return {
    hits: (res.value.quotes ?? []).map((row) => ({
      kind: row.kind,
      id: row.id,
      text: row.text,
      sourceItemId: row.sourceItemId,
      sourceTitle: row.sourceTitle,
    })),
  };
}
