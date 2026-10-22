import { test } from "@playwright/test";
import { seedProposals, signIn, uniqueName } from "./helpers";

// Only runs on request: SHOTS_DIR=/path npx playwright test screenshots
test.skip(!process.env.SHOTS_DIR, "set SHOTS_DIR to capture screenshots");

test("capture screens", async ({ page }, info) => {
  const dir = process.env.SHOTS_DIR!;
  const tag = info.project.name;
  await page.goto("/login");
  await page.getByLabel("Your name").waitFor();
  await page.screenshot({ path: `${dir}/${tag}-1-login.png`, fullPage: true });
  await signIn(page, uniqueName("shots"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("button", { name: "Try a sample conversation" }).click();
  await page.getByLabel("Conversation").waitFor();
  await page.screenshot({ path: `${dir}/${tag}-2-add.png`, fullPage: true });
  await page.getByRole("button", { name: "Find requests" }).click();
  await page.waitForURL(/sources/);
  const id = page.url().split("/").pop()!;
  seedProposals(id, [
    { quote: "We really need SSO before we can roll this out to the whole company.", title: "Single sign-on", confidence: 0.95 },
    { quote: "when we export the monthly report the totals are sometimes wrong", title: "Report totals are wrong", confidence: 0.7 },
  ]);
  await page.reload();
  await page.getByRole("link", { name: "Review them" }).click();
  await page.getByRole("button", { name: "Accept as a request" }).first().waitFor();
  await page.screenshot({ path: `${dir}/${tag}-3-review.png`, fullPage: true });
  await page.getByRole("button", { name: "Accept as a request" }).first().click();
  await page.getByRole("link", { name: /^Review \(1\)$/ }).waitFor();
  await page.goto(page.url().replace(/review.*/, "requests"));
  await page.getByRole("heading", { name: "Requests" }).waitFor();
  await page.getByText("customer quote").first().waitFor();
  await page.screenshot({ path: `${dir}/${tag}-4-requests.png`, fullPage: true });
});
