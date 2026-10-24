import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { query, signIn, sql, uniqueName } from "./helpers";

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

const TEXT =
  "Dana Lee said we really need single sign-on today. Also exports keep dropping rows.";

test("quotes, feelings, tags over time, and a findings document that can be shared and taken down", async ({
  page,
  browser,
}) => {
  const name = uniqueName("fd");
  await signIn(page, name);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;

  // two stored quotes from an interview, on a request that has a tag
  const sso = "we really need single sign-on today";
  const exp = "exports keep dropping rows";
  sql(`
    WITH s AS (INSERT INTO source_item (workspace_id, kind, title, raw_text, content_hash, created_by)
               VALUES ('${ws}','paste','Interview with Dana Lee','${TEXT}','h-${ws}','00000000-0000-0000-0000-000000000001') RETURNING id),
         c AS (INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text)
               SELECT '${ws}', id, 0, 0, ${TEXT.length}, '${TEXT}' FROM s RETURNING id, source_item_id),
         r AS (INSERT INTO request (workspace_id, title) VALUES ('${ws}','Single sign-on') RETURNING id),
         t AS (INSERT INTO tag (workspace_id, name, created_by) VALUES ('${ws}','Sign-in','00000000-0000-0000-0000-000000000001') RETURNING id),
         rt AS (INSERT INTO request_tag (workspace_id, request_id, tag_id) SELECT '${ws}', r.id, t.id FROM r, t RETURNING 1)
    INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by)
    SELECT '${ws}', r.id, c.source_item_id, c.id, q.quote, strpos('${TEXT}', q.quote) - 1, strpos('${TEXT}', q.quote) - 1 + length(q.quote), '00000000-0000-0000-0000-000000000001'
    FROM r, c, (VALUES ('${sso}'), ('${exp}')) AS q(quote)`);

  // the table, with a search and a feeling
  await page.goto(`${workspaceUrl}/quotes`);
  await expect(page.getByText(`“${sso}”`)).toBeVisible();
  await expect(page.getByText(`“${exp}”`)).toBeVisible();
  await accessible(page, "the quotes table");
  await page.getByLabel("Words in the quote").fill("exports");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(`“${sso}”`)).toHaveCount(0);
  await expect(page.getByText(`“${exp}”`)).toBeVisible();
  await page.getByLabel("How this quote feels").selectOption("negative");
  await expect(page.getByLabel("How this quote feels")).toHaveValue("negative");
  expect(
    query(
      `SELECT label || '/' || source FROM quote_sentiment WHERE workspace_id='${ws}'`,
    ),
  ).toEqual(["negative/human"]);
  // and the board, by feeling
  await page.getByLabel("Words in the quote").fill("");
  await page.getByLabel("Show as").selectOption("board");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(
    page.getByRole("heading", { name: /Negative \(1\)/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Not labelled \(1\)/ }),
  ).toBeVisible();
  await accessible(page, "the quotes board");
  await page.getByLabel("How it feels").selectOption("negative");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(`“${sso}”`)).toHaveCount(0);

  // labelling, one quote at a time, without the model's opinion
  await page.goto(`${workspaceUrl}/quotes/label`);
  await expect(page.getByText(`“${sso}”`)).toBeVisible();
  await accessible(page, "labelling");
  await page.getByRole("button", { name: "Positive" }).click();
  await expect(
    page.getByText(/That is all of this batch|no unlabelled quotes left/),
  ).toBeVisible();

  // tags over time, and the honest "not measured yet"
  await page.goto(`${workspaceUrl}/quotes/trends`);
  await expect(page.getByText(/Not measured yet/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign-in" })).toBeVisible();
  await expect(page.getByText(/Negative 1/)).toBeVisible();
  await expect(page.getByText(/Positive 1/)).toBeVisible();
  await accessible(page, "tags over time");

  // a findings document
  await page.goto(`${workspaceUrl}/findings`);
  await expect(page.getByText("No documents yet.")).toBeVisible();
  await page.getByLabel("Title").fill("What customers say about sign-in");
  await page.getByRole("button", { name: "Start a document" }).click();
  await expect(
    page.getByRole("heading", { name: "What customers say about sign-in" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add a paragraph" }).click();
  await page.getByLabel("Paragraph").fill("Sign-in comes up in most calls.");
  await page
    .getByLabel("Add a quote: search what customers said")
    .fill("single");
  await page.getByRole("button", { name: "Find quotes" }).click();
  await page.getByRole("button", { name: "Add this quote" }).click();
  await page.getByLabel(/Your note under this quote/).fill("Unprompted.");
  await expect(
    page.getByRole("button", { name: "Publish with a link" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save the document" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await accessible(page, "the findings editor");

  // sharing needs a yes, and shows words only
  await page.getByRole("checkbox", { name: /I have read every quote/ }).check();
  await page.getByRole("button", { name: "Publish with a link" }).click();
  const link = await page.getByLabel(/Anyone with this link/).inputValue();
  expect(link).toMatch(/\/f\/f\./);
  await expect(page.getByLabel("Paragraph")).toBeDisabled();
  const ctx = await browser.newContext();
  const pub = await ctx.newPage();
  await pub.goto(link);
  await expect(
    pub.getByRole("heading", { name: "What customers say about sign-in" }),
  ).toBeVisible();
  await expect(pub.getByText(`“${sso}”`)).toBeVisible();
  await expect(pub.getByText("Unprompted.")).toBeVisible();
  const html = await pub.content();
  for (const leak of ["Interview", "Dana", ws])
    expect(html).not.toContain(leak);
  await accessible(pub, "the shared document");

  // taking it down ends the link at once
  await page.getByRole("button", { name: "Take it down now" }).click();
  await expect(
    page.getByRole("button", { name: "Publish with a link" }),
  ).toBeVisible();
  await pub.reload();
  await expect(pub.getByText("This page could not be found.")).toBeVisible();
  await ctx.close();

  // a quote deleted at its source shows as removed on its card
  sql(
    `DELETE FROM evidence WHERE workspace_id='${ws}' AND quote_text='${sso}'`,
  );
  await page.reload();
  await expect(page.getByText("Quote removed.")).toBeVisible();
  await expect(
    page.getByText(/must be removed before the document can be shared/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish with a link" }),
  ).toBeDisabled();
});
