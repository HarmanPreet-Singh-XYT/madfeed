import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { choose, query, signIn, sql, uniqueName } from "./helpers";

const API = "http://127.0.0.1:18080";

test("read-only API keys: made once, work, never shown again, stop when revoked", async ({
  page,
}) => {
  await signIn(page, uniqueName("ak"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO request (workspace_id, title) VALUES ('${ws}','Single sign-on')`,
  );

  await page.goto(`${workspaceUrl}/settings?tab=developers`);
  await expect(page.getByText("No active keys.")).toBeVisible();
  await page.getByLabel("Name for the new key").fill("Claude Desktop");
  // nothing selected is refused in plain words, and what was typed stays
  await page.getByLabel(/See requests/).uncheck();
  await page.getByLabel(/See customer quotes/).uncheck();
  await page.getByLabel(/Ask questions/).uncheck();
  await page.getByRole("button", { name: "Create a key" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("at least one");
  await expect(page.getByLabel("Name for the new key")).toHaveValue(
    "Claude Desktop",
  );
  await page.getByLabel(/See requests/).check();
  await page.getByLabel(/See customer quotes/).check();
  await page.getByLabel(/Add notes to the review queue/).check();
  await choose(page, "Lasts", "30 days");
  await page.getByRole("button", { name: "Create a key" }).click();
  const secret = await page.getByLabel(/Your new key/).inputValue();
  expect(secret).toMatch(/^fk_[A-Za-z0-9_-]{43}$/);
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    a11y.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);

  // it works against the real API, and sees this workspace only
  const ok = await fetch(`${API}/v1/ext/requests`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as { requests: { title: string }[] };
  expect(body.requests.map((r) => r.title)).toEqual(["Single sign-on"]);

  // the permissions it was given are the ones it has
  const asking = await fetch(`${API}/v1/ext/ask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: "What do customers say about sign-in?" }),
  });
  expect(asking.status).toBe(403); // "ask" was not ticked
  const note = await fetch(`${API}/v1/ext/feedback`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: "We would love SSO." }),
  });
  expect(note.status).toBe(202);
  expect(
    query(
      `SELECT count(*) FROM source_item WHERE workspace_id='${ws}' AND kind='api'`,
    )[0],
  ).toBe("1");

  // the same thing over the hosted MCP address
  const rpc = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(rpc.status).toBe(200);
  expect(await rpc.text()).toContain("search_requests");
  expect(
    (await fetch(`${API}/mcp`, { method: "POST", body: "{}" })).status,
  ).toBe(401);

  // the activity view shows what the key did. Uses are written in short batches, so the entries can land just
  // after the page loads: look again until they are there.
  const activity = page.getByRole("list", { name: "Recent activity" });
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/expires /)).toBeVisible();
    await page.getByRole("button", { name: "Show activity" }).click();
    await expect(activity).toContainText("list", { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
  await expect(activity).toContainText("submit");

  // the secret is gone after a reload, and only a hash is stored
  await page.reload();
  await expect(page.getByText(/^Your new key/)).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);
  await expect(page.getByText(secret.slice(0, 10) + "…")).toBeVisible();
  expect(
    query(
      `SELECT count(*) FROM api_key WHERE workspace_id='${ws}' AND position('${secret.slice(3)}' in to_jsonb(api_key)::text) > 0`,
    )[0],
  ).toBe("0");

  // revoking stops it at once
  await page.getByRole("button", { name: "Revoke Claude Desktop" }).click();
  await expect(page.getByText("No active keys.")).toBeVisible();
  const gone = await fetch(`${API}/v1/ext/requests`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(gone.status).toBe(401);
});
