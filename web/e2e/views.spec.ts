import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { chooseFrom, signIn, sql, uniqueName } from "./helpers";

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

/** The Save view control is a button that opens a small form; fill it in and save, opening it first if it is closed. */
async function saveView(page: Page, name: string) {
  const form = page.getByRole("dialog");
  if (!(await form.isVisible()))
    await page.getByRole("button", { name: "Save view" }).click();
  await form.getByLabel("Save this view as").fill(name);
  await form.getByRole("button", { name: "Save view" }).click();
}

const TITLES = [
  "Single sign-on",
  "Slack alerts",
  "Slack digest",
  "100% uptime report",
  "Dark mode",
];

test("filter the request list, save a view, share it, remove it", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("views"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const url = page.url().replace(/\/add$/, "");
  const ws = url.split("/").pop()!;
  for (const [i, t] of TITLES.entries())
    sql(
      `INSERT INTO request (workspace_id, title, created_at) VALUES ('${ws}', '${t}', now() - interval '${i} minutes')`,
    );
  sql(
    `UPDATE request SET status_id = (SELECT id FROM status WHERE workspace_id='${ws}' AND name='Planned') WHERE workspace_id='${ws}' AND title LIKE 'Slack%'`,
  );
  sql(
    `INSERT INTO tag (workspace_id, name, created_by) VALUES ('${ws}', 'Security', '00000000-0000-0000-0000-000000000001')`,
  );
  sql(
    `INSERT INTO request_tag (workspace_id, request_id, tag_id) SELECT '${ws}', r.id, t.id FROM request r, tag t WHERE r.workspace_id='${ws}' AND t.workspace_id='${ws}' AND r.title='Single sign-on'`,
  );

  await page.goto(`${url}/requests`);
  const list = page
    .getByRole("list")
    .filter({ has: page.getByRole("link", { name: "Slack alerts" }) });
  await expect(
    page.getByRole("link", { name: "Single sign-on" }),
  ).toBeVisible();
  await accessible(page, "requests with filters");

  // filter by text: wildcard characters are just text
  await expect(async () => {
    await page.getByLabel("Search titles").fill("slack");
    await page.getByLabel("Search titles").press("Enter");
    await expect(page).toHaveURL(/q=slack/, { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Slack alerts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Slack digest" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dark mode" })).toHaveCount(0);
  await page.getByLabel("Search titles").fill("100%");
  await page.getByLabel("Search titles").press("Enter");
  await expect(
    page.getByRole("link", { name: "100% uptime report" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Slack alerts" })).toHaveCount(0);

  // nothing matches: say so, and offer the way out
  await page.getByLabel("Search titles").fill("zebra");
  await page.getByLabel("Search titles").press("Enter");
  await expect(
    page.getByText("No requests match these filters."),
  ).toBeVisible();
  await accessible(page, "no matches");

  // status + save the view
  await page.getByLabel("Search titles").fill("");
  await page.getByLabel("Search titles").press("Enter");
  await chooseFrom(page.locator("#f-status"), "Planned");
  await expect(page.getByRole("link", { name: "Slack digest" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Single sign-on" })).toHaveCount(
    0,
  );
  await saveView(page, "Planned work");
  await expect(page.getByText("Saved “Planned work”.")).toBeVisible();
  const saved = page.getByRole("navigation", { name: "Saved views" });
  await expect(
    saved.getByRole("link", { name: "Planned work" }),
  ).toHaveAttribute("aria-current", "page");
  // a name already used is refused in plain words
  await saveView(page, "planned WORK");
  await expect(
    page.getByText("a view with that name already exists"),
  ).toBeVisible();

  // a tag view too, then clearing filters shows everything again
  await page.getByRole("link", { name: "Clear all" }).click();
  await expect(page.getByRole("link", { name: "Dark mode" })).toBeVisible();
  await chooseFrom(page.locator("#f-tag"), "Security");
  await expect(
    page.getByRole("link", { name: "Single sign-on" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Dark mode" })).toHaveCount(0);
  await saveView(page, "Security asks");
  await expect(
    saved.getByRole("link", { name: "Security asks" }),
  ).toBeVisible();

  // using a saved view applies its filters
  await page.getByRole("link", { name: "Clear all" }).click();
  await saved.getByRole("link", { name: "Planned work" }).click();
  await expect(page).toHaveURL(/status=/);
  await expect(page.getByRole("link", { name: "Slack alerts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Single sign-on" })).toHaveCount(
    0,
  );
  await accessible(page, "saved views");

  // a viewer sees and can use the views, but cannot save or remove any
  const ctx = await browser.newContext();
  const vp = await ctx.newPage();
  await signIn(vp, uniqueName("viewer-views"));
  const token = (await ctx.cookies()).find((c) => c.name === "session")!.value;
  const sub = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ).sub as string;
  sql(
    `INSERT INTO member (workspace_id, user_id, role) VALUES ('${ws}', '${sub}', 'viewer')`,
  );
  await vp.goto(`${url}/requests`);
  await vp
    .getByRole("navigation", { name: "Saved views" })
    .getByRole("link", { name: "Security asks" })
    .click();
  await expect(vp.getByRole("link", { name: "Single sign-on" })).toBeVisible();
  await expect(vp.getByRole("button", { name: "Save view" })).toHaveCount(0);
  await expect(vp.getByRole("button", { name: /^Remove view/ })).toHaveCount(0);
  await ctx.close();

  // the creator removes one; it asks first
  await page.getByRole("button", { name: "Remove view Security asks" }).click();
  await expect(
    page.getByText("Remove the saved view “Security asks” for everyone?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(saved.getByRole("link", { name: "Security asks" })).toHaveCount(
    0,
  );
  await expect(saved.getByRole("link", { name: "Planned work" })).toBeVisible();
  void list;
});
