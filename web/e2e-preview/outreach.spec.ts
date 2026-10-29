import { expect, test } from "@playwright/test";

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ws = `/w/${uid(1)}`;
const batch = `${ws}/outreach/${uid(300)}`;

async function openBatch(page: import("@playwright/test").Page) {
  await page.goto(
    `/mock/scenario?reset=1&set=normal&session=in&to=${encodeURIComponent(batch)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Export the request list to CSV", level: 1 }),
  ).toBeVisible();
  // Let React hydrate before typing: an input filled before hydration is reset to the server value.
  await page.waitForTimeout(1500);
}

test.describe("messages", () => {
  test("saves an edit, previews it, and leaves someone out with undo", async ({
    page,
  }) => {
    await openBatch(page);

    const subject = page.locator("input[id^='subject-']").first();
    await subject.click();
    await subject.pressSequentially(" today");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await expect(
      page.getByRole("link", { name: "View Lena Fischer in People" }),
    ).toHaveAttribute("href", /people\?q=lena%40northgate\.example/);

    await page.getByRole("button", { name: "Preview" }).first().click();
    await expect(page.getByText("What the recipient will see")).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByText("The Northwind team <updates@northwind.example>"),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Send test" }).first().click();
    await expect(page.getByText("Test sent to your inbox")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    expect((await download).suggestedFilename()).toBe(
      "export-the-request-list-to-csv.csv",
    );

    await expect(
      page.getByText("Replies go to support@northwind.example."),
    ).toBeVisible();

    await page.getByRole("button", { name: /Don't send to Lena/ }).click();
    await expect(page.getByText("Lena left out")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Lena left out")).toHaveCount(0);
    await expect(page.getByText("Include Lena again")).toHaveCount(0);
  });

  test("warns about unopened messages and sends the batch", async ({ page }) => {
    await openBatch(page);

    await page
      .getByRole("button", { name: /Approve and send 2 messages/ })
      .first()
      .click();
    await expect(page.getByText(/not opened 1 message/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, send 2 emails" }).click();
    await expect(page.getByText("All done.")).toBeVisible({ timeout: 20_000 });
  });

  test("searches the list and shows a way out of an empty result", async ({
    page,
  }) => {
    await page.goto(
      `/mock/scenario?reset=1&set=normal&session=in&to=${encodeURIComponent(
        `${ws}/outreach`,
      )}`,
    );
    await expect(
      page.getByRole("heading", { name: "Messages", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("2 ready")).toBeVisible();

    await page
      .getByRole("searchbox", { name: "Search messages by request" })
      .fill("nothing");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("No batches match.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear the search" })).toBeVisible();
  });
});
