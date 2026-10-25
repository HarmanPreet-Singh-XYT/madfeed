import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedProposals, signIn, uniqueName } from "./helpers";

const SSO =
  "We really need SSO before we can roll this out to the whole company.";
const EXPORT =
  "when we export the monthly report the totals are sometimes wrong";

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help}`),
    `accessibility problems on ${label}`,
  ).toEqual([]);
}

test("sign in, add feedback, review with exact quotes, accept, undo", async ({
  page,
}) => {
  // --- sign in and first workspace
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login/); // no session: sent to sign in
  await expectAccessible(page, "sign-in");
  await signIn(page, uniqueName("e2e"));
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");

  // --- add feedback using the sample
  await expectAccessible(page, "add feedback");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Try a sample conversation" }).click();
  await expect(page.getByLabel("Conversation")).toHaveValue(/single sign-on/);
  await page.getByRole("button", { name: "Find requests" }).click();
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+$/);
  await expect(page.getByText("Reading the conversation")).toBeVisible();
  const sourceId = page.url().split("/").pop()!;

  // The worker needs an AI key, so stand in for it: store two proposals whose quotes the database verifies.
  seedProposals(sourceId, [
    { quote: SSO, title: "Single sign-on", confidence: 0.95 },
    { quote: EXPORT, title: "Report totals are wrong", confidence: 0.7 },
  ]);
  await expect(page.getByText("Found 2 requests to review")).toBeVisible({
    timeout: 15_000,
  }); // the page polls on its own

  // --- review shows the exact words, highlighted
  await page.getByRole("link", { name: "Review them" }).click();
  await expect(
    page.getByRole("heading", { name: "Review", exact: true }),
  ).toBeVisible();
  await expectAccessible(page, "review queue");
  await expectNoHorizontalScroll(page);
  await expect(page.locator("mark").filter({ hasText: SSO })).toBeVisible();
  await expect(page.locator("mark").filter({ hasText: EXPORT })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Review \(2\)$/ }),
  ).toBeVisible();

  // --- accept the first one with a better title
  const card = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: "Single sign-on", exact: true }),
  });
  await card.getByLabel("Request title").fill("Support single sign-on (SSO)");
  await card.getByRole("button", { name: "Accept as a request" }).click();
  await expect(
    page.getByRole("heading", { name: "Single sign-on", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /^Review \(1\)$/ }),
  ).toBeVisible();

  // --- the request exists, with the customer's quote as evidence
  await page.goto(`${workspaceUrl}/requests`);
  await expectAccessible(page, "requests");
  await page
    .getByRole("link", { name: "Support single sign-on (SSO)" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Support single sign-on (SSO)" }),
  ).toBeVisible();
  await expect(page.locator("mark").filter({ hasText: SSO })).toBeVisible();
  await expectAccessible(page, "request detail");
  await page
    .getByRole("link", { name: "See it in the full conversation" })
    .click();
  await expect(page.locator("mark#quote")).toHaveText(SSO);

  // --- undo from the Accepted tab puts it back in the queue and removes the request
  await page.goto(`${workspaceUrl}/review?state=accepted`);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Nothing accepted yet.")).toBeVisible();
  await page.goto(`${workspaceUrl}/requests`);
  await expect(page.getByText("No requests yet.")).toBeVisible();
  await page.goto(`${workspaceUrl}/review`);
  await expect(
    page.getByRole("link", { name: /^Review \(2\)$/ }),
  ).toBeVisible();

  // --- bulk accept and dismiss
  await page.getByLabel("Accept everything at or above").selectOption("0.9");
  await page.getByRole("button", { name: "Accept all" }).click();
  await expect(
    page.getByRole("link", { name: /^Review \(1\)$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();
});

test("another person cannot see this workspace, and sign-out ends the session", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("owner"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, uniqueName("stranger"));
  await otherPage.goto(`${workspaceUrl}/requests`);
  await expect(
    otherPage.getByRole("heading", { name: "We couldn't find that" }),
  ).toBeVisible();
  await other.close();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto(`${workspaceUrl}/requests`);
  await expect(page).toHaveURL(/\/login/);
});

test("the session token is never readable by page scripts", async ({
  page,
}) => {
  await signIn(page, uniqueName("cookie"));
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("session");
});
