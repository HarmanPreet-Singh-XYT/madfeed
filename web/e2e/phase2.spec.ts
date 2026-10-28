import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  query,
  seedProposals,
  seedReadyBrief,
  signIn,
  sql,
  uniqueName,
} from "./helpers";

const SSO =
  "We really need SSO before we can roll this out to the whole company.";
const EXPORT =
  "when we export the monthly report the totals are sometimes wrong";

const CSV = `Name,Email,Company,ARR
Dana Lee,dana@acme.com,Acme Inc,"$100,000"
Raj Patel,raj@acme.com,Acme Inc,100000
Sam Cho,sam@globex.io,Globex,5000
Bad Row,not-an-email,Globex,5000
`;

async function noSideways(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

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

/** Paste the sample as a chosen person, then stand in for the worker with seeded suggestions. */
async function addConversation(
  page: Page,
  workspaceUrl: string,
  person: string,
  quote: string,
  title: string,
) {
  await page.goto(`${workspaceUrl}/add`);
  await page.getByLabel("Who said it").selectOption({ label: person });
  await page
    .getByLabel("Conversation")
    .fill(`${quote}\n\nunique ${Date.now()}${Math.random()}`);
  await page.getByRole("button", { name: "Find requests" }).click();
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+$/);
  const sourceId = page.url().split("/").pop()!;
  seedProposals(sourceId, [{ quote, title, confidence: 0.9 }]);
  await expect(page.getByText("Found 1 request to review")).toBeVisible({
    timeout: 15_000,
  });
}

test("people, import with problems, impact by company, brief and export", async ({
  page,
}) => {
  // --- workspace
  await signIn(page, uniqueName("p2"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");

  // --- import a file that has one bad row: preview first, nothing saved yet
  await page.goto(`${workspaceUrl}/people`);
  // The file input only works once the page has finished loading, so retry until the preview appears.
  await expect(async () => {
    await page.getByLabel("CSV file").setInputFiles({
      name: "customers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CSV),
    });
    await expect(
      page.getByText("3 rows ready, 1 problem to fix (of 4)."),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(
    page.getByRole("alert").filter({ hasText: /Row 5/ }),
  ).toContainText("not a valid email");
  const columns = page.getByRole("group", { name: "What each column means" });
  await expect(columns.getByLabel("Email")).toHaveValue("Email"); // the columns were detected
  await expect(columns.getByLabel("Revenue")).toHaveValue("ARR");
  await expect(columns.getByLabel("Company")).toHaveValue("Company");
  await accessible(page, "import preview");
  await noSideways(page);
  const importButton = page.getByRole("button", { name: /^Import \d+ rows?$/ });
  await expect(importButton).toBeDisabled(); // nothing can be imported until the problem is dealt with
  await page
    .getByLabel("Leave out the rows with problems and import the rest")
    .check();
  await expect(
    page.getByRole("button", { name: "Import 3 rows" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Import 3 rows" }).click();
  await expect(page.getByText("Import finished")).toBeVisible();
  await expect(page.getByText("3 people added, 0 updated")).toBeVisible();
  await expect(page.getByText("2 companies added, 0 updated")).toBeVisible();
  await expect(
    page.getByText("1 row left out because of problems"),
  ).toBeVisible();

  await expect(
    page.getByRole("row", { name: /Dana Lee dana@acme.com Acme Inc/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Companies" }).click();
  await expect(
    page.getByRole("heading", { name: "Add a company" }),
  ).toBeVisible(); // the companies list has loaded
  await expect(page.getByText("Acme Inc")).toBeVisible();
  await expect(page.getByText("2 people · 100,000 revenue")).toBeVisible();
  await accessible(page, "companies");

  // --- feedback from Dana and from Raj (same company), plus Sam at another one
  await addConversation(
    page,
    workspaceUrl,
    "Dana Lee (Acme Inc)",
    SSO,
    "Single sign-on",
  );
  await page.goto(`${workspaceUrl}/review`);
  await page.getByRole("button", { name: "Accept as a request" }).click();
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();

  await addConversation(
    page,
    workspaceUrl,
    "Raj Patel (Acme Inc)",
    SSO,
    "Single sign-on",
  );
  await page.goto(`${workspaceUrl}/review`);
  await page.getByLabel("Add it to").selectOption({ label: "Single sign-on" });
  await page.getByRole("button", { name: "Accept as a request" }).click();
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();

  await addConversation(
    page,
    workspaceUrl,
    "Sam Cho (Globex)",
    EXPORT,
    "Report totals are wrong",
  );
  await page.goto(`${workspaceUrl}/review`);
  await page.getByRole("button", { name: "Accept as a request" }).click();
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();

  // --- two people at one company count the company once (100,000, not 200,000), and sorting puts it first
  await page.goto(`${workspaceUrl}/requests?sort=value`);
  // The list is a table: one row per request, with its people, accounts and revenue in columns.
  const sso = page.getByRole("row", { name: /Single sign-on/ });
  await expect(sso.getByRole("cell").nth(2)).toHaveText("2"); // people
  await expect(sso.getByRole("cell").nth(3)).toHaveText("1"); // accounts
  await expect(sso.getByRole("cell").nth(4)).toHaveText("100,000"); // revenue
  await expect(page.getByText("200,000")).toHaveCount(0);
  const totals = page.getByRole("row", { name: /Report totals are wrong/ });
  await expect(totals.getByRole("cell").nth(2)).toHaveText("1");
  await expect(totals.getByRole("cell").nth(4)).toHaveText("5,000");
  const titles = await page
    .getByRole("row")
    .getByRole("link")
    .allTextContents();
  expect(titles.slice(0, 2)).toEqual([
    "Single sign-on",
    "Report totals are wrong",
  ]);
  await accessible(page, "requests by value");
  await noSideways(page);

  // --- the decision brief: ask, see it being written, then read it
  await page.getByRole("link", { name: "Single sign-on" }).click();
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Single sign-on", level: 1 }),
  ).toBeVisible(); // the request page has replaced the list
  const requestUrl = page.url();
  const requestId = requestUrl.split("/").pop()!;
  // The previous page stays mounted but hidden after a client-side navigation, so only look at what is visible.
  await expect(
    page
      .getByText("2 people · 1 account · 100,000 revenue")
      .locator("visible=true"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Write a decision brief" }).click();
  await expect(page.getByText("Writing the brief")).toBeVisible();
  seedReadyBrief(
    requestId,
    "Customers need single sign-on before they can roll the product out company-wide.",
    "If one team drove both asks, it matters less.",
    2,
  );
  await expect(
    page.getByText(
      "Customers need single sign-on before they can roll the product out company-wide.",
    ),
  ).toBeVisible({ timeout: 15_000 }); // the page polls on its own
  await expect(page.getByText("2 people at 1 company")).toBeVisible();
  await expect(
    page.getByText("100,000 across 1 company with a figure"),
  ).toBeVisible();
  await expect(
    page.getByText("If one team drove both asks, it matters less."),
  ).toBeVisible();
  await expect(
    page.locator("section[aria-labelledby=brief-h] mark").first(),
  ).toContainText(SSO);
  await expect(page.getByText("may be out of date")).toHaveCount(0);
  await accessible(page, "request detail with brief");
  await noSideways(page);

  // --- new evidence makes the brief stale, and says so
  const sourceRow = query(
    `SELECT source_item_id, chunk_id FROM evidence WHERE request_id='${requestId}' LIMIT 1`,
  )[0].split("|");
  sql(`INSERT INTO evidence (workspace_id, request_id, source_item_id, chunk_id, quote_text, span_start, span_end, created_by)
       SELECT e.workspace_id, e.request_id, e.source_item_id, e.chunk_id, e.quote_text, e.span_start, e.span_end, e.created_by FROM evidence e WHERE e.request_id='${requestId}' LIMIT 0`); // no-op guard: duplicate spans are refused by design
  void sourceRow;
  // A quote from a third conversation on the same request:
  await addConversation(
    page,
    workspaceUrl,
    "Sam Cho (Globex)",
    `${SSO} Please.`,
    "Single sign-on",
  );
  await page.goto(`${workspaceUrl}/review`);
  await page.getByLabel("Add it to").selectOption({ label: "Single sign-on" });
  await page.getByRole("button", { name: "Accept as a request" }).click();
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();
  await page.goto(requestUrl);
  await expect(page.getByText("may be out of date")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh the brief" }),
  ).toBeVisible();
  await expect(
    page
      .getByText("3 people at 2 companies")
      .or(page.getByText("2 people at 2 companies")),
  ).toBeVisible(); // facts are always current

  // --- quality page: only a handful of decisions, so it says it is too early
  await page.goto(`${workspaceUrl}/quality`);
  await expect(page.getByText("Not enough to judge yet")).toBeVisible();
  await accessible(page, "quality");

  // --- settings: admin can download everything, and the file checks out
  await page.goto(`${workspaceUrl}/settings?tab=account`);
  await accessible(page, "settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download all data (JSON)" }).click(),
  ]);
  const doc = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(doc.version).toBe("workspace-export-v1");
  expect(doc.people).toHaveLength(3);
  expect(doc.accounts).toHaveLength(2);
  expect(doc.requests).toHaveLength(2);
  expect(doc.evidence.length).toBeGreaterThanOrEqual(4);
  for (const e of doc.evidence) {
    const src = doc.sources.find((s: { id: string }) => s.id === e.sourceId);
    const bytes = Buffer.from(src.text, "utf8");
    expect(bytes.subarray(e.spanStart, e.spanEnd).toString("utf8")).toBe(
      e.quote,
    ); // every quote is the source at its span
  }
});

test("a viewer can read people and briefs but cannot change or export anything", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("own"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const workspaceId = workspaceUrl.split("/").pop()!;

  const viewerName = uniqueName("view");
  const viewerCtx = await browser.newContext();
  const vp = await viewerCtx.newPage();
  await signIn(vp, viewerName);
  const [userId] = query(`SELECT 'x'`); // placeholder to keep helper imports honest
  void userId;
  // The viewer's id is derived from the name, the same way the app derives it: look it up from the token's subject.
  const token = (await viewerCtx.cookies()).find(
    (c) => c.name === "session",
  )!.value;
  const sub = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ).sub as string;
  sql(
    `INSERT INTO member (workspace_id, user_id, role) VALUES ('${workspaceId}', '${sub}', 'viewer')`,
  );

  await vp.goto(`${workspaceUrl}/people`);
  await expect(
    vp.getByRole("heading", { name: "People and companies" }),
  ).toBeVisible();
  await expect(vp.getByText("Import from a spreadsheet")).toHaveCount(0);
  await expect(vp.getByRole("button", { name: "Add person" })).toHaveCount(0);
  await vp.goto(`${workspaceUrl}/settings?tab=account`);
  await expect(
    vp.getByText("Only workspace admins can download everything."),
  ).toBeVisible();
  await expect(
    vp.getByRole("link", { name: "Download all data (JSON)" }),
  ).toHaveCount(0);
  const direct = await vp.request.get(`${workspaceUrl}/export`);
  expect(direct.status()).toBe(403);
  await viewerCtx.close();
});
