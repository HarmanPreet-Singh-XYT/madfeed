import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ws = `/w/${uid(1)}`;

async function open(page: Page, to = ws) {
  await page.goto(
    `/mock/scenario?reset=1&set=normal&session=in&to=${encodeURIComponent(to)}`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Search and jump to" });
const box = (page: Page) => palette(page).getByRole("combobox");

/** Press a key until the palette opens: the very first press can land before the page has hydrated. */
async function pressToOpen(page: Page, key: string) {
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(palette(page)).toBeVisible({ timeout: 800 });
  }).toPass({ timeout: 10_000 });
}

async function show(page: Page) {
  await pressToOpen(page, "ControlOrMeta+k");
}

test.describe("the command palette", () => {
  test("opens with Ctrl or ⌘ K, offers actions and every screen, and closes with Escape", async ({ page }) => {
    await open(page);
    await show(page);
    await expect(box(page)).toBeFocused();
    await expect(palette(page).getByText("Actions", { exact: true })).toBeVisible();
    await expect(palette(page).getByRole("option", { name: /Take the product tour/ })).toBeVisible();
    await expect(palette(page).getByRole("option", { name: /Switch to (dark|light) mode/ })).toBeVisible();
    await expect(palette(page).getByRole("option", { name: "Review" })).toBeVisible();
    await expect(palette(page).getByText("Recent", { exact: true })).toBeHidden(); // nothing opened yet
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
  });

  test("the / key opens it, but not while typing in a field", async ({ page }) => {
    await open(page, `${ws}/requests`);
    await pressToOpen(page, "/");
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();

    const field = page.getByRole("searchbox").or(page.getByRole("textbox")).first();
    await field.focus();
    await page.keyboard.type("a/b");
    await expect(palette(page)).toBeHidden();
  });

  test("searches requests, people, companies and quotes together and marks the matched words", async ({ page }) => {
    await open(page);
    await show(page);
    await box(page).fill("sign-on");
    const reqs = palette(page).getByRole("group", { name: "Requests" });
    await expect(reqs.getByRole("option", { name: /Single sign-on \(SAML\)/ })).toBeVisible();
    await expect(reqs.locator("mark").first()).toHaveText(/sign-on/i);
    await expect(palette(page).getByRole("group", { name: "Quotes" })).toBeVisible();
    await expect(palette(page).getByRole("group", { name: /Search for “sign-on”/ })).toBeVisible();

    await box(page).fill("tidepool");
    await expect(palette(page).getByRole("group", { name: "Companies" })).toBeVisible();
    await expect(palette(page).getByRole("group", { name: "People" })).toBeVisible();
  });

  test("opening a result goes there and is remembered under Recent", async ({ page }) => {
    await open(page);
    await show(page);
    await box(page).fill("sign-on");
    await palette(page).getByRole("option", { name: /Single sign-on \(SAML\)/ }).click();
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
    await expect(palette(page)).toBeHidden();

    await show(page);
    const recent = palette(page).getByRole("group", { name: "Recent" });
    await expect(recent.getByRole("option", { name: /Single sign-on \(SAML\)/ })).toBeVisible();
  });

  test("the keyboard alone can search, move and open", async ({ page }) => {
    await open(page);
    await show(page);
    await box(page).fill("sign-on");
    await expect(palette(page).getByRole("option", { name: /Single sign-on \(SAML\)/ })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    // Down from the best match lands on the next result, never on a "search for" row.
    await expect(page).toHaveURL(/\/(requests|sources|findings)\//);
  });

  test("says so when nothing matches, and still offers the broader searches", async ({ page }) => {
    await open(page);
    await show(page);
    await box(page).fill("zzzqqq");
    await expect(palette(page).getByText(/Nothing found for “zzzqqq”/)).toBeVisible();
    await expect(palette(page).getByRole("option", { name: /All quotes with these words/ })).toBeVisible();
  });

  test("is accessible while open and with results", async ({ page }) => {
    await open(page);
    await show(page);
    await box(page).fill("sign-on");
    await expect(palette(page).getByRole("group", { name: "Requests" })).toBeVisible();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations).toEqual([]);
  });

  test("fits a phone screen", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone only");
    await open(page);
    await page.getByRole("button", { name: "Search and jump to" }).first().click();
    await expect(palette(page)).toBeVisible();
    const b = await palette(page).boundingBox();
    const v = page.viewportSize()!;
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(v.width);
    expect(b!.y + b!.height).toBeLessThanOrEqual(v.height);
  });
});
