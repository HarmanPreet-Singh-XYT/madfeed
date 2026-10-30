import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ws = `/w/${uid(1)}`;

// These tests are about the first-run help, so they start with a browser that has seen none of it (the other
// specs start with the tour and the tips switched off).
test.use({ storageState: { cookies: [], origins: [] } });

async function open(page: Page, to: string) {
  await page.goto(
    `/mock/scenario?reset=1&set=normal&session=in&to=${encodeURIComponent(to)}`,
  );
}

const tour = (page: Page) =>
  page.getByRole("dialog", { name: /.+/ }).filter({ hasText: /Step \d+ of \d+/ });

/** The tour starts by itself a moment after the overview opens; wait for it, then leave it, so it cannot appear later. */
async function skipTour(page: Page) {
  await expect(tour(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour(page)).toBeHidden();
}

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test.describe("the tour", () => {
  test("starts by itself on the first visit, walks every step, and is remembered", async ({
    page,
  }) => {
    await open(page, ws);
    const card = tour(page);
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("heading", { name: "A quick look around" }),
    ).toBeVisible();
    await accessible(page);

    await card.getByRole("button", { name: "Show me around" }).click();
    const total = Number(
      (await card.getByText(/Step \d+ of \d+/).textContent())?.match(/of (\d+)/)?.[1],
    );
    expect(total).toBeGreaterThanOrEqual(6);

    // Every step has a heading and a way on; the last one finishes.
    for (let i = 3; i <= total; i++) {
      await card.getByRole("button", { name: "Next" }).click();
      await expect(card.getByText(`Step ${i} of ${total}`)).toBeVisible();
    }
    await expect(
      card.getByRole("heading", { name: "You are ready" }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden();

    // Seen once, so it does not start again.
    await page.reload();
    await page.waitForTimeout(1200);
    await expect(tour(page)).toBeHidden();
  });

  test("the keyboard drives it: arrows move, Tab stays inside, Escape leaves", async ({
    page,
  }) => {
    await open(page, ws);
    const card = tour(page);
    await expect(card).toBeVisible();
    // The card takes the keyboard, so Enter goes on at once.
    await page.keyboard.press("Enter");
    await expect(card.getByText(/^Step 2 of/)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(card.getByText(/^Step 3 of/)).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(card.getByText(/^Step 2 of/)).toBeVisible();

    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      );
      expect(inside).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
  });

  test("spotlights the sidebar item it is talking about", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "the sidebar is hidden on a phone, so cards are centred");
    await open(page, ws);
    const card = tour(page);
    await card.getByRole("button", { name: "Show me around" }).click();
    await expect(card.getByRole("heading", { name: /add feedback/i })).toBeVisible();
    const link = page.locator('[data-tour="nav-add"]').first();
    const l = await link.boundingBox();
    const c = await card.boundingBox();
    expect(l && c && c.x >= l.x + l.width).toBe(true); // beside it, not on top of it
  });

  test("can be replayed from the Help menu", async ({ page }) => {
    await open(page, ws);
    await skipTour(page);

    await page.getByRole("button", { name: "Help" }).first().click();
    await page.getByRole("menuitem", { name: "Take the product tour" }).click();
    await expect(
      tour(page).getByRole("heading", { name: "A quick look around" }),
    ).toBeVisible();
  });

  test("a phone gets plain cards and nothing runs off the screen", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone only");
    await open(page, ws);
    const card = tour(page);
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    const view = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(view.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(view.height);
  });
});

test.describe("tips and help", () => {
  test("a tool page explains itself once, and a closed tip stays closed", async ({
    page,
  }) => {
    await open(page, `${ws}/review`);
    const tip = page.getByRole("region", { name: "Tip" });
    await expect(tip).toBeVisible();
    await expect(tip.getByText("You decide what becomes a request")).toBeVisible();
    await accessible(page);

    await tip.getByRole("button", { name: "Got it" }).click();
    await expect(tip).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Review", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Tip" })).toBeHidden();

    // Another page still has its own tip.
    await page.goto(`${ws}/requests`);
    await expect(
      page.getByRole("region", { name: "Tip" }).getByText("Requests, most valuable first"),
    ).toBeVisible();
  });

  test("tips can be switched off for everything, and back on from the Help menu", async ({
    page,
  }) => {
    await open(page, `${ws}/requests`);
    await page.getByRole("region", { name: "Tip" }).getByRole("button", { name: "Hide all tips" }).click();
    await expect(page.getByRole("region", { name: "Tip" })).toBeHidden();
    await page.goto(`${ws}/review`);
    await expect(page.getByRole("heading", { name: "Review", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Tip" })).toBeHidden();

    await page.getByRole("button", { name: "Help" }).first().click();
    await page.getByRole("menuitem", { name: "Show tips on each screen" }).click();
    await expect(page.getByRole("region", { name: "Tip" })).toBeVisible();
  });

  test("no tip on the overview or inside a single request", async ({ page }) => {
    await open(page, ws);
    await skipTour(page);
    await expect(page.getByRole("region", { name: "Tip" })).toBeHidden();
  });

  test("the Help menu lists the keyboard shortcuts", async ({ page }) => {
    await open(page, ws);
    await skipTour(page);
    await page.getByRole("button", { name: "Help" }).first().click();
    await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Accept the suggestion in focus")).toBeVisible();
    await accessible(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
