import { apiBase, apiFetch, sessionToken } from "@/lib/server/transport";
import { isUuid } from "@/lib/text";

// Downloads the quotes matching the filters on screen as CSV, with a token that
// stays on the server. Paged through the normal list endpoint, capped so a
// mistaken filter cannot pull the whole history in one go.
const CAP = 5000;
const PAGE = 100;

type Row = {
  kind: string;
  at: string;
  text: string;
  sourceTitle: string;
  sourceKind: string;
  requestTitle?: string;
  sentiment?: string;
  sentimentSource?: string;
  tags: { name: string }[];
};

const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
const SOURCE: Record<string, string> = {
  paste: "Pasted",
  recording: "Recording",
  form: "Website form",
  api: "API",
  chat: "Chat",
  survey: "Survey",
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  if (!isUuid(workspaceId)) return new Response("Not found", { status: 404 });
  const token = await sessionToken();
  if (!token)
    return new Response(null, { status: 303, headers: { Location: "/login" } });

  const sp = new URL(req.url).searchParams;
  const days = [7, 30, 90].includes(Number(sp.get("days")))
    ? Number(sp.get("days"))
    : 0;
  const base = new URLSearchParams();
  for (const key of ["tag", "sentiment", "source", "kind", "q"] as const) {
    const v = sp.get(key);
    if (v) base.set(key === "tag" ? "tagId" : key === "source" ? "sourceKind" : key, v);
  }
  if (sp.get("sort") === "oldest") base.set("sort", "oldest");
  if (days) base.set("since", new Date(Date.now() - days * 86_400_000).toISOString());

  const rows: Row[] = [];
  let afterAt = "";
  let afterId = "";
  for (let page = 0; page < Math.ceil(CAP / PAGE); page++) {
    const qs = new URLSearchParams(base);
    qs.set("limit", String(PAGE));
    if (afterAt && afterId) {
      qs.set("afterAt", afterAt);
      qs.set("afterId", afterId);
    }
    const res = await apiFetch(
      `${apiBase}/v1/workspaces/${workspaceId}/quotes?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (res.status === 401)
      return new Response(null, { status: 303, headers: { Location: "/login" } });
    if (!res.ok) return new Response("The export is not available.", { status: 404 });
    const body = (await res.json()) as {
      quotes: Row[];
      next?: { at: string; id: string };
    };
    rows.push(...body.quotes);
    if (!body.next || rows.length >= CAP) break;
    afterAt = body.next.at;
    afterId = body.next.id;
  }

  const lines = [
    ["Kind", "Quote", "Source", "Source type", "Request", "Tags", "Feeling", "Date"].join(","),
  ];
  for (const r of rows.slice(0, CAP)) {
    lines.push(
      [
        cell(r.kind === "highlight" ? "Highlight" : "Evidence"),
        cell(r.text),
        cell(r.sourceTitle || "A source"),
        cell(SOURCE[r.sourceKind] ?? r.sourceKind),
        cell(r.requestTitle ?? ""),
        cell(r.tags.map((t) => t.name).join("; ")),
        cell(
          r.sentiment
            ? `${r.sentiment}${r.sentimentSource === "model" ? " (model)" : ""}`
            : "not labelled",
        ),
        cell(new Date(r.at).toISOString()),
      ].join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="quotes-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
