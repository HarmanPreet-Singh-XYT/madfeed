import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signIn, sql, uniqueName } from "./helpers";

const API = "http://127.0.0.1:18080";
const CALLBACK = "http://127.0.0.1:53682/callback";

const b64 = (b: Buffer) => b.toString("base64url");

async function register(): Promise<string> {
  const r = await fetch(`${API}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude (browser test)",
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { client_id: string }).client_id;
}

test("an assistant connects through the approval page, works within what was approved, and is cut off by Disconnect", async ({
  page,
  context,
}) => {
  const owner = uniqueName("oa-owner");
  await signIn(page, owner);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO request (workspace_id, title) VALUES ('${ws}','Single sign-on')`,
  );
  // The assistant starts from a signed-out browser.
  await context.clearCookies();

  const client = await register();
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash("sha256").update(verifier).digest());
  const url =
    `/oauth/authorize?response_type=code&client_id=${client}` +
    `&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${challenge}` +
    `&code_challenge_method=S256&state=xyz&scope=requests%20quotes`;

  // Signed out: sign in first, and land back on the same request.
  await page.goto(url);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Your name").fill(uniqueName("oa"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect an AI assistant" }),
  ).toBeVisible();
  // This new person has no workspace of their own: only admins may connect an assistant.
  await expect(page.locator("p[role=alert]")).toContainText("not an admin");

  // The workspace owner is the one who approves.
  await context.clearCookies();
  await signIn(page, owner);
  await page.goto(url);
  await expect(page.getByText("Claude (browser test)").first()).toBeVisible();
  await expect(page.getByLabel(/See requests/)).toBeChecked();
  await expect(page.getByLabel(/See customer quotes/)).toBeChecked();
  await expect(page.getByLabel(/Ask questions/)).not.toBeChecked();
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    a11y.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);

  // Nothing listens on the assistant's return address; catch the browser going there.
  let returned = "";
  await page.route(`${CALLBACK}**`, async (route) => {
    returned = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "ok" });
  });
  await page.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => returned).toContain("code=");
  const back = new URL(returned);
  expect(back.searchParams.get("state")).toBe("xyz");

  // The assistant trades the code and works, but only inside the approval.
  const tr = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      redirect_uri: CALLBACK,
      client_id: client,
      code_verifier: verifier,
    }),
  });
  expect(tr.status).toBe(200);
  const tok = (await tr.json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
  };
  expect(tok.scope).toBe("requests quotes");
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  const ok = await fetch(`${API}/v1/ext/requests`, { headers: auth });
  expect(ok.status).toBe(200);
  expect(
    ((await ok.json()) as { requests: { title: string }[] }).requests.map(
      (r) => r.title,
    ),
  ).toEqual(["Single sign-on"]);
  const asking = await fetch(`${API}/v1/ext/ask`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What do customers say about sign-in?" }),
  });
  expect(asking.status).toBe(403);

  // The owner sees it under Settings, and Disconnect ends it at once.
  await page.goto(`${workspaceUrl}/settings?tab=developers`);
  await expect(
    page.locator("strong", { hasText: "Claude (browser test)" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Disconnect Claude (browser test)" })
    .click();
  await expect(page.getByText("No assistant has signed in yet.")).toBeVisible();
  expect(
    (await fetch(`${API}/v1/ext/requests`, { headers: auth })).status,
  ).toBe(401);
  const again = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tok.refresh_token,
      client_id: client,
    }),
  });
  expect(again.status).toBe(400);
});

test("refusing, or a request that does not match the registration, connects nothing", async ({
  page,
  context,
}) => {
  await signIn(page, uniqueName("od"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const client = await register();
  const challenge = b64(createHash("sha256").update("x").digest());
  const base = (redirect: string) =>
    `/oauth/authorize?response_type=code&client_id=${client}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=s`;

  await page.goto(base("https://evil.example/cb"));
  await expect(page.locator("p[role=alert]")).toContainText("did not register");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await page.goto("/oauth/authorize?client_id=nope");
  await expect(page.locator("p[role=alert]")).toContainText("incomplete");

  let returned = "";
  await page.route(`${CALLBACK}**`, async (route) => {
    returned = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "ok" });
  });
  await page.goto(base(CALLBACK));
  await page.getByRole("button", { name: "Not now" }).click();
  await expect.poll(() => returned).toContain("error=access_denied");
  expect(returned).not.toContain("code=");
  void context;
});
