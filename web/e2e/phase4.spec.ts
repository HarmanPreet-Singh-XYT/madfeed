import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  chooseFrom,
  query,
  seedProposals,
  signIn,
  sql,
  uniqueName,
} from "./helpers";

const SSO =
  "We really need single sign-on before we can roll this out to the whole company.";
const EXPORT = "A CSV export would save me an hour every Friday.";

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

/** Selects `needle` inside the conversation the way a person would (a real browser selection). */
async function selectText(page: Page, needle: string) {
  await page.evaluate((n) => {
    const article = document.querySelector(
      'article[aria-label="Original text"]',
    )!;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = (node as Text).data.indexOf(n);
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + n.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    throw new Error("text not found");
  }, needle);
}

test("codebook, highlights, request tags and grounded questions", async ({
  page,
}) => {
  await signIn(page, uniqueName("p4"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const workspaceId = workspaceUrl.split("/").pop()!;

  // --- a conversation and a request with one cited quote
  await page.goto(`${workspaceUrl}/add`);
  await page
    .getByLabel("Conversation")
    .fill(`Priya: ${SSO}\n\nPriya: ${EXPORT}\n\nunique ${Date.now()}`);
  await page.getByRole("button", { name: "Find requests" }).click();
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+$/);
  const sourceUrl = page.url();
  seedProposals(sourceUrl.split("/").pop()!, [
    { quote: SSO, title: "Single sign-on", confidence: 0.9 },
  ]);
  await page.goto(`${workspaceUrl}/review`);
  await page.getByRole("button", { name: "Accept as a request" }).click();
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();

  // --- empty states, then the codebook
  await page.goto(`${workspaceUrl}/research`);
  await expect(page.getByText("No highlights yet.")).toBeVisible();
  await page.getByRole("link", { name: "Manage tags" }).click();
  await expect(page.getByText("No tags yet.")).toBeVisible();
  await accessible(page, "empty codebook");

  for (const [name, def, color] of [
    ["Security", "Anything about access control or compliance", "red"],
    ["Reporting", "Getting data out of the product", "blue"],
  ]) {
    await expect(async () => {
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByLabel("What it means").first().fill(def);
      await chooseFrom(page.getByLabel("Colour").first(), color);
      await page.getByRole("button", { name: "Add tag" }).click();
      await expect(page.getByText(`Added “${name}”.`)).toBeVisible({
        timeout: 3_000,
      });
    }).toPass({ timeout: 20_000 });
  }
  await expect(
    page.getByText("Used on 0 highlights and 0 requests"),
  ).toHaveCount(2);
  // the same name again, ignoring case, is refused in plain words
  await page.getByLabel("Name", { exact: true }).fill("security");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(
    page.getByText("a tag with that name already exists"),
  ).toBeVisible();
  await accessible(page, "codebook");
  await noSideways(page);

  // --- highlight a passage in the conversation, with a tag
  await page.goto(sourceUrl);
  await expect(
    page.getByText("Select some words above to highlight them and tag them."),
  ).toBeVisible();
  await expect(async () => {
    await selectText(page, EXPORT);
    await expect(page.getByText("Highlight this passage?")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("checkbox", { name: "Reporting" }).check();
  await page.getByLabel("Note (optional)").fill("Mentioned twice on the call");
  await accessible(page, "highlight panel");
  await page.getByRole("button", { name: "Save highlight" }).click();
  await expect(page.getByText("Highlighted.")).toBeVisible();
  await page.reload();
  const mark = page.locator("mark[data-highlighted]");
  await expect(mark).toHaveText(EXPORT);

  // the stored quote is byte-exact with the source (checked in the database, not the page)
  const stored = query(
    `SELECT quote_text = substr(s.raw_text, h.span_start + 1, h.span_end - h.span_start) AND quote_text = '${EXPORT}' FROM highlight h JOIN source_item s ON s.id = h.source_item_id WHERE h.workspace_id = '${workspaceId}' ORDER BY h.created_at DESC LIMIT 1`,
  );
  expect(stored[0]).toBe("t");

  // --- the research feed, filtered by tag
  await page.goto(`${workspaceUrl}/research`);
  await expect(page.getByText(`“${EXPORT}”`)).toBeVisible();
  await expect(
    page.getByText("Note: Mentioned twice on the call"),
  ).toBeVisible();
  await accessible(page, "research feed");
  await noSideways(page);
  await page
    .getByRole("navigation", { name: "Filter by tag" })
    .getByRole("link", { name: "Security" })
    .click();
  await expect(page.getByText("Nothing has this tag yet.")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Filter by tag" })
    .getByRole("link", { name: "Reporting" })
    .click();
  await expect(page.getByText(`“${EXPORT}”`)).toBeVisible();

  // add a second tag to the highlight
  await page.getByRole("button", { name: "Edit tags" }).click();
  await page.getByRole("checkbox", { name: "Security" }).check();
  await page.getByRole("button", { name: "Save tags" }).click();
  await expect(page.getByRole("checkbox", { name: "Security" })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Filter by tag" })
    .getByRole("link", { name: "Security" })
    .click();
  await expect(page.getByText(`“${EXPORT}”`)).toBeVisible();

  // --- tags on a request
  await page.goto(`${workspaceUrl}/requests`);
  await page.getByRole("link", { name: "Single sign-on" }).click();
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByText("None yet")).toBeVisible();
  await page.getByRole("button", { name: "Edit tags" }).click();
  await page.getByRole("checkbox", { name: "Security" }).check();
  await page.getByRole("button", { name: "Save tags" }).click();
  await expect(
    page.locator("span.rounded-full", { hasText: "Security" }),
  ).toBeVisible();
  await accessible(page, "request with tags");

  // --- merging Reporting into Security, then undoing it
  await page.goto(`${workspaceUrl}/research/codebook`);
  await expect(
    page.getByText("Used on 1 highlight and 0 requests").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Merge Reporting" }).click();
  await expect(
    page.getByText(
      /1 highlight and 0 requests tagged “Reporting” will be tagged “Security” instead/,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Merge into Security" }).click();
  await expect(
    page.getByText(/Merged\. 1 highlight and 0 requests now use the other tag/),
  ).toBeVisible();
  await expect(page.getByText("Merged into “Security”.")).toBeVisible();
  await accessible(page, "codebook after merge");
  await page
    .getByRole("button", { name: "Undo the merge of Reporting" })
    .click();
  await expect(
    page.getByText("Undone. The tag is back exactly as it was."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Merge Reporting" }),
  ).toBeVisible();
  const links = query(
    `SELECT t.name FROM highlight_tag ht JOIN tag t ON t.id = ht.tag_id JOIN highlight h ON h.id = ht.highlight_id WHERE h.workspace_id = '${workspaceId}' AND h.quote_text = '${EXPORT}' ORDER BY 1`,
  );
  expect(links).toEqual(["Reporting", "Security"]);

  // --- ask: an answer with its quote, then an honest "not enough evidence"
  await page.goto(`${workspaceUrl}/ask`);
  await page
    .getByLabel("Your question")
    .fill("Why do customers want single sign-on?");
  await page.getByRole("button", { name: "Ask" }).click();
  const card = page.getByRole("article", {
    name: /Answer to: Why do customers want single sign-on/,
  });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Customers raised this in their own words");
  await expect(card.getByText(`“${SSO}”`)).toBeVisible();
  await accessible(page, "answer");
  await card.getByRole("link", { name: "See it in the conversation" }).click();
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+\?s=\d+&e=\d+/);
  await expect(page.locator("mark#quote")).toHaveText(SSO);
  await page.goBack();

  await page
    .getByLabel("Your question")
    .fill("What did customers say about zebra pricing?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(
    page.getByText("Not enough evidence to answer that."),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Yes" }).first().click();
  await expect(page.getByText("Thanks, noted.").first()).toBeVisible();
  await noSideways(page);

  // earlier questions persist across a reload
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Earlier questions" }),
  ).toBeVisible();
  await expect(
    page.getByText("What did customers say about zebra pricing?"),
  ).toBeVisible();
});

test("a viewer can read tags, highlights and ask, but cannot change anything", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("owner4"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const workspaceId = workspaceUrl.split("/").pop()!;
  await page.goto(`${workspaceUrl}/research/codebook`);
  await page.getByLabel("Name", { exact: true }).fill("Pricing");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByText("Added “Pricing”.")).toBeVisible();

  const ctx = await browser.newContext();
  const vp = await ctx.newPage();
  await signIn(vp, uniqueName("view4"));
  const token = (await ctx.cookies()).find((c) => c.name === "session")!.value;
  const sub = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ).sub as string;
  sql(
    `INSERT INTO member (workspace_id, user_id, role) VALUES ('${workspaceId}', '${sub}', 'viewer')`,
  );

  await vp.goto(`${workspaceUrl}/research/codebook`);
  await expect(vp.getByText("Pricing", { exact: true }).first()).toBeVisible();
  await expect(vp.getByRole("button", { name: "Add tag" })).toHaveCount(0);
  await expect(vp.getByRole("button", { name: /^Edit Pricing/ })).toHaveCount(
    0,
  );
  await expect(vp.getByRole("button", { name: /^Merge|^Archive/ })).toHaveCount(
    0,
  );
  await vp.goto(`${workspaceUrl}/research`);
  await expect(vp.getByRole("heading", { name: "Research" })).toBeVisible();
  await vp.goto(`${workspaceUrl}/ask`);
  await vp.getByLabel("Your question").fill("Anything about pricing?");
  await vp.getByRole("button", { name: "Ask" }).click();
  await expect(vp.getByText("Not enough evidence to answer that.")).toBeVisible(
    { timeout: 20_000 },
  );
  await ctx.close();
});
