import { sameSite, target, type ProxyContext } from "@/lib/server/media-proxy";
import { apiFetch } from "@/lib/server/transport";

// One piece of a recording, streamed straight through to the API.
export async function PUT(request: Request, ctx: ProxyContext) {
  if (!sameSite(request))
    return Response.json({ error: "Not allowed." }, { status: 403 });
  const t = await target(ctx, "/chunk");
  if (t instanceof Response) return t;
  const offset = new URL(request.url).searchParams.get("offset") ?? "";
  if (!/^\d{1,15}$/.test(offset))
    return Response.json({ error: "Bad position." }, { status: 400 });
  const res = await apiFetch(`${t.url}?offset=${offset}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${t.token}`,
      "Content-Type": "application/octet-stream",
    },
    body: request.body,
    // @ts-expect-error Node's fetch needs this to stream a request body
    duplex: "half",
    cache: "no-store",
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
