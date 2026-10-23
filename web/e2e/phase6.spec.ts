import AxeBuilder from "@axe-core/playwright";
import { createServer, type Server } from "node:http";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { query, seedProposals, signIn, uniqueName } from "./helpers";

const API = "http://127.0.0.1:18080";
/** A customer's website, really served from its own address (the browser treats such a page differently from a faked one). */
function serveSite(port: number): Promise<Server> {
  return new Promise((resolve) => {
    const srv = createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Customer site</title>");
    }).listen(port, "127.0.0.1", () => resolve(srv));
  });
}

const SITE = "http://127.0.0.1:4010"; // a customer's website
const OTHER_SITE = "http://127.0.0.1:4011";
const QUOTE = "Please add single sign-on, our security team insists.";

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

async function noSideways(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

/**
 * A real browser on a customer's own website (a stand-in page at that address) posts to the
 * form, preflight and all. Returns the status, or 0 when the browser itself refused.
 */
async function browserPost(
  browser: Browser,
  origin: string,
  slug: string,
  key: string,
  text: string,
) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${origin}/`);
  const status = await page.evaluate(
    async ([api, s, k, t]) => {
      try {
        const r = await fetch(`${api}/v1/public/sites/${s}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: k,
            text: t,
            email: "Visitor@Example.com",
          }),
        });
        return r.status;
      } catch {
        return 0; // the browser refused (cross-site check)
      }
    },
    [API, slug, key, text],
  );
  await ctx.close();
  return status;
}

test("website feedback form and public roadmap, end to end", async ({
  page,
  browser,
}) => {
  const sites = await Promise.all([serveSite(4010), serveSite(4011)]);
  const slug = `e2e6-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await signIn(page, uniqueName("p6"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const workspaceId = workspaceUrl.split("/").pop()!;

  // --- the form needs a public address first
  await page.goto(`${workspaceUrl}/settings`);
  // both the website form and verified voting wait for the public address
  await expect(page.getByText("Set a public address above first")).toHaveCount(
    2,
  );
  await expect(async () => {
    await page.getByLabel("Public address for release notes").fill(slug);
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.reload();
    await expect(
      page.getByLabel("Public address for release notes"),
    ).toHaveValue(slug, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // --- turn it on for one site; a bad entry is refused in plain words
  await page.getByLabel(/Websites allowed/).fill("*");
  await page.getByRole("button", { name: "Turn the form on" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("allowed site");
  await page.getByLabel(/Websites allowed/).fill("https://www.example.com");
  await page.getByRole("button", { name: "Turn the form on" }).click();
  await expect(page.getByLabel("Embed code")).toBeVisible();
  const embed = await page.getByLabel("Embed code").inputValue();
  const key = /key: "([0-9a-f]{48})"/.exec(embed)![1];
  expect(embed).toContain(`/v1/public/sites/${slug}/feedback`);
  await accessible(page, "settings with the form on");
  await noSideways(page);

  // --- a real browser on a site that is not allowed is stopped by the browser itself
  expect(await browserPost(browser, SITE, slug, key, QUOTE)).toBe(0);

  // --- allow that site (http is accepted for the local machine only) and it goes through;
  // a different site with the same key is still stopped
  await page.getByLabel(/Websites allowed/).fill(SITE);
  await page.getByRole("button", { name: "Save sites" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();
  expect(await browserPost(browser, SITE, slug, key, QUOTE)).toBe(202);
  expect(await browserPost(browser, SITE, slug, key, QUOTE)).toBe(202); // sending it again stores nothing new
  expect(await browserPost(browser, OTHER_SITE, slug, key, QUOTE)).toBe(0);
  expect(
    query(
      `SELECT count(*) FROM source_item WHERE workspace_id='${workspaceId}' AND kind='form'`,
    )[0],
  ).toBe("1");

  // --- it waits in the review queue like anything else, and nothing exists until a person accepts
  const sourceId = query(
    `SELECT id FROM source_item WHERE workspace_id='${workspaceId}' AND kind='form'`,
  )[0];
  seedProposals(sourceId, [
    { quote: QUOTE, title: "Single sign-on", confidence: 0.9 },
  ]);
  await page.goto(`${workspaceUrl}/requests`);
  await expect(page.getByRole("link", { name: "Single sign-on" })).toHaveCount(
    0,
  );
  await page.goto(`${workspaceUrl}/review`);
  await page.getByRole("button", { name: "Accept as a request" }).click();
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();

  // --- the roadmap is empty and private until someone decides
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(`/r/${slug}/roadmap`);
  await expect(pub.getByText("Nothing is on the roadmap yet.")).toBeVisible();

  await page.goto(`${workspaceUrl}/requests`);
  await page.getByRole("link", { name: "Single sign-on" }).click();
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(page.locator("#public-state")).toContainText("Private");
  await page.getByRole("button", { name: "Show on public roadmap" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("public title");
  await page.getByLabel("Title for the public").fill("Company sign-in");
  await page
    .getByLabel("Summary for the public")
    .fill("Sign in with your company account.");
  await page.getByRole("button", { name: "Show on public roadmap" }).click();
  await expect(page.locator("#public-state")).toContainText(
    "on the public roadmap",
  );

  // --- visitors see the title, the summary and the status, and nothing else
  await pub.goto(`/r/${slug}/roadmap`);
  await expect(
    pub.getByRole("heading", { name: "Company sign-in", level: 3 }),
  ).toBeVisible();
  await expect(
    pub.getByText("Sign in with your company account."),
  ).toBeVisible();
  const html = await pub.content();
  for (const secret of [
    "Single sign-on", // the request's own title
    QUOTE,
    "visitor@example.com",
    "Visitor",
    sourceId,
    workspaceId,
  ]) {
    expect(html.toLowerCase(), `public page contains ${secret}`).not.toContain(
      secret.toLowerCase(),
    );
  }
  await accessible(pub, "public roadmap");
  await noSideways(pub);

  // --- voting needs an account: a visitor is sent to sign in and comes straight back
  await expect(pub.getByText("0 votes")).toBeVisible();
  await pub.getByRole("link", { name: "Sign in to vote" }).click();
  await expect(pub).toHaveURL(new RegExp(`/login\\?next=/r/${slug}/roadmap`));
  await pub.getByLabel("Your name").fill(uniqueName("voter"));
  await pub.getByRole("button", { name: "Sign in" }).click();
  await expect(pub).toHaveURL(new RegExp(`/r/${slug}/roadmap$`));
  await expect(pub.getByText("0 votes")).toBeVisible();
  await pub.getByRole("button", { name: /^Vote/ }).click();
  await expect(pub.getByText("1 vote", { exact: true })).toBeVisible();
  await expect(
    pub.getByRole("button", { name: /Remove my vote/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await pub.reload(); // the vote is kept, and shown as the visitor's own
  await expect(pub.getByText("1 vote", { exact: true })).toBeVisible();
  await expect(
    pub.getByRole("button", { name: /Remove my vote/ }),
  ).toBeVisible();
  await accessible(pub, "public roadmap with voting");
  await noSideways(pub);
  // the owner sees the count on the request
  await page.goto(`${workspaceUrl}/requests`);
  await page.getByRole("link", { name: "Single sign-on" }).click();
  await expect(page.getByText(/1 public vote/)).toBeVisible();
  await pub.getByRole("button", { name: /Remove my vote/ }).click();
  await expect(pub.getByText("0 votes")).toBeVisible();

  // --- the internal roadmap lists it by stage
  await page.goto(`${workspaceUrl}/roadmap`);
  await expect(page.getByRole("heading", { name: /^New/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Single sign-on" }),
  ).toBeVisible();
  await accessible(page, "internal roadmap");
  await noSideways(page);

  // --- making it private removes it at once
  await page.goto(`${workspaceUrl}/requests`);
  await page.getByRole("link", { name: "Single sign-on" }).click();
  await page.getByRole("button", { name: "Make private" }).click();
  await expect(page.locator("#public-state")).toContainText("Private");
  await pub.goto(`/r/${slug}/roadmap`);
  await expect(pub.getByText("Nothing is on the roadmap yet.")).toBeVisible();

  // --- erase the visitor: the submission and what was built on it go
  await page.goto(`${workspaceUrl}/settings`);
  await page.getByLabel(/^Removes everything/).fill("visitor@example.com");
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await expect(page.getByText(/Erased 1 submission/)).toBeVisible();
  expect(
    query(
      `SELECT count(*) FROM source_item WHERE workspace_id='${workspaceId}' AND kind='form'`,
    )[0],
  ).toBe("0");

  // --- a new key ends the old one; an unknown address is just "not found"
  await page.getByRole("button", { name: "Issue a new key" }).click();
  await expect(page.getByText(/New key issued/)).toBeVisible();
  expect(await browserPost(browser, SITE, slug, key, "after rotating")).toBe(
    404,
  );
  await pub.goto(`/r/no-such-address-${Date.now()}/roadmap`);
  await expect(pub.getByText("This page could not be found.")).toBeVisible();
  await visitor.close();
  sites.forEach((x) => x.close());
});
