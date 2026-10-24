import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { signIn, uniqueName } from "./helpers";

const API = "http://127.0.0.1:18080";

async function accessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help}`),
    `accessibility problems on ${label}`,
  ).toEqual([]);
}

test("name yourself, save a reply, use it in a conversation, and see how fast the desk answers", async ({
  page,
}) => {
  await signIn(page, uniqueName("dk"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;

  // turn email on so a conversation can arrive
  await page.goto(`${workspaceUrl}/settings`);
  await page.getByRole("checkbox", { name: "Email", exact: true }).check();
  await page.getByRole("button", { name: "Save the inbox settings" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.reload();
  const key = await page.getByLabel(/Signing key/).inputValue();

  const mailBody = JSON.stringify({
    from: "sam@acme.test",
    fromName: "Sam",
    subject: "Shipping question",
    text: "How long does shipping take?",
    messageId: `<desk-${Date.now()}@mail>`,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig =
    "sha256=" +
    createHmac("sha256", key).update(`${ts}.${mailBody}`).digest("hex");
  const sent = await fetch(`${API}/v1/integrations/email/${ws}/inbound`, {
    method: "POST",
    body: mailBody,
    headers: { "X-Timestamp": ts, "X-Signature": sig },
  });
  expect(sent.status).toBe(200);

  // desk setup
  await page.goto(`${workspaceUrl}/inbox/desk`);
  await page.getByLabel(/The name your teammates see/).fill("Priya");
  await page.getByRole("button", { name: "Save my name" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Shipping time");
  await page.getByLabel("The reply").fill("Orders arrive in 3 to 5 days.");
  await page.getByRole("button", { name: "Add a saved reply" }).click();
  await expect(page.getByText("Orders arrive in 3 to 5 days.")).toBeVisible();
  await page.getByLabel(/Longest a customer should wait/).fill("24");
  await page.getByRole("button", { name: "Save the target" }).click();
  await expect(page.getByText("Saved.").last()).toBeVisible();
  await accessible(page, "desk setup");

  // the inbox says who is waiting, and the saved reply goes into the reply box
  await page.goto(`${workspaceUrl}/inbox`);
  await expect(page.getByText(/1 waiting for an answer/)).toBeVisible();
  await accessible(page, "the inbox with stats");
  await page.getByRole("link", { name: /Shipping question/ }).click();
  await page
    .getByLabel("Put in a saved reply")
    .selectOption({ label: "Shipping time" });
  await expect(page.getByLabel(/Your reply/)).toHaveValue(
    "Orders arrive in 3 to 5 days.",
  );
  await page.getByRole("button", { name: "Send the reply" }).click();
  await expect(
    page.getByText("Orders arrive in 3 to 5 days.").last(),
  ).toBeVisible();

  // answered: the desk reports a first answer and the conversation is no longer waiting
  await page.goto(`${workspaceUrl}/inbox`);
  await expect(page.getByText(/First answer in/)).toBeVisible();
  await expect(
    page.getByText("Nobody is waiting for an answer."),
  ).toBeVisible();
  await expect(page.getByText(/you have it/)).toBeVisible();
});
