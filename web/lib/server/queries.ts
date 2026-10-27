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

/** The workspace and the caller's role in it, from the same call the navigation makes, so a page adds no request. */
export async function getWorkspace(workspaceId: string) {
  const { workspace, role } = await getShell(workspaceId);
  return { id: workspace.id, name: workspace.name, role };
}

/**
 * Everything the workspace navigation draws, in one API call: the workspace, what the caller may do, the tools
 * the plan switches on, the two waiting-work counts and the admin notices.
 */
export const getShell = cache(async (workspaceId: string) => {
  if (!isUuid(workspaceId)) notFound();
  const res = await (
    await api()
  ).GET("/v1/workspaces/{workspaceId}/shell", {
    params: { path: { workspaceId } },
  });
  if (res.response.status === 404) notFound();
  return unwrap(res);
});

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
