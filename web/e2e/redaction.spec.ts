import { expect, test } from "@playwright/test";
import { query, signIn, uniqueName } from "./helpers";

test("card numbers, keys and passwords are hidden before anything is saved", async ({
  page,
}) => {
  await signIn(page, uniqueName("redact"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const ws = page.url().split("/").slice(-2)[0];

  await page.goto(`${page.url()}`);
  await expect(async () => {
    await page
      .getByLabel("Conversation")
      .fill(
        `Dana: we can't use it without SSO.\nDana: my card is 4111 1111 1111 1111, the key is sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 and password: hunter2xyz.\n${Date.now()}`,
      );
    await page.getByRole("button", { name: "Find requests" }).click();
    await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+$/, { timeout: 4_000 });
  }).toPass({ timeout: 25_000 });

  await expect(
    page.getByText(
      /We hid 3 things that looked like card numbers, keys or passwords/,
    ),
  ).toBeVisible();
  const shown = await page.getByLabel("Original text").innerText();
  for (const leak of ["4111", "sk-proj", "hunter2"])
    expect(shown).not.toContain(leak);
  expect(shown).toContain("[card number removed]");
  expect(shown).toContain("we can't use it without SSO");
  expect(await page.content()).not.toContain("hunter2xyz");
  const stored = query(
    `SELECT raw_text LIKE '%4111%' OR raw_text LIKE '%sk-proj%' OR raw_text LIKE '%hunter2%' FROM source_item WHERE workspace_id = '${ws}'`,
  );
  expect(stored).toEqual(["f"]);
  const chunks = query(
    `SELECT count(*) FROM chunk WHERE workspace_id = '${ws}' AND (text LIKE '%4111%' OR text LIKE '%sk-proj%' OR text LIKE '%hunter2%')`,
  );
  expect(chunks).toEqual(["0"]);
});
