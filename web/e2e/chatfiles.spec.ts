import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { signIn, uniqueName } from "./helpers";

const WEB = "http://127.0.0.1:13000";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("a visitor sends a picture in chat; the team downloads it and answers with a PDF", async ({
  page,
  browser,
}) => {
  let token = "";
  const site = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><title>Shop</title><main><h1>Our shop</h1></main><script src="${WEB}/chat.js" data-widget="${token}" async></script>`,
    );
  });
  await new Promise<void>((ok) => site.listen(0, "127.0.0.1", ok));
  const siteOrigin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  await signIn(page, uniqueName("cf"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");

  await page.goto(`${workspaceUrl}/settings`);
  await page.getByLabel(/Sites that may show the chat/).fill(siteOrigin);
  await page.getByRole("checkbox", { name: "Website chat" }).check();
  await page.getByRole("button", { name: "Save the inbox settings" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.reload();
  token = /data-widget="([^"]+)"/.exec(
    await page.getByLabel(/Paste this into your website/).inputValue(),
  )![1];

  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  const polled = visitor.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/chat/"),
  );
  await visitor.goto(siteOrigin);
  await visitor.getByRole("button", { name: "Open chat" }).click();
  const chat = visitor.frameLocator("iframe[title=Chat]");
  // the window's first check for replies runs once it is interactive; a file chosen earlier would be ignored
  await polled;
  await chat.getByLabel(/Add a picture, PDF or text file/).setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(chat.getByText(/receipt\.png \(/)).toBeVisible();
  // a web page is refused
  await chat.getByLabel(/Add a picture, PDF or text file/).setInputFiles({
    name: "page.html",
    mimeType: "text/html",
    buffer: Buffer.from("<html><script>1</script></html>"),
  });
  await expect(chat.getByText(/only pictures/i)).toBeVisible();
  await chat.getByLabel("Your message").fill("This is my receipt");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByRole("button", { name: "receipt.png" })).toBeVisible();

  // the team sees it and downloads the file as it was sent
  await page.goto(`${workspaceUrl}/inbox`);
  await page.getByRole("link", { name: /This is my receipt/ }).click();
  const link = page.getByRole("link", { name: "receipt.png" });
  await expect(link).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    link.click(),
  ]);
  expect(download.suggestedFilename()).toBe("receipt.png");

  // and answers with a PDF, which the visitor can download
  await page.getByLabel(/Attach a picture, PDF or text file/).setInputFiles({
    name: "guide.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await expect(
    page.getByRole("button", { name: "Remove guide.pdf" }),
  ).toBeVisible();
  await page.getByLabel(/Your reply/).fill("Here is the guide.");
  await page.getByRole("button", { name: "Send the reply" }).click();
  await expect(page.getByRole("link", { name: "guide.pdf" })).toBeVisible();

  await expect(chat.getByRole("button", { name: "guide.pdf" })).toBeVisible({
    timeout: 15000,
  });
  const [got] = await Promise.all([
    visitor.waitForEvent("download"),
    chat.getByRole("button", { name: "guide.pdf" }).click(),
  ]);
  expect(got.suggestedFilename()).toBe("guide.pdf");
  site.close();
});
