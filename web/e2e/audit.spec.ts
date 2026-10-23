import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { query, signIn, sql, uniqueName } from "./helpers";

test("an admin checks a sampled answer against its quote; members never see spot checks", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("audit"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const url = page.url().replace(/\/add$/, "");
  const ws = url.split("/").pop()!;
  const user = query(
    `SELECT user_id FROM member WHERE workspace_id='${ws}'`,
  )[0];

  await page.goto(`${url}/quality`);
  await expect(
    page.getByRole("heading", { name: "Spot checks" }),
  ).toBeVisible();
  await expect(page.getByText("Nothing to check yet.")).toBeVisible();

  // An answered question with a cited quote, and the weekly sampler picking it up.
  sql(`
    WITH s AS (INSERT INTO source_item (workspace_id, kind, raw_text, content_hash, created_by) VALUES ('${ws}','paste','We really need single sign-on today.','${ws}-h','${user}') RETURNING id),
         c AS (INSERT INTO chunk (workspace_id, source_item_id, ordinal, start_offset, end_offset, text) SELECT '${ws}', id, 0, 0, 36, 'We really need single sign-on today.' FROM s RETURNING id, source_item_id),
         r AS (INSERT INTO request (workspace_id, title) VALUES ('${ws}','SSO') RETURNING id),
         e AS (INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by) SELECT '${ws}', r.id, c.source_item_id, c.id, 'single sign-on', 15, 29, '${user}' FROM r, c RETURNING id),
         a AS (INSERT INTO qa_answer (workspace_id, asked_by, question, outcome, answer) VALUES ('${ws}','${user}','Why do people want SSO?','answered','Customers say they need single sign-on [1].') RETURNING id)
    INSERT INTO qa_citation (workspace_id, answer_id, ordinal, evidence_id) SELECT '${ws}', a.id, 1, e.id FROM a, e;
    SELECT sample_for_audit(3);`);
  await page.reload();
  const item = page.getByRole("listitem", {
    name: /Answer to check: Why do people want SSO\?/,
  });
  await expect(item).toBeVisible();
  await expect(
    item.getByText("Customers say they need single sign-on [1]."),
  ).toBeVisible();
  await expect(item.getByText("“single sign-on”")).toBeVisible();
  await expect(page.getByText(/1 waiting\./)).toBeVisible();
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    r.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);

  await item.getByLabel(/What was wrong/).fill("Looks right to me");
  await item.getByRole("button", { name: "The quotes support it" }).click();
  await expect(item.getByText(/the quotes support it/i).first()).toBeVisible();
  await expect(
    item.getByRole("button", { name: "The quotes support it" }),
  ).toHaveCount(0);
  expect(
    query(
      `SELECT verdict||'|'||note FROM audit_sample WHERE workspace_id='${ws}'`,
    ),
  ).toEqual(["supported|Looks right to me"]);
  await page.reload();
  await expect(
    page.getByText(/You've checked 1: 1 was backed by their quotes\./),
  ).toBeVisible();

  // A member of the workspace sees the Quality screen without the spot checks.
  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  await signIn(m, uniqueName("audit-member"));
  const token = (await ctx.cookies()).find((c) => c.name === "session")!.value;
  const sub = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ).sub as string;
  sql(
    `INSERT INTO member (workspace_id, user_id, role) VALUES ('${ws}', '${sub}', 'member')`,
  );
  await m.goto(`${url}/quality`);
  await expect(
    m.getByRole("heading", { name: "Quality", level: 1 }),
  ).toBeVisible();
  await expect(m.getByRole("heading", { name: "Spot checks" })).toHaveCount(0);
  await ctx.close();
});
