import { target, type ProxyContext } from "@/lib/server/media-proxy";

// The recording for the player, with byte ranges so seeking works.
export async function GET(request: Request, ctx: ProxyContext) {
  const t = await target(ctx, "/file");
  if (t instanceof Response) return t;
  const meta = await fetch(t.url.replace(/\/file$/, ""), {
    headers: { Authorization: `Bearer ${t.token}` },
    cache: "no-store",
  });
  if (!meta.ok) return new Response(null, { status: meta.status });
  const { mimeType } = (await meta.json()) as { mimeType: string };
  const range = request.headers.get("range");
  const res = await fetch(t.url, {
    headers: {
      Authorization: `Bearer ${t.token}`,
      ...(range ? { Range: range } : {}),
    },
    cache: "no-store",
    signal: request.signal,
  });
  if (!res.ok && res.status !== 206)
    return new Response(null, { status: res.status });
  const headers = new Headers({
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  for (const h of ["content-length", "content-range"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
