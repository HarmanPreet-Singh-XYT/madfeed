import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ws = `/w/${uid(1)}`;
const doc = `${ws}/findings/${uid(940)}`;

async function reset(page: Page, to: string) {
  await page.goto(
    `/mock/scenario?reset=1&set=normal&session=in&to=${encodeURIComponent(to)}`,
  );
}

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test.describe("findings", () => {
  test("the list searches, filters, and explains an empty result", async ({
    page,
  }) => {
    await reset(page, `${ws}/findings`);
    await expect(
      page.getByRole("heading", { name: "Findings", level: 1 }),
    ).toBeVisible();
    await accessible(page);

    const search = page.getByRole("searchbox", {
      name: "Search findings by title",
    });
    await search.fill("rollout");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("link", { name: /Why teams stall at rollout/ }),
    ).toBeVisible();

    // Search reaches the quoted words, not just the title.
    await search.fill("security team");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("link", { name: /Why teams stall at rollout/ }),
    ).toBeVisible();

    await search.fill("nothing");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("No documents match.")).toBeVisible();
    await page.getByRole("link", { name: "Show every document" }).click();
    await expect(
      page.getByRole("link", { name: /Why teams stall at rollout/ }),
    ).toBeVisible();

    await page.getByRole("link", { name: /Drafts 1/ }).click();
    await expect(
      page.getByRole("link", { name: /Why teams stall at rollout/ }),
    ).toBeVisible();
    await page.getByRole("link", { name: /Shared 0/ }).click();
    await expect(page.getByText("No documents match.")).toBeVisible();
  });

  test("reads, edits, saves, and scans cleanly", async ({ page }) => {
    await reset(page, doc);
    await expect(
      page.getByRole("heading", {
        name: "Why teams stall at rollout",
        level: 1,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Read" }).click();
    await expect(page.getByText("Across three accounts")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What we heard", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Contents" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open source" }).first(),
    ).toBeVisible();
    await accessible(page);

    await page.getByRole("button", { name: "Write" }).click();
    const title = page.getByLabel("Title");
    await title.click();
    await title.press("Meta+a");
    await title.pressSequentially("Why teams stall at rollout today");
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Add a heading" }),
    ).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download .md" }).click();
    expect((await download).suggestedFilename()).toBe(
      "why-teams-stall-at-rollout-today.md",
    );
  });

  test("publishes and shows the same quotes on the public page", async ({
    page,
  }) => {
    await reset(page, doc);
    await page
      .getByRole("checkbox", { name: /I have read every quote/ })
      .check();
    await page.getByRole("button", { name: "Publish with a link" }).click();
    const link = page.locator("#share-link");
    await expect(link).toHaveValue(/\/f\//, { timeout: 10_000 });
    const href = await link.inputValue();
    expect(await page.getByRole("button", { name: "Copy link" }).count()).toBe(
      1,
    );

    await page.goto(href);
    await expect(
      page.getByRole("heading", {
        name: "Why teams stall at rollout",
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What we heard", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByText("Our security team will not sign off"),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Contents" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await accessible(page);
  });
});

test("duplicates a document and shows its history", async ({ page }) => {
  await reset(page, doc);
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Why teams stall at rollout (copy)",
      level: 1,
    }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "History", level: 2 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("deletes to Recently deleted and restores", async ({ page }) => {
  await reset(page, doc);
  await page.getByRole("button", { name: "Delete this document" }).click();
  await page.getByRole("button", { name: "Yes, delete the document" }).click();
  await expect(
    page.getByRole("heading", { name: "Findings", level: 1 }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: /Recently deleted/ }).click();
  const row = page
    .getByRole("paragraph")
    .filter({ hasText: "Why teams stall at rollout" })
    .first();
  await expect(row).toBeVisible();
  await expect(page.getByText("Deleted", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("link", { name: /All 1/ }).click();
  await expect(
    page.getByRole("link", { name: /Why teams stall at rollout/ }),
  ).toBeVisible();
});

test("asks for the password on a protected link", async ({ page }) => {
  await reset(page, doc);
  await page.getByRole("checkbox", { name: /I have read every quote/ }).check();
  await page.getByLabel("Password (optional)").fill("let-me-in-123");
  await page.getByRole("button", { name: "Publish with a link" }).click();
  const link = page.locator("#share-link");
  await expect(link).toHaveValue(/\/f\//, { timeout: 10_000 });

  await page.goto(await link.inputValue());
  await expect(page.getByText("This link is password protected")).toBeVisible();
  await page.getByLabel("Password").fill("wrong password");
  await page.getByRole("button", { name: "Open findings" }).click();
  await expect(page.getByText("That password does not match.")).toBeVisible();
  await page.getByLabel("Password").fill("let-me-in-123");
  await page.getByRole("button", { name: "Open findings" }).click();
  await expect(
    page.getByRole("heading", { name: "Why teams stall at rollout", level: 1 }),
  ).toBeVisible({ timeout: 10_000 });
});
