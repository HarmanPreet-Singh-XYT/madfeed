import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";

const baseUrl = process.env.API_URL ?? "http://127.0.0.1:8080";
const TOKEN = /^[A-Za-z0-9._-]{20,120}$/;
const VISITOR = /^[A-Za-z0-9_-]{16,64}$/;
const FILE = /^[0-9a-f-]{36}$/;

// A file from the visitor's own chat, always as a download. The API checks the site, the browser id and that the
// file belongs to this visitor's conversation.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const token = q.get("t") ?? "";
  const visitor = q.get("v") ?? "";
  const file = q.get("f") ?? "";
  const origin = (q.get("o") ?? "").slice(0, 255);
  if (!TOKEN.test(token) || !VISITOR.test(visitor) || !FILE.test(file))
    return new Response(null, { status: 404 });
  const res = await fetch(
    `${baseUrl}/v1/public/chat/${token}/attachments/${file}?origin=${encodeURIComponent(origin)}&visitor=${visitor}`,
    { cache: "no-store" },
  );
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        res.headers.get("content-disposition") ?? "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

const MAX = 5 * 1024 * 1024;

// A visitor's file, streamed to the API (which checks the site, the type and the size).
export async function POST(request: Request) {
  const q = new URL(request.url).searchParams;
  const token = q.get("t") ?? "";
  const visitor = q.get("v") ?? "";
  const origin = (q.get("o") ?? "").slice(0, 255);
  const name = (q.get("name") ?? "file").slice(0, 200) || "file";
  if (!TOKEN.test(token) || !VISITOR.test(visitor))
    return Response.json(
      { error: { message: "This chat is not available." } },
      { status: 404 },
    );
  const len = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(len) || len > MAX + 1024)
    return Response.json(
      { error: { message: "That file is larger than 5 MB." } },
      { status: 413 },
    );
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  const ip = clientIp((await headers()).get("x-forwarded-for"), hops);
  const res = await fetch(
    `${baseUrl}/v1/public/chat/${token}/attachments?${new URLSearchParams({ origin, visitor, name })}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        ...(ip ? { "X-Forwarded-For": ip } : {}),
      },
      body: request.body,
      // @ts-expect-error Node's fetch needs this to stream a request body
      duplex: "half",
      cache: "no-store",
    },
  );
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
