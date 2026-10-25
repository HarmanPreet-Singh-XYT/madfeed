import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Sign-in through a company's own identity system, against the local stand-in for Supabase (which stands in
// for the company's sign-in page too). Runs on the copy of the app with real sign-in and company sign-in on.
test.use({ baseURL: "http://127.0.0.1:13001" });

test("sign in with a work email, with a provider button, and the ways it can go wrong", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Or sign in with your company" }),
  ).toBeVisible();
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    a11y.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);

  // an address whose company has no sign-in set up is told so in plain words
  await page.getByRole("link", { name: "Use my work email address" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in with your company" }),
  ).toBeVisible();
  await page
    .getByLabel("Work email address")
    .fill("someone@unknown-company.test");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText(/Company sign-in isn't set up for that email/),
  ).toBeVisible();
  await expect(page.getByLabel("Work email address")).toHaveValue(
    "someone@unknown-company.test",
  );

  // a company that has one: sent away and brought back signed in
  await page.getByLabel("Work email address").fill("dana@sso-e2e.test");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });
  const session = (await context.cookies()).find((c) => c.name === "session");
  expect(session?.httpOnly).toBe(true);
  expect((await context.cookies()).some((c) => c.name === "sso_pkce")).toBe(
    false,
  );

  // sign out, then the provider button works too
  await context.clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(
    true,
  );
});

test("a way back that was not started here, or whose secret does not match, signs nobody in", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  // straight to the way back with a code but no secret kept: refused
  await page.goto("/login/sso/callback?code=abcdefgh12345678");
  await expect(page).toHaveURL(/\/login\?sso=failed/);
  await expect(
    page.getByText(/couldn't finish signing you in with your company/),
  ).toBeVisible();
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(
    false,
  );

  // a real trip, but the browser's secret does not match the one the trip started with
  await page.goto("/login");
  const start = page
    .waitForResponse(
      (r) =>
        r.url().includes("/auth/v1/authorize") || r.url().includes("/dev/idp"),
      { timeout: 15_000 },
    )
    .catch(() => undefined);
  // while the browser is at the company's page, the secret it kept is swapped for another
  await page.route("**/auth/v1/authorize**", async (route) => {
    const mine = (await context.cookies()).filter((c) => c.name === "sso_pkce");
    await context.addCookies(
      mine.map((c) => ({ ...c, value: "x".repeat(64) })),
    );
    await route.continue();
  });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await start;
  await expect(page).toHaveURL(/\/login\?sso=failed/, { timeout: 15_000 });
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(
    false,
  );
});
