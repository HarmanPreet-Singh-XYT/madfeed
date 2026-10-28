import { test } from "@playwright/test";
import { seedProposals, seedReadyBrief, signIn, uniqueName } from "./helpers";

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
    {
      quote:
        "We really need SSO before we can roll this out to the whole company.",
      title: "Single sign-on",
      confidence: 0.95,
    },
    {
      quote: "when we export the monthly report the totals are sometimes wrong",
      title: "Report totals are wrong",
      confidence: 0.7,
    },
  ]);
  await page.reload();
  await page.getByRole("link", { name: "Review them" }).click();
  await page
    .getByRole("button", { name: "Accept as a request" })
    .first()
    .waitFor();
  await page.screenshot({ path: `${dir}/${tag}-3-review.png`, fullPage: true });
  await page
    .getByRole("button", { name: "Accept as a request" })
    .first()
    .click();
  await page.getByRole("link", { name: /^Review \(1\)$/ }).waitFor();
  await page.goto(page.url().replace(/review.*/, "requests"));
  await page.getByRole("heading", { name: "Requests" }).waitFor();
  await page.getByText("customer quote").first().waitFor();
  await page.screenshot({
    path: `${dir}/${tag}-4-requests.png`,
    fullPage: true,
  });
});

test("capture phase 2 screens", async ({ page }, info) => {
  const dir = process.env.SHOTS_DIR!;
  const tag = info.project.name;
  const SSO =
    "We really need SSO before we can roll this out to the whole company.";
  const CSV = `Name,Email,Company,ARR\nDana Lee,dana@acme.com,Acme Inc,"$100,000"\nRaj Patel,raj@acme.com,Acme Inc,100000\nSam Cho,sam@globex.io,Globex,5000\nBad Row,not-an-email,Globex,5000\n`;
  await signIn(page, uniqueName("shots2"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/add$/);
  const ws = page.url().replace(/\/add$/, "");
  await page.goto(`${ws}/people`);
  await page.getByLabel("CSV file").waitFor();
  const { expect } = await import("@playwright/test");
  await expect(async () => {
    await page.getByLabel("CSV file").setInputFiles({
      name: "customers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CSV),
    });
    await expect(page.getByText("3 rows ready")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.screenshot({
    path: `${dir}/${tag}-5-import-preview.png`,
    fullPage: true,
  });
  await page
    .getByLabel("Leave out the rows with problems and import the rest")
    .check();
  await page.getByRole("button", { name: "Import 3 rows" }).click();
  await page.getByText("Import finished").waitFor();

  for (const [person, quote, title] of [
    ["Dana Lee (Acme Inc)", SSO, "Single sign-on"],
    ["Raj Patel (Acme Inc)", SSO, "Single sign-on"],
    [
      "Sam Cho (Globex)",
      "the totals are sometimes wrong",
      "Report totals are wrong",
    ],
  ]) {
    await page.goto(`${ws}/add`);
    await page.getByLabel("Who said it").selectOption({ label: person });
    await page
      .getByLabel("Conversation")
      .fill(`${quote}\n\nunique ${Math.random()}`);
    await page.getByRole("button", { name: "Find requests" }).click();
    await page.waitForURL(/sources\/[0-9a-f-]+$/);
    seedProposals(page.url().split("/").pop()!, [
      { quote, title, confidence: 0.9 },
    ]);
    await page.goto(`${ws}/review`);
    const target = page.getByLabel("Add it to");
    if (title === "Single sign-on" && person.startsWith("Raj"))
      await target.selectOption({ label: "Single sign-on" });
    await page.getByRole("button", { name: "Accept as a request" }).click();
    await page.getByText("Nothing to review right now.").waitFor();
  }
  await page.goto(`${ws}/requests?sort=value`);
  await page.getByRole("cell", { name: "5,000", exact: true }).waitFor();
  await page.screenshot({
    path: `${dir}/${tag}-6-requests.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Single sign-on" }).click();
  await page.waitForURL(/requests\/[0-9a-f-]{36}$/);
  const requestId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Write a decision brief" }).click();
  await page.getByText("Writing the brief").waitFor();
  seedReadyBrief(
    requestId,
    "Customers need single sign-on before they can roll the product out company-wide.",
    "If one team drove both asks, it matters less.",
    2,
  );
  await page
    .getByText("If one team drove both asks")
    .waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${dir}/${tag}-7-brief.png`, fullPage: true });
  await page.goto(`${ws}/quality`);
  await page.getByText("Not enough to judge yet").waitFor();
  await page.screenshot({
    path: `${dir}/${tag}-8-quality.png`,
    fullPage: true,
  });
});
