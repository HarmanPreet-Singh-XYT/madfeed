import { NextResponse } from "next/server";
import { assertPreview } from "@/lib/server/preview";
import { apiBase, apiFetch } from "@/lib/server/transport";

// Switches how the sample data behaves for this browser: normal, empty, slow or failing, and signed in or out.
// Only places inside the app can be returned to.
export async function GET(request: Request) {
  assertPreview();
  const q = new URL(request.url).searchParams;
  const to = q.get("to") ?? "/mock";
  const res = NextResponse.redirect(
    new URL(/^\/[A-Za-z0-9/_-]*$/.test(to) ? to : "/mock", request.url),
  );
  if (q.get("reset") === "1")
    await apiFetch(`${apiBase}/__mock/reset`, { method: "POST" });
  const set = q.get("set");
  if (set === "normal") res.cookies.delete("mock_scenario");
  else if (set && ["empty", "slow", "error"].includes(set))
    res.cookies.set("mock_scenario", set, { path: "/" });
  const session = q.get("session");
  if (session === "out") res.cookies.set("mock_session", "out", { path: "/" });
  else if (session === "in") res.cookies.delete("mock_session");
  return res;
}
