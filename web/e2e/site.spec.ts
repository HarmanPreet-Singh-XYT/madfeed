import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueName } from "./helpers";

// The public marketing pages: every one loads, has one main heading, passes the accessibility scan at desktop and
// phone width, and links only to pages that exist. The front page is for visitors; someone signed in goes to
// their workspaces.

const PAGES = [
  "/",
  "/features",
  "/integrations",
  "/pricing",
  "/docs",
  "/docs/getting-started",
  "/docs/concepts",
  "/docs/sending-feedback",
  "/docs/review-and-requests",
  "/docs/people-and-value",
  "/docs/closing-the-loop",
  "/docs/research",
  "/docs/surveys",
  "/docs/support-desk",
  "/docs/integrations",
  "/docs/webhooks",
  "/docs/api",
  "/docs/assistants",
  "/docs/privacy-and-data",
  "/faq",
  "/about",
  "/community",
  "/contact",
  "/security",
  "/privacy",
  "/terms",
  "/cookies",
  "/subprocessors",
];

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

test("every public page loads, has one heading, passes the accessibility scan and has no broken links", async ({
  page,
  request,
}) => {
  const links = new Set<string>();
  for (const path of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator("h1"), `${path} has one h1`).toHaveCount(1);
    await expect(page.locator("main#main"), path).toHaveCount(1);
    await expect(page).toHaveTitle(/.+/);
    // no horizontal scrolling at this width
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(wide, `${path} scrolls sideways`).toBe(false);
    await accessible(page, path);
    for (const href of await page
      .locator("a[href^='/']")
      .evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!),
      ))
      links.add(href.split("#")[0] || "/");
  }
  // every internal link goes somewhere (pages are public or known app pages)
  for (const href of links) {
    if (
      href.startsWith("/docs/") ||
      PAGES.includes(href) ||
      ["/login", "/signup"].includes(href)
    ) {
      const r = await request.get(href, {
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expect([200, 307, 308], `${href} should resolve`).toContain(r.status());
    } else {
      throw new Error(
        `a public page links to ${href}, which is not a known page`,
      );
    }
  }
});

test("the front page offers sign-up, and signed-in people go to their workspaces", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Know what your customers are asking for",
  );
  await expect(
    page.getByRole("link", { name: "Get started free" }),
  ).toHaveAttribute("href", "/signup");
  // the integrations page tells the truth about what is built and what is not
  await page.goto("/integrations");
  await expect(page.getByText("Planned").first()).toBeVisible();
  await expect(page.getByText("Coming soon").first()).toBeVisible();

  // search engines are told what to index
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /w/");
  const map = await request.get("/sitemap.xml");
  expect(await map.text()).toContain("/features");

  await signIn(page, uniqueName("site"));
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await context.clearCookies();
});

test("the legal pages say they are drafts until reviewed, and show no invented company details", async ({
  page,
}) => {
  for (const path of ["/privacy", "/terms", "/cookies", "/subprocessors"]) {
    await page.goto(path);
    await expect(page.getByRole("note")).toContainText("Draft");
  }
  await page.goto("/contact");
  await expect(
    page.getByText(/published here before launch/).first(),
  ).toBeVisible();
});

test("the FAQ opens and closes with the keyboard", async ({ page }) => {
  await page.goto("/faq");
  const first = page.locator("details").first();
  await first.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(first).not.toHaveAttribute("open", "");
});
