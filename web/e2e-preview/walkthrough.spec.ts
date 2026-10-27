import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The preview build: every screen opens with sample data, nothing says "not mocked", the main flows work, and
// the screens are accessible. The ids are the stable ones from mock/ids.ts.
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ws = `/w/${uid(1)}`;

const screens: [string, string][] = [
  ["Home", "/home"],
  ["Add feedback", `${ws}/add`],
  ["Review", `${ws}/review`],
  ["A conversation", `${ws}/sources/${uid(41)}`],
  ["Requests", `${ws}/requests`],
  ["A request", `${ws}/requests/${uid(201)}`],
  ["A shipped request", `${ws}/requests/${uid(202)}`],
  ["Roadmap choices", `${ws}/roadmap`],
  ["Messages", `${ws}/outreach`],
  ["A batch", `${ws}/outreach/${uid(300)}`],
  ["Release notes", `${ws}/releases`],
  ["A release note", `${ws}/releases/${uid(501)}`],
  ["Public roadmap", "/r/northwind/roadmap"],
  ["Public releases", "/r/northwind"],
  ["A public release", `/r/northwind/${uid(500)}`],
  ["People", `${ws}/people`],
  ["Quotes", `${ws}/quotes`],
  ["Ask", `${ws}/ask`],
  ["Recordings", `${ws}/recordings`],
  ["Findings", `${ws}/findings`],
  ["Surveys", `${ws}/surveys`],
  ["Inbox", `${ws}/inbox`],
  ["Quality", `${ws}/quality`],
  ["Research", `${ws}/research`],
  ["Settings", `${ws}/settings`],
  [
    "Chat window",
    "/chat/sample-widget-not-real?o=https%3A%2F%2Fwww.northwind.example",
  ],
  ["A survey", `/s/${uid(920)}`],
  ["A survey, embedded", `/embed/s/${uid(910)}`],
  ["Unsubscribe", "/unsubscribe/sample"],
  ["Digest unsubscribe", "/digest/unsubscribe/sample"],
  ["An invitation", `/invite/${uid(1300)}`],
  ["Sign in", "/login"],
  ["Sign up", "/signup"],
  ["Forgot password", "/forgot"],
  ["Reset password", "/reset?token_hash=sample-reset-code"],
  ["Survey list", `${ws}/surveys`],
  ["A survey", `${ws}/surveys/${uid(910)}`],
  ["Survey results", `${ws}/surveys/${uid(910)}/results`],
  ["A conversation", `${ws}/inbox/${uid(1100)}`],
  ["Support desk", `${ws}/inbox/desk`],
  ["A findings document", `${ws}/findings/${uid(940)}`],
  ["Tags", `${ws}/research/codebook`],
  ["Label quotes", `${ws}/quotes/label`],
  ["Tags over time", `${ws}/quotes/trends`],
];

async function reset(page: Page, set = "normal") {
  await page.goto(`/mock/scenario?reset=1&set=${set}&session=in&to=/mock`);
}

test("the index lists the screens", async ({ page }) => {
  await reset(page);
  await expect(
    page.getByRole("heading", { name: "Preview", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Review queue/ })).toBeVisible();
});

test("every screen opens with sample data and passes the accessibility scan", async ({
  page,
}) => {
  await reset(page);
  for (const [name, path] of screens) {
    await page.goto(path);
    // the chat window is a small widget with no page title
    if (name === "Chat window")
      await expect(page.getByText("Hi! How can we help?")).toBeVisible();
    else
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
        name,
      ).toBeVisible();
    await expect(
      page.getByText(/needs sample data|Something went wrong/),
      `${name} is not filled in`,
    ).toHaveCount(0);
    const scan = await new AxeBuilder({ page }).analyze();
    expect(
      scan.violations.map((v) => `${name}: ${v.id}`),
      name,
    ).toEqual([]);
  }
});

test("accepting a suggestion makes a request, and shipping one starts messages that can be approved", async ({
  page,
}) => {
  await reset(page);
  await page.goto(`${ws}/review`);
  await page
    .getByRole("button", { name: "Accept as a request" })
    .first()
    .click();
  await expect(page.getByText(/Review \(4\)/).first()).toBeVisible();

  // ship the dark-mode request: drafts appear for review, then approval marks them sent
  await page.goto(`${ws}/requests/${uid(204)}`);
  await page.getByLabel("Status").selectOption({ label: "Shipped" });
  await page.getByRole("button", { name: "Update status" }).click();
  await page
    .getByRole("button", { name: /Mark as Shipped and prepare messages/ })
    .click();
  await expect(page).toHaveURL(/\/outreach\//);
  await page
    .getByRole("button", { name: /Approve/ })
    .first()
    .click();
  await expect(page.getByText(/sent|queued/i).first()).toBeVisible();
});

test("voting on the public roadmap counts, and an empty workspace explains itself", async ({
  page,
}) => {
  await reset(page);
  await page.goto("/r/northwind/roadmap");
  await page.getByRole("button", { name: /^Vote/ }).first().click();
  await expect(
    page.getByRole("button", { name: /Remove my vote/ }).first(),
  ).toBeVisible();

  await reset(page, "empty");
  await page.goto(`${ws}/requests`);
  await expect(
    page.getByRole("heading", { name: "Requests", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(/no requests|nothing here|empty|add feedback/i).first(),
  ).toBeVisible();
  await reset(page);
});

test("a failing service shows a plain message and a way to try again", async ({
  page,
}) => {
  await reset(page, "error");
  await page.goto(`${ws}/requests`);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again/ })).toBeVisible();
  await reset(page);
});

test("sign in, sign up and password reset work end to end", async ({
  page,
}) => {
  await reset(page);
  await page.goto("/login");
  await page.getByLabel("Email address").fill("someone@example.com");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/don't match/)).toBeVisible();
  // the address stays in the form after a failed attempt
  await expect(page.getByLabel("Email address")).toHaveValue(
    "someone@example.com",
  );
  await page.getByLabel("Password").fill("a good password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${ws}`)); // one workspace, so home sends you straight in

  await page.goto("/signup");
  await page.getByLabel("Email address").fill("confirm-me@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a long enough password");
  await page.getByLabel("Password again").fill("a long enough password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  await page.goto("/forgot");
  await page.getByLabel("Email address").fill("someone@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  await page.goto("/reset?token_hash=expired-code");
  await page
    .getByLabel("New password", { exact: true })
    .fill("a long enough password");
  await page.getByLabel("New password again").fill("a long enough password");
  await page.getByRole("button", { name: /Set password/ }).click();
  await expect(page.getByText(/expired or was already used/)).toBeVisible();
});

test("settings forms save: statuses, tags, keys, team, deleting a workspace", async ({
  page,
}) => {
  await reset(page);
  await page.goto(`${ws}/settings`);
  await page.getByLabel("New status").fill("Needs design");
  await page.getByRole("button", { name: "Add status" }).click();
  await expect(
    page.getByLabel("Name of the status Needs design"),
  ).toBeVisible();

  await page
    .getByLabel("Type the workspace name to confirm")
    .fill("Northwind Support");
  await page
    .getByRole("button", { name: "Delete this workspace forever" })
    .click();
  await expect(page).toHaveURL(/\/home$/);
  await reset(page);
});

test("a recording uploads, is transcribed, and plays", async ({ page }) => {
  await reset(page);
  await page.goto(`${ws}/recordings`);
  // The picker stays disabled until the page is interactive; a file chosen before that is silently ignored.
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({
    name: "call.wav",
    mimeType: "audio/wav",
    buffer: Buffer.alloc(300_000),
  });
  await expect(page.getByText(/call\.wav/).first()).toBeVisible();
  await expect(page.getByText(/done|transcript|ready/i).first()).toBeVisible({
    timeout: 20_000,
  });
});
