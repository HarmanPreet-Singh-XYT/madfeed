import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn, uniqueName } from "./helpers";

test("add an address for messages, see the secret once, test it, switch it off and remove it", async ({
  page,
}) => {
  await signIn(page, uniqueName("wh"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  await page.goto(page.url().replace(/\/add$/, "/settings"));

  await expect(page.getByText("No addresses yet.")).toBeVisible();

  // a private address is refused with a plain explanation
  await page
    .getByLabel("Address (must start with https://)")
    .fill("https://localhost/hook");
  await page.getByRole("button", { name: "Add address" }).click();
  await expect(page.getByText(/private network/)).toBeVisible();

  // a public one works, and the secret is shown once
  await page
    .getByLabel("Address (must start with https://)")
    .fill("https://hooks.example.com/feedback");
  await page.getByLabel("Note for yourself (optional)").fill("Automation");
  await page.getByLabel("A release note is published").uncheck();
  await page
    .getByLabel("What kind of address is it")
    .selectOption({ label: "A message for a Slack channel" });
  await page.getByRole("button", { name: "Add address" }).click();
  const secret = await page.getByLabel(/Signing secret for/).inputValue();
  expect(secret).toMatch(/^whsec_/);

  const list = page.getByRole("list", { name: "Addresses" });
  await expect(
    list.locator("strong", { hasText: "https://hooks.example.com/feedback" }),
  ).toBeVisible();
  await expect(list.getByText("A message for a Slack channel")).toBeVisible();
  await expect(list.getByText("Automation", { exact: true })).toBeVisible();
  await expect(list.getByText("On", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(`input[value="${secret}"]`)).toHaveCount(0);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help}`),
  ).toEqual([]);

  // a test message is queued and shows in the history
  await page.getByRole("button", { name: /Send a test/ }).click();
  await expect(page.getByText(/test message is on its way/)).toBeVisible();
  await page.getByRole("button", { name: /Show history/ }).click();
  await expect(
    page.getByRole("list", { name: "Recent messages" }),
  ).toBeVisible();

  // switching off and removing
  await page.getByRole("button", { name: /Switch off/ }).click();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByText("No addresses yet.")).toBeVisible();
});
