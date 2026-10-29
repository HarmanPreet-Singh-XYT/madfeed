import { apiBase, apiFetch, sessionToken } from "@/lib/server/transport";
import { isUuid } from "@/lib/text";

// Downloads the people matching the filters as CSV. The token stays on the
// server; the list endpoint is paged so a large directory is not truncated.
const CAP = 5000;
const PAGE = 100;

type Row = {
  name: string;
  email?: string;
  accountName?: string;
  quoteCount?: number;
  lastHeardAt?: string;
  createdAt?: string;
};

const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;

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
  const base = new URLSearchParams();
  for (const key of ["q", "accountId", "email"] as const) {
    const v = sp.get(key);
    if (v) base.set(key, v);
  }
  if (base.get("email") !== "with" && base.get("email") !== "without")
    base.delete("email");

  const rows: Row[] = [];
  let cursor = "";
  for (let page = 0; page < Math.ceil(CAP / PAGE); page++) {
    const qs = new URLSearchParams(base);
    qs.set("limit", String(PAGE));
    if (cursor) qs.set("cursor", cursor);
    const res = await apiFetch(
      `${apiBase}/v1/workspaces/${workspaceId}/people?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (res.status === 401)
      return new Response(null, { status: 303, headers: { Location: "/login" } });
    if (!res.ok) return new Response("The export is not available.", { status: 404 });
    const body = (await res.json()) as { people: Row[]; nextCursor?: string };
    rows.push(...body.people);
    if (!body.nextCursor || rows.length >= CAP) break;
    cursor = body.nextCursor;
  }

  const lines = [
    ["Name", "Email", "Company", "Quotes", "Last heard", "Added"].join(","),
  ];
  for (const p of rows.slice(0, CAP)) {
    lines.push(
      [
        cell(p.name),
        cell(p.email ?? ""),
        cell(p.accountName ?? ""),
        cell(String(p.quoteCount ?? 0)),
        cell(p.lastHeardAt ? new Date(p.lastHeardAt).toISOString() : ""),
        cell(p.createdAt ? new Date(p.createdAt).toISOString() : ""),
      ].join(","),
    );
  }
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="people-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
