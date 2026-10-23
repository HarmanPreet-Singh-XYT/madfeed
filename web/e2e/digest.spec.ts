import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clearOutbox, outbox, signIn, sql, uniqueName } from "./helpers";

async function accessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help}`),
    `accessibility problems on ${label}`,
  ).toEqual([]);
}

test("weekly digest: set up, preview, delivered once to each person, unsubscribe", async ({
  page,
  browser,
}) => {
  await clearOutbox();
  const a = `ana-${Date.now().toString(36)}@example.com`;
  const b = `bo-${Date.now().toString(36)}@example.com`;

  await signIn(page, uniqueName("dg"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const workspaceId = workspaceUrl.split("/").pop()!;

  // something happened this week, so there is something to say
  sql(
    `INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ('${workspaceId}','paste','They said hello','h-${workspaceId}','00000000-0000-0000-0000-000000000001')`,
  );
  sql(
    `INSERT INTO request (workspace_id, title) VALUES ('${workspaceId}','Single sign-on')`,
  );

  await page.goto(`${workspaceUrl}/settings`);
  await accessible(page, "settings with the digest");
  const now = new Date();
  await page.getByLabel("Send the weekly digest").check();
  await page.getByLabel("Day").selectOption(String(now.getUTCDay()));
  await page.getByLabel("Hour (UTC)").selectOption(String(now.getUTCHours()));
  await page.getByLabel(/Who gets it/).fill(`${a}\n${b.toUpperCase()}\n${a}`);

  // turning it on needs the admin to confirm the people agreed
  await page.getByRole("button", { name: "Save digest settings" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("have agreed");
  // what was typed is still there after the error
  await expect(page.getByLabel("Send the weekly digest")).toBeChecked();
  await expect(page.getByLabel(/Who gets it/)).toHaveValue(
    `${a}\n${b.toUpperCase()}\n${a}`,
  );
  await page.waitForTimeout(1500);
  expect(
    (await outbox()).length,
    "nothing is sent before it is switched on",
  ).toBe(0);

  // a preview sends nothing
  await page.getByRole("button", { name: /Preview this week/ }).click();
  const preview = page.getByLabel("Digest preview");
  await expect(preview).toContainText("Weekly digest for");
  await expect(preview).toContainText("1 new conversation");
  await expect(preview).toContainText("Single sign-on");
  expect((await outbox()).length).toBe(0);

  await page.getByLabel(/have agreed to receive/).check();
  await page.getByRole("button", { name: "Save digest settings" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();

  // the worker checks every 2 seconds here (10 minutes normally): still exactly one email each
  await expect
    .poll(async () => (await outbox()).length, { timeout: 30_000 })
    .toBe(2);
  await page.waitForTimeout(6_000);
  const mail = await outbox();
  expect(mail).toHaveLength(2);
  expect(mail.map((m) => m.to[0]).sort()).toEqual([a, b].sort());
  expect(new Set(mail.map((m) => m.idempotencyKey)).size).toBe(2);
  for (const m of mail) {
    expect(m.to).toHaveLength(1);
    expect(m.subject).toMatch(/^Weekly digest: /);
    expect(m.text).toContain("1 new conversation");
    expect(m.text).toContain("Single sign-on");
    expect(m.headers?.["List-Unsubscribe"]).toContain("/digest/unsubscribe/");
    expect(m.text).not.toContain("They said hello"); // no customer text in the digest
  }

  // the link in the email: looking changes nothing, the button does
  const link = /(http:\/\/[^\s]+\/digest\/unsubscribe\/[A-Za-z0-9_-]+)/.exec(
    mail.find((m) => m.to[0] === a)!.text,
  )![1];
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(link);
  await expect(
    v.getByRole("heading", { name: "Stop the weekly digest?" }),
  ).toBeVisible();
  await expect(v.getByText(/a\*\*\*@example\.com/)).toBeVisible();
  await accessible(v, "digest unsubscribe");
  await page.goto(`${workspaceUrl}/settings`);
  await expect(page.getByText(/Unsubscribed, and not emailed/)).toHaveCount(0);
  await v.getByRole("button", { name: "Stop the digest" }).click();
  await expect(
    v.getByText(/won't get the weekly digest any more/),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Unsubscribed, and not emailed: /)).toContainText(
    a,
  );
  await v.goto(
    "http://127.0.0.1:13000/digest/unsubscribe/not-a-real-link-at-all",
  );
  await expect(v.getByText("This link isn't valid")).toBeVisible();
  await visitor.close();
});
