import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueName } from "./helpers";

// Every screen of a brand-new workspace: it must say what it is, say plainly
// that there is nothing yet (and what to do about it), have no serious
// accessibility problem, and not scroll sideways at phone width.

async function checkScreen(
  page: Page,
  url: string,
  heading: string | RegExp,
  empty?: string | RegExp,
) {
  await page.goto(url);
  await expect(
    page.getByRole("heading", { level: 1, name: heading }).first(),
  ).toBeVisible({ timeout: 15_000 });
  if (empty)
    await expect(
      page.getByText(empty).first(),
      `${url}: empty state`,
    ).toBeVisible();
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help}`),
    `${url}: accessibility`,
  ).toEqual([]);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${url}: scrolls sideways`).toBeLessThanOrEqual(0);
}

test("every screen of an empty workspace explains itself and is accessible", async ({
  page,
}) => {
  await signIn(page, uniqueName("states"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const w = page.url().replace(/\/add$/, "");

  await checkScreen(page, `${w}/add`, /Add/);
  await checkScreen(
    page,
    `${w}/review`,
    /Review/,
    "Nothing to review right now.",
  );
  await checkScreen(page, `${w}/requests`, "Requests", "No requests yet.");
  await checkScreen(
    page,
    `${w}/recordings`,
    "Recordings",
    "No recordings yet.",
  );
  await checkScreen(page, `${w}/research`, "Research", "No highlights yet.");
  await checkScreen(page, `${w}/research/codebook`, "Tags", "No tags yet.");
  await checkScreen(page, `${w}/ask`, "Ask");
  await checkScreen(
    page,
    `${w}/outreach`,
    /message|Message/,
    /Nothing (waiting for review|here yet)\./,
  );
  await checkScreen(
    page,
    `${w}/releases`,
    /Release notes/,
    "No release notes yet.",
  );
  await checkScreen(
    page,
    `${w}/people`,
    /People and companies/,
    /No people yet/,
  );
  await checkScreen(page, `${w}/quality`, /Quality/);
  await checkScreen(page, `${w}/settings`, /Settings/);
});

test("things that are missing or forbidden say so plainly, with a way back", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("missing"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const w = page.url().replace(/\/add$/, "");
  const nowhere = "00000000-0000-4000-8000-000000000000";

  for (const url of [
    `${w}/requests/${nowhere}`,
    `${w}/sources/${nowhere}`,
    `${w}/outreach/${nowhere}`,
    `${w}/releases/${nowhere}`,
    `${w}/requests/not-an-id`,
    `/w/${nowhere}/requests`, // a workspace that does not exist
  ]) {
    await page.goto(url);
    await expect(
      page.getByRole("heading", { level: 1, name: "We couldn't find that" }),
      url,
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to your workspaces" }),
    ).toBeVisible();
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      r.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
      url,
    ).toEqual([]);
  }

  // Someone else's workspace looks exactly like one that does not exist.
  const other = await browser.newContext();
  const op = await other.newPage();
  await signIn(op, uniqueName("outsider"));
  await op.goto(`${w}/requests`);
  await expect(
    op.getByRole("heading", { level: 1, name: "We couldn't find that" }),
  ).toBeVisible();
  await other.close();
});
