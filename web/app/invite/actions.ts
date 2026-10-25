"use server";

import { redirect } from "next/navigation";
import { api } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { unwrap } from "@/lib/server/api";

const TOKEN = /^m\.[0-9a-f]{32}\.[0-9a-f]{32}\.[A-Za-z0-9_-]{16,32}$/;

export async function acceptInviteAction(
  token: string,
  _prev: FormState,
): Promise<FormState> {
  void _prev;
  if (!TOKEN.test(token)) return { error: "That invitation link isn't valid." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/invitations/{token}/accept", {
        params: { path: { token } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  redirect(`/w/${res.value.workspaceId}`);
}
