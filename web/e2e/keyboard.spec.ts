import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedProposals, uniqueName } from "./helpers";

// The core flows (spec F1 first run, F2 triage, F3 decide, F4 up to the ship
// confirmation) done with the keyboard alone: Tab, Shift+Tab, Enter, typing.
// Nothing here may use the mouse (`click`, `fill`, `selectOption`).

const SSO =
  "We really need single sign-on before we can roll this out to the whole company.";

async function isFocused(target: Locator) {
  return target
    .first()
    .evaluate((el) => el === document.activeElement)
    .catch(() => false);
}

/** Tab until `target` has focus; fails if it is unreachable. Also checks the focus ring is visible. */
async function tabTo(page: Page, target: Locator, label: string) {
  await expect(target.first(), `${label} is on the page`).toBeVisible({
    timeout: 15_000,
  });
  for (let i = 0; i < 120; i++) {
    if (await isFocused(target)) {
      const visible = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e || e === document.body) return false;
        const s = getComputedStyle(e);
        const outline =
          s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        return outline || s.boxShadow !== "none";
      });
      expect(visible, `no visible focus ring on ${label}`).toBe(true);
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`${label} cannot be reached with the keyboard`);
}

async function typeInto(
  page: Page,
  target: Locator,
  label: string,
  text: string,
) {
  await tabTo(page, target, label);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

test("first run, triage and deciding work with the keyboard alone", async ({
  page,
}) => {
  // --- sign in
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(async () => {
    // wait for the page to be interactive (the field is typed into, not clicked)
    await typeInto(
      page,
      page.getByLabel("Your name"),
      "name field",
      uniqueName("kb"),
    );
    await tabTo(
      page,
      page.getByRole("button", { name: "Sign in" }),
      "Sign in button",
    );
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/\/login/, { timeout: 4_000 });
  }).toPass({ timeout: 25_000 });

  // --- the skip link is the first thing a keyboard user reaches, and it works
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => location.hash)).toBe("#main");

  // --- first run: make a workspace
  await tabTo(
    page,
    page.getByRole("button", { name: "Create workspace" }),
    "Create workspace",
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");

  // --- paste a conversation and send it
  await typeInto(
    page,
    page.getByLabel("Conversation"),
    "conversation box",
    `Dana: ${SSO}\n\nunique ${Date.now()}`,
  );
  await tabTo(
    page,
    page.getByRole("button", { name: "Find requests" }),
    "Find requests",
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+$/);
  seedProposals(page.url().split("/").pop()!, [
    { quote: SSO, title: "Single sign-on", confidence: 0.9 },
  ]);

  // --- triage: the review queue is reachable from the navigation, and a suggestion can be accepted
  await tabTo(
    page,
    page
      .getByRole("navigation", { name: /sections$/ })
      .getByRole("link", { name: /^Review/ }),
    "Review link",
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/review$/);
  await tabTo(
    page,
    page.getByRole("button", { name: "Accept as a request" }),
    "Accept as a request",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByText("Nothing to review right now.")).toBeVisible();

  // --- decide: open the request from the list
  await tabTo(
    page,
    page
      .getByRole("navigation", { name: /sections$/ })
      .getByRole("link", { name: "Requests" }),
    "Requests link",
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/requests$/);
  // the filter form is operable too: type a search and apply it
  await typeInto(
    page,
    page.getByLabel("Search titles"),
    "search box",
    "single",
  );
  await tabTo(page, page.getByRole("button", { name: "Apply" }), "Apply");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=single/);
  await tabTo(
    page,
    page.getByRole("link", { name: "Single sign-on" }),
    "request link",
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Single sign-on", level: 1 }),
  ).toBeVisible();

  // --- change the status with a drop-down using only keys, and see the consequence spelled out first
  await tabTo(page, page.locator("#status"), "Status drop-down");
  await page.keyboard.press("Enter"); // open the list
  await page.keyboard.type("Shipped"); // type-ahead picks the option
  await page.keyboard.press("Enter"); // choose it
  await expect(page.locator("#status")).toHaveText(/Shipped/);
  await tabTo(
    page,
    page.getByRole("button", { name: "Update status" }),
    "Update status",
  );
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Nothing is sent until you approve it."),
  ).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Not yet" }), "Not yet");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Nothing is sent until you approve it."),
  ).toHaveCount(0);

  // --- the codebook and the research pages are reachable and operable too
  await page.goto(`${workspaceUrl}/research/codebook`);
  await typeInto(
    page,
    page.getByLabel("Name", { exact: true }),
    "tag name",
    "Keyboard tag",
  );
  await tabTo(page, page.getByRole("button", { name: "Add tag" }), "Add tag");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Added “Keyboard tag”.")).toBeVisible();

  // --- the Ask box
  await page.goto(`${workspaceUrl}/ask`);
  await typeInto(
    page,
    page.getByLabel("Your question"),
    "question box",
    "What did customers say about single sign-on?",
  );
  await tabTo(page, page.getByRole("button", { name: "Ask" }), "Ask");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("article", { name: /Answer to:/ })).toBeVisible({
    timeout: 30_000,
  });
});
