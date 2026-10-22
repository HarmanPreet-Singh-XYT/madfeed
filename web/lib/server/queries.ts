import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { api, unwrap } from "./api";
import { isUuid } from "@/lib/text";

// React's cache() dedupes these within one request, so a layout and a page can
// both ask without calling the API twice.

export const getWorkspaces = cache(
  async () => unwrap(await (await api()).GET("/v1/workspaces")).workspaces,
);

export async function getWorkspace(workspaceId: string) {
  if (!isUuid(workspaceId)) notFound();
  const w = (await getWorkspaces()).find((x) => x.id === workspaceId);
  if (!w) notFound();
  return w;
}

export const getSource = cache(
  async (workspaceId: string, sourceItemId: string) => {
    if (!isUuid(workspaceId) || !isUuid(sourceItemId)) notFound();
    const res = await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/sources/{sourceItemId}", {
      params: { path: { workspaceId, sourceItemId } },
    });
    if (res.response.status === 404) notFound();
    return unwrap(res);
  },
);

export const getProposals = cache(
  async (
    workspaceId: string,
    state: "suggested" | "accepted" | "dismissed",
    limit = 100,
  ) => {
    const res = await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/proposals", {
      params: { path: { workspaceId }, query: { state, limit } },
    });
    return unwrap(res).proposals;
  },
);
