import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  clearOutbox,
  outbox,
  query,
  seedProposals,
  signIn,
  sql,
  uniqueName,
} from "./helpers";

const SSO =
  "We really need SSO before we can roll this out to the whole company.";

const CSV = `Name,Email,Company,ARR
Dana Lee,dana@acme.com,Acme Inc,"$100,000"
Raj Patel,raj@acme.com,Acme Inc,100000
Solo Person,,Globex Corp,5000
`;

async function accessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = r.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help}`),
    `accessibility problems on ${label}`,
  ).toEqual([]);
}

async function noSideways(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

async function addConversation(
  page: Page,
  workspaceUrl: string,
  person: string,
) {
  await page.goto(`${workspaceUrl}/add`);
  await page.getByLabel("Who said it").selectOption({ label: person });
  await page
    .getByLabel("Conversation")
    .fill(`${SSO}\n\nunique ${Date.now()}${Math.random()}`);
  await page.getByRole("button", { name: "Find requests" }).click();
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+$/);
  seedProposals(page.url().split("/").pop()!, [
    { quote: SSO, title: "Single sign-on", confidence: 0.9 },
  ]);
  await expect(page.getByText("Found 1 request to review")).toBeVisible({
    timeout: 15_000,
  });
}

test("ship a request, review and approve personal messages, unsubscribe, publish release notes", async ({
  page,
  browser,
}) => {
  await clearOutbox();
  sql("DELETE FROM suppression WHERE email LIKE '%@acme.com'"); // the phone run follows the desktop run
  const slug = `e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  // --- workspace, sender name and public address
  await signIn(page, uniqueName("p3"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");

  await page.goto(`${workspaceUrl}/settings?tab=customers`);
  await expect(async () => {
    await page.getByLabel("Name that signs messages").fill("Priya from Acme");
    await page.getByLabel("Public address for release notes").fill(slug);
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.reload();
    await expect(
      page.getByLabel("Public address for release notes"),
    ).toHaveValue(slug, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await accessible(page, "settings");

  // --- people, then everyone asks for the same thing (Solo has no email address)
  await page.goto(`${workspaceUrl}/people`);
  await expect(async () => {
    await page.getByLabel("CSV file").setInputFiles({
      name: "customers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CSV),
    });
    await expect(page.getByText("3 rows ready")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Import 3 rows" }).click();
  await expect(page.getByText("Import finished")).toBeVisible();

  await addConversation(page, workspaceUrl, "Dana Lee (Acme Inc)");
  await page.goto(`${workspaceUrl}/review`);
  await page.getByRole("button", { name: "Accept as a request" }).click();
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();
  for (const person of ["Raj Patel (Acme Inc)", "Solo Person (Globex Corp)"]) {
    await addConversation(page, workspaceUrl, person);
    await page.goto(`${workspaceUrl}/review`);
    await page
      .getByLabel("Add it to")
      .selectOption({ label: "Single sign-on" });
    await page.getByRole("button", { name: "Accept as a request" }).click();
    await expect(page.getByText("Nothing to review right now.")).toBeVisible();
  }

  // --- mark it shipped: the consequence is spelled out first, and nothing is sent
  await page.goto(`${workspaceUrl}/requests`);
  await page.getByRole("link", { name: "Single sign-on" }).click();
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/);
  const requestUrl = page.url();
  const requestId = requestUrl.split("/").pop()!;
  await expect(
    page.getByRole("heading", { name: "Single sign-on", level: 1 }),
  ).toBeVisible();
  await page.locator("#status").selectOption({ label: "Shipped" });
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(
    page.getByText("Nothing is sent until you approve it."),
  ).toBeVisible();
  await accessible(page, "ship confirmation");
  await page
    .getByRole("button", { name: "Mark as Shipped and prepare messages" })
    .click();

  // --- review the drafts
  await expect(page).toHaveURL(/\/outreach\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Single sign-on", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "1 person asked for this but we have no email address for them.",
    ),
  ).toBeVisible();
  const dana = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Dana Lee" }) });
  const raj = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Raj Patel" }) });
  await expect(dana.getByLabel("Subject")).toBeVisible({ timeout: 20_000 }); // the worker has written the drafts
  await expect(raj.getByLabel("Subject")).toBeVisible();
  await expect(dana.getByText("Based on what they said")).toBeVisible();
  await expect(dana.locator("li").first()).toContainText(SSO.slice(0, 20));
  await expect(dana.getByLabel("Message")).toHaveValue(/^Hi Dana,/);
  await expect(dana.getByLabel("Message")).not.toHaveValue(
    /Raj|Solo|Globex|100,000/,
  );
  await accessible(page, "message review");
  await noSideways(page);

  expect(await outbox(), "nothing may be sent before approval").toHaveLength(0);

  // --- edit one, leave the other out and back in
  await dana.getByLabel("Subject").fill("Single sign-on is live");
  await dana
    .getByLabel("Message")
    .fill(
      "Hi Dana,\n\nYou told us you needed single sign-on, and it is live today. Thank you.\n\nPriya from Acme",
    );
  await dana.getByRole("button", { name: "Save changes" }).click();
  await expect(async () => {
    await page.reload();
    await expect(dana.getByLabel("Subject")).toHaveValue(
      "Single sign-on is live",
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 15_000 });
  await raj.getByRole("button", { name: /Don't send to Raj/ }).click();
  await expect(raj.getByText("Left out")).toBeVisible();
  await raj.getByRole("button", { name: "Include Raj again" }).click();
  await expect(raj.getByLabel("Subject")).toBeVisible();

  // --- approval needs a second, explicit confirmation that says what happens
  await expect(
    page.getByText("2 people will each get one email from Priya from Acme"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve and send 2 messages" })
    .click();
  await expect(
    page.getByRole("group", { name: "Confirm sending" }),
  ).toContainText("Send 2 emails now?");
  expect(await outbox()).toHaveLength(0);
  await page.getByRole("button", { name: "Yes, send 2 emails" }).click();
  await expect(page.getByText("Sent").first()).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/^Sent · /)).toHaveCount(2, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // --- exactly what was delivered
  const mail = await outbox();
  expect(mail).toHaveLength(2);
  const toDana = mail.find((m) => m.to[0] === "dana@acme.com")!;
  const toRaj = mail.find((m) => m.to[0] === "raj@acme.com")!;
  expect(toDana.subject).toBe("Single sign-on is live");
  expect(toDana.from).toBe("Priya from Acme <updates@mail.dev.local>");
  expect(toDana.text).toContain("it is live today");
  expect(toDana.text).not.toMatch(/Raj|Solo|Globex|100,000|raj@/);
  expect(toRaj.text).toMatch(/^Hi Raj,/);
  expect(toRaj.text).not.toMatch(/Dana|Solo|Globex|dana@/);
  expect(toDana.to).toHaveLength(1);
  const unsubUrl = toDana.text.match(/unsubscribe: (http\S+)/)![1];
  expect(unsubUrl).toMatch(/^http:\/\/127\.0\.0\.1:13000\/unsubscribe\//);
  expect(toDana.headers?.["List-Unsubscribe"]).toBe(`<${unsubUrl}>`);
  expect(toDana.headers?.["List-Unsubscribe-Post"]).toBe(
    "List-Unsubscribe=One-Click",
  );
  expect(toDana.idempotencyKey).toMatch(/^outreach-[0-9a-f-]{36}$/);

  // --- the request now records who was told
  await page.goto(requestUrl);
  const told = page
    .getByRole("heading", { name: "Told about this" })
    .locator("xpath=..");
  await expect(told).toContainText("Dana Lee");
  await expect(told).toContainText("Raj Patel");
  await expect(told).not.toContainText("Solo Person");

  // --- unsubscribing: a stranger's browser, no sign-in; opening the link changes nothing until the button is pressed
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  await sp.goto(unsubUrl);
  await expect(
    sp.getByRole("heading", { name: "Stop these emails?" }),
  ).toBeVisible();
  await expect(sp.getByText("d***@acme.com")).toBeVisible();
  await accessible(sp, "unsubscribe");
  expect(
    query(
      `SELECT count(*) FROM suppression WHERE email='dana@acme.com' AND reason='unsubscribed'`,
    )[0],
  ).toBe("0");
  await expect(async () => {
    await sp.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(sp.getByText("You're unsubscribed.")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 15_000 });
  expect(
    query(
      `SELECT count(*) FROM suppression WHERE email='dana@acme.com' AND reason='unsubscribed'`,
    )[0],
  ).toBe("1");
  const bad = await stranger.newPage();
  await bad.goto(unsubUrl.slice(0, -4) + "AAAA");
  await expect(
    bad.getByRole("heading", { name: "This link isn't valid" }),
  ).toBeVisible();

  // --- release notes: write, link the request, publish; the public page needs no sign-in
  await page.goto(`${workspaceUrl}/releases`);
  await page.getByLabel("Title").fill("Single sign-on is here");
  await page.getByRole("button", { name: "Start a note" }).click();
  await expect(page).toHaveURL(/\/releases\/[0-9a-f-]{36}$/);
  const noteUrl = page.url();
  const noteId = noteUrl.split("/").pop()!;
  await page
    .getByLabel("What changed")
    .fill(
      "You can now sign in with your company account.\n\nAsk your admin to switch it on.",
    );
  await page.getByLabel("Single sign-on", { exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByLabel("Single sign-on", { exact: true }),
    ).toBeChecked({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await accessible(page, "release note editor");
  await noSideways(page);

  const publicPage = await stranger.newPage();
  await publicPage.goto(`/r/${slug}`);
  await expect(
    publicPage.getByText("Nothing has been published yet."),
  ).toBeVisible();
  // The page streams, so the status is 200 even for "not found"; what matters is that no draft text is served.
  const unpublishedHtml = await (
    await publicPage.request.get(`/r/${slug}/${noteId}`)
  ).text();
  expect(unpublishedHtml).not.toContain("Single sign-on is here");
  expect(unpublishedHtml).not.toContain("switch it on");

  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  await publicPage.goto(`/r/${slug}`);
  await expect(
    publicPage.getByRole("heading", { name: "Single sign-on is here" }),
  ).toBeVisible();
  await expect(
    publicPage.getByText("Ask your admin to switch it on."),
  ).toBeVisible();
  const html = await publicPage.content();
  for (const leak of [
    "Dana",
    "Raj",
    "Solo",
    "dana@",
    "100,000",
    requestId,
    "Globex",
  ]) {
    expect(html, `the public page must not contain ${leak}`).not.toContain(
      leak,
    );
  }
  await accessible(publicPage, "public release page");
  await publicPage
    .getByRole("link", { name: "Single sign-on is here" })
    .click();
  await expect(
    publicPage.getByRole("heading", {
      name: "Single sign-on is here",
      level: 1,
    }),
  ).toBeVisible();
  await accessible(publicPage, "public release note");

  // --- taking it down removes it everywhere
  await page.getByRole("button", { name: "Take it down" }).click();
  await expect(page.getByText("Taken off the public page.")).toBeVisible();
  await publicPage.goto(`/r/${slug}`);
  await expect(
    publicPage.getByText("Nothing has been published yet."),
  ).toBeVisible();
  // The page streams, so the status is 200 even for "not found"; what matters is that no draft text is served.
  const unpublishedAgain = await (
    await publicPage.request.get(`/r/${slug}/${noteId}`)
  ).text();
  expect(unpublishedAgain).not.toContain("Single sign-on is here");
  expect(unpublishedAgain).not.toContain("switch it on");

  // --- scheduling in the browser's own zone; it stays private until due
  await expect(page.getByText(/Your time zone: /)).toBeVisible();
  const inAnHour = new Date(Date.now() + 3 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = `${inAnHour.getFullYear()}-${pad(inAnHour.getMonth() + 1)}-${pad(inAnHour.getDate())}T${pad(inAnHour.getHours())}:${pad(inAnHour.getMinutes())}`;
  await page.getByLabel("Or publish at").fill(local);
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText("Scheduled.", { exact: true })).toBeVisible();
  await expect(page.getByText(/goes live /)).toBeVisible({ timeout: 15_000 });
  // The page streams, so the status is 200 even for "not found"; what matters is that no draft text is served.
  const scheduledHtml = await (
    await publicPage.request.get(`/r/${slug}/${noteId}`)
  ).text();
  expect(scheduledHtml).not.toContain("Single sign-on is here");
  expect(scheduledHtml).not.toContain("switch it on");
  const stored = query(
    `SELECT extract(epoch FROM scheduled_for)::bigint FROM release_note WHERE id='${noteId}'`,
  )[0];
  expect(
    Math.abs(Number(stored) - Math.floor(inAnHour.getTime() / 1000)),
  ).toBeLessThanOrEqual(60); // the instant the person meant, whatever the zone
  await stranger.close();
});

test("a viewer can read messages and release notes but cannot send or publish", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("owner3"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const workspaceId = workspaceUrl.split("/").pop()!;
  await page.goto(`${workspaceUrl}/releases`);
  await page.getByLabel("Title").fill("A note");
  await page.getByRole("button", { name: "Start a note" }).click();
  await expect(page).toHaveURL(/\/releases\/[0-9a-f-]{36}$/);
  const noteUrl = page.url();

  const ctx = await browser.newContext();
  const vp = await ctx.newPage();
  await signIn(vp, uniqueName("view3"));
  const token = (await ctx.cookies()).find((c) => c.name === "session")!.value;
  const sub = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ).sub as string;
  query(`SELECT 1`);
  const { sql } = await import("./helpers");
  sql(
    `INSERT INTO member (workspace_id, user_id, role) VALUES ('${workspaceId}', '${sub}', 'viewer')`,
  );

  await vp.goto(noteUrl);
  await expect(
    vp.getByRole("heading", { name: "A note", level: 1 }),
  ).toBeVisible();
  await expect(vp.getByRole("button", { name: "Publish now" })).toHaveCount(0);
  await expect(
    vp.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
  await vp.goto(`${workspaceUrl}/releases`);
  await expect(vp.getByRole("button", { name: "Start a note" })).toHaveCount(0);
  await vp.goto(`${workspaceUrl}/settings?tab=customers`);
  await expect(
    vp.getByText("Only workspace admins can change these."),
  ).toBeVisible();
  await expect(vp.getByRole("button", { name: "Save settings" })).toHaveCount(
    0,
  );
  await ctx.close();
});
