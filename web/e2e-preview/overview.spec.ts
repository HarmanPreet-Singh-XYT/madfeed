import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const home = `/w/${uid(1)}`;

async function reset(page: Page, set: "normal" | "empty" = "normal") {
  await page.goto(
    `/mock/scenario?reset=1&set=${set}&session=in&to=${encodeURIComponent(home)}`,
  );
}

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test.describe("overview", () => {
  test("shows what needs a person, the totals, and the top requests", async ({
    page,
  }) => {
    await reset(page);
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Needs you", level: 2 }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /5 suggestions to review/ }),
    ).toHaveAttribute("href", /\/review$/);
    await expect(
      page.getByRole("link", { name: /2 messages waiting/ }),
    ).toHaveAttribute("href", /\/outreach$/);
    await expect(
      page.getByRole("link", { name: /3 unread conversations/ }),
    ).toHaveAttribute("href", /\/inbox$/);

    await expect(
      page.getByText("Open requests", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Most asked for")).toBeVisible();
    await expect(page.getByText("Recent activity")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Momentum", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Daily activity over 30 days/ }),
    ).toBeVisible();

    await page.getByRole("link", { name: "7 days" }).click();
    await expect(page).toHaveURL(/days=7/);
    await expect(
      page.getByRole("img", { name: /Daily activity over 7 days/ }),
    ).toBeVisible();
    await expect(
      page
        .locator("ol")
        .getByRole("link", { name: /Single sign-on \(SAML\) for our team/ }),
    ).toBeVisible();
    await expect(page.getByText("Your workspace")).toBeVisible();
    await accessible(page);
  });

  test("starts an empty workspace with one action, not four zeroes", async ({
    page,
  }) => {
    await reset(page, "empty");
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("No requests yet.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add your first feedback" }),
    ).toBeVisible();
    await expect(page.getByText("Get started")).toBeVisible();
    await expect(page.getByText("0 of 6 done")).toBeVisible();
    await expect(page.getByText("Open requests", { exact: true })).toHaveCount(
      0,
    );
    await accessible(page);
  });
});

test("opens the full activity log and filters it", async ({ page }) => {
  await reset(page);
  const activityLink = page.getByRole("link", { name: "View all activity" });
  await expect(activityLink).toHaveAttribute("href", /\/activity$/);
  await page.goto((await activityLink.getAttribute("href"))!);
  await expect(
    page.getByRole("heading", { name: "Activity", level: 1 }),
  ).toBeVisible();

  await page.getByLabel("Show").selectOption("quote");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(page).toHaveURL(/kind=quote/);
  await expect(
    page.getByRole("heading", { name: "Activity", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText(/Quote ·/).first()).toBeVisible();
  await accessible(page);
});
