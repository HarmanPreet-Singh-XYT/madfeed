import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { query, signIn, sql, uniqueName } from "./helpers";

const WEB = "http://127.0.0.1:13000"; // development sign-in (the team)
const VOTERS = "http://127.0.0.1:13001"; // real email-and-password sign-in (their customers)

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

/** Exactly what the example on the settings page does, written out again here on purpose. */
function link(
  secret: string,
  slug: string,
  email: string,
  secondsLeft: number,
) {
  const payload = Buffer.from(
    JSON.stringify({
      e: email,
      x: Math.floor(Date.now() / 1000) + secondsLeft,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update("vote-v1." + payload)
    .digest("base64url");
  return `${WEB}/r/${slug}/roadmap?vt=v1.${payload}.${sig}`;
}

test("votes from known customers are marked verified, by a link from their own app or by their confirmed email", async ({
  page,
  browser,
}) => {
  const slug = `e2e7-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const tag = Date.now().toString(36);
  const dana = `dana-${tag}@acme.example`;
  const pat = `autoconfirm-pat${tag}@example.com`;

  await signIn(page, uniqueName("p7"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;

  // the company's directory has two customers; one request exists
  sql(`INSERT INTO account (workspace_id, name) VALUES ('${ws}', 'Acme Inc')`);
  const acct = query(`SELECT id FROM account WHERE workspace_id='${ws}'`)[0];
  sql(
    `INSERT INTO person (workspace_id, name, email, account_id) VALUES ('${ws}','Dana Lee','${dana}','${acct}'), ('${ws}','Pat Voter','${pat}',NULL)`,
  );
  sql(
    `INSERT INTO request (workspace_id, title) VALUES ('${ws}','Single sign-on')`,
  );

  await page.goto(`${workspaceUrl}/settings`);
  await expect(async () => {
    await page.getByLabel("Public address for release notes").fill(slug);
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.reload();
    await expect(
      page.getByLabel("Public address for release notes"),
    ).toHaveValue(slug, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.goto(`${workspaceUrl}/requests`);
  await page.getByRole("link", { name: "Single sign-on" }).click();
  await page.getByLabel("Title for the public").fill("Company sign-in");
  await page.getByLabel("Summary for the public").fill("Planned.");
  await page.getByRole("button", { name: "Show on public roadmap" }).click();
  await expect(page.locator("#public-state")).toContainText(
    "on the public roadmap",
  );
  const requestUrl = page.url();

  // --- a signing secret: made once, shown once
  await page.goto(`${workspaceUrl}/settings`);
  await expect(page.getByText(/No signing secret yet/)).toBeVisible();
  await page.getByRole("button", { name: "Create a signing secret" }).click();
  const secret = await page.getByLabel(/Your secret/).inputValue();
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  await accessible(page, "settings with verified voting");
  await page.reload();
  await expect(page.getByText("A signing secret exists.")).toBeVisible();
  expect(await page.content()).not.toContain(secret);

  // --- a user the company vouches for opens the link from their app: no account, verified
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await v.goto(link(secret, slug, dana, 3600));
  await expect(
    v.getByText("You're voting as a verified customer."),
  ).toBeVisible();
  await expect(v.getByText("0 votes")).toBeVisible();
  await accessible(v, "roadmap opened from the company's app");
  await v.getByRole("button", { name: /^Vote/ }).click();
  await expect(v.getByText("1 vote (1 from verified customers)")).toBeVisible();
  await v.reload();
  await expect(v.getByRole("button", { name: /Remove my vote/ })).toBeVisible();

  // the owner sees who, the public does not
  await page.goto(requestUrl);
  await expect(
    page.getByText(/1 public vote \(1 from verified customers\)/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Customers who voted" }),
  ).toBeVisible();
  await expect(page.getByText("Dana Lee · Acme Inc")).toBeVisible();
  const anon = await browser.newContext();
  const a = await anon.newPage();
  await a.goto(`${WEB}/r/${slug}/roadmap`);
  const html = await a.content();
  for (const private_ of ["Dana Lee", dana, "Acme Inc"])
    expect(html).not.toContain(private_);
  await anon.close();

  // links that must not work: expired, tampered, made for too long, signed with another key
  for (const bad of [
    link(secret, slug, dana, -60),
    link(secret, slug, dana, 3600).replace(/.$/, "A"),
    link(secret, slug, dana, 7 * 24 * 3600),
    link("0".repeat(64), slug, dana, 3600),
  ]) {
    await v.goto(bad);
    await expect(v.getByText(/voting link has expired/)).toBeVisible();
    await expect(v.getByRole("button", { name: /^Vote/ })).toHaveCount(0);
    await expect(
      v.getByRole("link", { name: "Sign in to vote" }),
    ).toBeVisible();
  }

  // --- a customer with an account: their confirmed email matches the directory
  const c2 = await browser.newContext({ baseURL: VOTERS });
  const p = await c2.newPage();
  await p.goto(`/r/${slug}/roadmap`);
  await p.getByRole("link", { name: "create an account" }).click();
  await p.getByLabel("Email address").fill(pat);
  await p.getByLabel("Password", { exact: true }).fill("long enough password");
  await p.getByLabel("Password again").fill("long enough password");
  await p.getByRole("button", { name: "Create account" }).click();
  await p.waitForURL((u) => u.pathname === `/r/${slug}/roadmap`);
  await expect(
    p.getByText(
      "Your email matches a customer, so your votes count as verified.",
    ),
  ).toBeVisible();
  await p.getByRole("button", { name: /^Vote/ }).click();
  await expect(
    p.getByText("2 votes (2 from verified customers)"),
  ).toBeVisible();

  // --- someone whose email is not in the directory: counted, not verified, and not told otherwise
  const c3 = await browser.newContext({ baseURL: VOTERS });
  const o = await c3.newPage();
  await o.goto(`/r/${slug}/roadmap`);
  await o.getByRole("link", { name: "create an account" }).click();
  await o
    .getByLabel("Email address")
    .fill(`autoconfirm-other${tag}@example.com`);
  await o.getByLabel("Password", { exact: true }).fill("long enough password");
  await o.getByLabel("Password again").fill("long enough password");
  await o.getByRole("button", { name: "Create account" }).click();
  await o.waitForURL((u) => u.pathname === `/r/${slug}/roadmap`);
  await expect(o.getByText(/votes count as verified/)).toHaveCount(0);
  await o.getByRole("button", { name: /^Vote/ }).click();
  await expect(
    o.getByText("3 votes (2 from verified customers)"),
  ).toBeVisible();

  // a new secret ends every old link at once
  await page.goto(`${workspaceUrl}/settings`);
  await page.getByRole("button", { name: /Make a new secret/ }).click();
  await expect(page.getByLabel(/Your secret/)).not.toHaveValue(secret);
  await v.goto(link(secret, slug, dana, 3600));
  await expect(v.getByText(/voting link has expired/)).toBeVisible();
  await ctx.close();
  await c2.close();
  await c3.close();
});
