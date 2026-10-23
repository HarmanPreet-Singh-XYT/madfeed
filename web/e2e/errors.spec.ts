import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn, uniqueName } from "./helpers";

// This copy of the app cannot reach its API at all.
test.use({ baseURL: "http://127.0.0.1:13002" });

test("when the service behind the app is down, people see a plain message and a way to retry, not a broken page", async ({
  page,
}) => {
  await signIn(page, uniqueName("down")); // signing in does not need the API
  await page.goto("/");
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Something went wrong" });
  await expect(alert).toBeVisible();
  await expect(
    alert.getByRole("heading", { level: 1, name: "Something went wrong" }),
  ).toBeVisible();
  await expect(alert).toContainText("Nothing you did has been lost");
  // no internals leak into the page
  const html = await page.content();
  for (const leak of [
    "127.0.0.1:1",
    "ECONNREFUSED",
    "fetch failed",
    "at async",
    ".next/server",
    "Error:",
  ])
    expect(html, leak).not.toContain(leak);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    r.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
  // The retry button works (the service is still down, so the message stays) and does not crash anything.
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Something went wrong" }),
  ).toBeVisible();
  // Pages that do not need the API still work.
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
