import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { query, signIn, sql, uniqueName } from "./helpers";

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

  await page.goto(`${workspaceUrl}/settings`);
  await expect(page.getByText("No active keys.")).toBeVisible();
  await page.getByLabel("Name for the new key").fill("Claude Desktop");
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
