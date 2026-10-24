"use server";

import { headers } from "next/headers";
import { publicApi, toApiError } from "@/lib/server/api";
import { clientIp } from "@/lib/client-ip";

const TOKEN = /^[A-Za-z0-9._-]{20,120}$/;
const VISITOR = /^[A-Za-z0-9_-]{16,64}$/;

async function visitorHeaders(): Promise<Record<string, string>> {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  const ip = clientIp((await headers()).get("x-forwarded-for"), hops);
  return ip ? { "X-Forwarded-For": ip } : {};
}

export type ChatMessage = {
  seq: number;
  fromTeam: boolean;
  text: string;
  at: string;
};

export async function sendChatAction(
  token: string,
  origin: string,
  visitor: string,
  text: string,
  name: string,
  email: string,
): Promise<{ error?: string }> {
  if (!TOKEN.test(token) || !VISITOR.test(visitor))
    return { error: "This chat is not available." };
  const res = await publicApi().POST("/v1/public/chat/{token}/messages", {
    params: { path: { token } },
    body: {
      origin,
      visitor,
      text,
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
    },
    headers: await visitorHeaders(),
    cache: "no-store",
  });
  if (res.response.ok) return {};
  return { error: toApiError(res.response.status, res.error).message };
}

export async function pollChatAction(
  token: string,
  origin: string,
  visitor: string,
  after: number,
): Promise<{ error?: string; messages?: ChatMessage[] }> {
  if (!TOKEN.test(token) || !VISITOR.test(visitor))
    return { error: "This chat is not available." };
  const res = await publicApi().GET("/v1/public/chat/{token}/messages", {
    params: { path: { token }, query: { origin, visitor, after } },
    cache: "no-store",
  });
  if (res.data) return { messages: res.data.messages };
  return { error: toApiError(res.response.status, res.error).message };
}
