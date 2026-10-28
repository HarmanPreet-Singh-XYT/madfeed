import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { clearOutbox, outbox, signIn, uniqueName } from "./helpers";

const WEB = "http://127.0.0.1:13000";
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

test("website chat and email reach one inbox; the team answers, converts a message, and cannot double-reply", async ({
  page,
  browser,
}) => {
  await clearOutbox();
  // a stand-in for the customer's website, on its own port so it is a different site
  let token = "";
  const site = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><title>Shop</title><main><h1>Our shop</h1></main><script src="${WEB}/chat.js" data-widget="${token}" async></script>`,
    );
  });
  await new Promise<void>((ok) => site.listen(0, "127.0.0.1", ok));
  const siteOrigin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  await signIn(page, uniqueName("ib"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;

  // set up the channels
  await page.goto(`${workspaceUrl}/settings?tab=customers`);
  await page
    .getByLabel(/Sites that may show the chat/)
    .fill("http://shop.example");
  await page.getByRole("checkbox", { name: "Website chat" }).check();
  await page.getByRole("button", { name: "Save the inbox settings" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("https");
  await page.getByLabel(/Sites that may show the chat/).fill(siteOrigin);
  await page
    .getByLabel("First thing visitors see in the chat")
    .fill("Hi! How can we help?");
  await page.getByRole("checkbox", { name: "Email", exact: true }).check();
  await page.getByRole("button", { name: "Save the inbox settings" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.reload();
  token = /data-widget="([^"]+)"/.exec(
    await page.getByLabel(/Paste this into your website/).inputValue(),
  )![1];
  const key = await page.getByLabel(/Signing key/).inputValue();
  expect(token).toMatch(/^c\./);

  // a visitor on the shop's site opens the chat and writes
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await visitor.goto(siteOrigin);
  await visitor.getByRole("button", { name: "Open chat" }).click();
  const chat = visitor.frameLocator("iframe[title=Chat]");
  await expect(chat.getByText("Hi! How can we help?")).toBeVisible();
  await chat
    .getByLabel("Your message")
    .fill("Where is my order? <b>urgent</b>");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(
    chat.getByText("Where is my order? <b>urgent</b>"),
  ).toBeVisible(); // shown as text

  // the chat refuses to show on a page that is not on the list, or that says nothing about where it is
  const direct = await browser.newContext();
  const bare = await direct.newPage();
  await bare.goto(`${WEB}/chat/${token}`);
  await expect(
    bare.getByText("This chat is not available on this page."),
  ).toBeVisible();
  await bare.goto(`${WEB}/chat/${token}?o=https://evil.example`);
  await expect(
    bare.getByText("This chat is not available on this page."),
  ).toBeVisible();
  await bare.goto(`${WEB}/chat/${token}?o=${encodeURIComponent(siteOrigin)}`);
  await expect(bare.getByLabel("Your message")).toBeVisible();
  await accessible(bare, "the chat window");
  await direct.close();

  // an email arrives, signed by the mail service
  const mailBody = JSON.stringify({
    from: "dana@acme.test",
    fromName: "Dana",
    subject: "Export is broken",
    text: "Our export keeps dropping rows.",
    messageId: `<e2e-${Date.now()}@mail>`,
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig =
    "sha256=" +
    createHmac("sha256", key).update(`${ts}.${mailBody}`).digest("hex");
  const bad = await fetch(`${API}/v1/integrations/email/${ws}/inbound`, {
    method: "POST",
    body: mailBody,
    headers: { "X-Timestamp": ts, "X-Signature": "sha256=00" },
  });
  expect(bad.status).toBe(401);
  const good = await fetch(`${API}/v1/integrations/email/${ws}/inbound`, {
    method: "POST",
    body: mailBody,
    headers: { "X-Timestamp": ts, "X-Signature": sig },
  });
  expect(good.status).toBe(200);

  // the team sees both
  await page.goto(`${workspaceUrl}/inbox`);
  await expect(
    page.getByRole("link", { name: /Export is broken/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Where is my order/ }),
  ).toBeVisible();
  await accessible(page, "the inbox");

  // answer the chat; the visitor sees it, not the internal note
  await page.getByRole("link", { name: /Where is my order/ }).click();
  await expect(
    page.getByText("Where is my order? <b>urgent</b>").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Take it" }).click();
  await expect(page.getByText("You have this conversation.")).toBeVisible();
  await page.getByLabel(/Your reply/).fill("Checking the courier now.");
  await page.getByRole("checkbox", { name: /note for the team/ }).check();
  await page.getByLabel(/A note for the team/).fill("Customer sounds upset");
  await page.getByRole("button", { name: "Add the note" }).click();
  await expect(
    page
      .getByRole("list", { name: "Messages" })
      .getByText("Customer sounds upset"),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /note for the team/ }).uncheck();
  await page.getByLabel(/Your reply/).fill("Checking the courier now.");
  await page.getByRole("button", { name: "Send the reply" }).click();
  await expect(
    page.getByText("Checking the courier now.").first(),
  ).toBeVisible();
  await expect(chat.getByText("Checking the courier now.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(chat.getByText("Customer sounds upset")).toHaveCount(0);
  await accessible(page, "a conversation");

  // a teammate (here: the visitor writing again) changes the conversation while a reply is half written
  const chatUrl = page.url();
  await page
    .getByLabel(/Your reply/)
    .fill("A second reply I have not sent yet");
  await chat.getByLabel("Your message").fill("Any news?");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("New messages arrived while you were looking."),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Send the reply" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "I have read them" }).click();
  await expect(
    page.getByRole("button", { name: "Send the reply" }),
  ).toBeEnabled();
  expect(page.url()).toBe(chatUrl);
  await visitorCtx.close();

  // the email: reply goes out by email once, from the worker; the customer's answer would thread back
  await page.goto(`${workspaceUrl}/inbox`);
  await page.getByRole("link", { name: /Export is broken/ }).click();
  await page
    .getByRole("button", { name: "Send to the review queue as feedback" })
    .click();
  await expect(page.getByText("Sent to the review queue.")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Where this feedback stands" }),
  ).toContainText(/Being read|waiting|no request/);
  await page.getByLabel(/Your reply/).fill("We are fixing the export.");
  await page.getByRole("button", { name: "Send the reply" }).click();
  await expect
    .poll(
      async () =>
        (await outbox()).filter((m) => m.to.includes("dana@acme.test")).length,
      { timeout: 30_000 },
    )
    .toBe(1);
  const mail = (await outbox()).find((m) => m.to.includes("dana@acme.test"))!;
  expect(mail.subject).toMatch(/^Re: Export is broken \[#[a-z0-9]+\]$/);
  expect(mail.text).toBe("We are fixing the export.");

  // close it; it leaves the open list
  await page.getByRole("button", { name: "Close the conversation" }).click();
  await expect(page.getByRole("button", { name: "Reopen it" })).toBeVisible();
  await page.goto(`${workspaceUrl}/inbox`);
  await expect(
    page.getByRole("link", { name: /Export is broken/ }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Closed" }).click();
  await expect(
    page.getByRole("link", { name: /Export is broken/ }),
  ).toBeVisible();
  site.close();
});
