import { expect, test } from "@playwright/test";
import { signIn, sql, uniqueName } from "./helpers";

test("an admin is told when the AI allowance is used up; members are not", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("notice"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const url = page.url().replace(/\/add$/, "");
  const ws = url.split("/").pop()!;
  await page.goto(`${url}/requests`);
  await expect(page.getByText(/AI allowance/)).toHaveCount(0);

  sql(
    `INSERT INTO notice (workspace_id, kind, message) VALUES ('${ws}', 'ai_budget', 'Your workspace has used its AI allowance for today ($5.00). Reading new conversations is paused.')`,
  );
  await page.reload();
  await expect(
    page.getByText(
      "Your workspace has used its AI allowance for today ($5.00).",
    ),
  ).toBeVisible();

  const ctx = await browser.newContext();
  const member = await ctx.newPage();
  await signIn(member, uniqueName("notice-member"));
  const token = (await ctx.cookies()).find((c) => c.name === "session")!.value;
  const sub = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ).sub as string;
  sql(
    `INSERT INTO member (workspace_id, user_id, role) VALUES ('${ws}', '${sub}', 'member')`,
  );
  await member.goto(`${url}/requests`);
  await expect(member.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(member.getByText(/AI allowance/)).toHaveCount(0);
  await ctx.close();
});
