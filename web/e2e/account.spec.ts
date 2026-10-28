import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn, uniqueName } from "./helpers";

test("ask for an account to be deleted, see the request, take it back; delete a workspace by typing its name", async ({
  page,
}) => {
  await signIn(page, uniqueName("acct"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  await page.goto(page.url().replace(/\/add$/, "/settings?tab=account"));

  // asking: a plain explanation first, then the request is shown and can be withdrawn
  await expect(
    page.getByRole("heading", { name: "Delete your account" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ask for my account to be deleted" })
    .click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Ask for my account to be deleted");
  await ask
    .getByRole("button", { name: "Ask for my account to be deleted" })
    .click();
  await expect(
    page.getByText(/You asked for your account to be deleted/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/You asked for your account to be deleted/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel my request" }).click();
  await expect(
    page.getByRole("button", { name: "Ask for my account to be deleted" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // deleting a workspace needs its exact name
  const name = (await page.getByText(/· your role: admin/).innerText()).split(
    " · ",
  )[0];
  const del = page.getByRole("button", {
    name: "Delete this workspace forever",
  });
  await expect(del).toBeDisabled();
  await page.getByLabel("Type the workspace name to confirm").fill(name);
  await expect(del).toBeEnabled();
  await del.click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});
