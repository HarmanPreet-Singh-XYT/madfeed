import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The production sign-in path: email and password checked by the identity
// service (a local stand-in speaking Supabase's protocol), token kept in an
// httpOnly cookie. The development sign-in is off on this copy of the app.
test.use({ baseURL: "http://127.0.0.1:13001" });

test("email and password sign-in, wrong passwords, sign-out, protected pages", async ({
  page,
  context,
}) => {
  // not signed in: protected pages send you to the sign-in page
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveCount(0); // no development shortcut here
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    a11y.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);

  // wrong password, unknown account and unconfirmed account: plain answers, nothing is stored.
  // Each attempt starts from a fresh page so a stale message can't satisfy the check.
  const attempt = async (who: string, pw: string, message: RegExp) =>
    expect(async () => {
      await page.goto("/login");
      await page.getByLabel("Email address").fill(who);
      await page.getByLabel("Password").fill(pw);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText(message)).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
  await attempt(
    "tester@example.com",
    "wrong password",
    /That email and password don't match\./,
  );
  await attempt(
    "nobody@example.com",
    "whatever",
    /That email and password don't match\./,
  );
  await attempt(
    "unconfirmed@example.com",
    "whatever",
    /Confirm your email address first/,
  );
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(
    false,
  );

  // the right one signs in; the token lives in an httpOnly cookie page scripts cannot read
  await page.goto("/login");
  await page.getByLabel("Email address").fill("tester@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const cookie = (await context.cookies()).find((c) => c.name === "session")!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("session");
  expect(await page.content()).not.toContain(cookie.value);

  // and the API accepts that token. This account is the same every run, so it may already have a
  // workspace (then we land in it); otherwise make one. Either way the workspace is usable.
  const create = page.getByRole("button", { name: "Create workspace" });
  await expect(
    create.or(page.getByRole("navigation", { name: /sections$/ })),
  ).toBeVisible();
  if (await create.isVisible()) await create.click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\//);
  const workspace = page.url().match(/^(.*\/w\/[0-9a-f-]+)/)![1];
  await page.goto(`${workspace}/requests`);
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();

  // signing out ends the session
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(
    false,
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("the stand-in refuses what Supabase would refuse", async ({ request }) => {
  // missing or wrong key, and a key sent as a bearer token, are all rejected
  const body = {
    data: { email: "tester@example.com", password: "correct horse battery" },
  };
  expect(
    (
      await request.post(
        "http://127.0.0.1:9999/auth/v1/token?grant_type=password",
        body,
      )
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(
        "http://127.0.0.1:9999/auth/v1/token?grant_type=password",
        {
          ...body,
          headers: { apikey: "sb_publishable_dev", Authorization: "Bearer x" },
        },
      )
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(
        "http://127.0.0.1:9999/auth/v1/token?grant_type=password",
        { ...body, headers: { apikey: "sb_publishable_dev" } },
      )
    ).status(),
  ).toBe(200);
});

async function signInAs(page: import("@playwright/test").Page) {
  await expect(async () => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("tester@example.com");
    await page.getByLabel("Password").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 4_000 });
  }).toPass({ timeout: 25_000 });
}

const cookieNamed = async (
  context: import("@playwright/test").BrowserContext,
  name: string,
) => (await context.cookies()).find((c) => c.name === name);

test("a session is renewed before its token runs out, and keeps working", async ({
  page,
  context,
}) => {
  await signInAs(page);
  const first = (await cookieNamed(context, "session"))!;
  const firstRefresh = (await cookieNamed(context, "refresh"))!;
  expect(firstRefresh.httpOnly).toBe(true);
  expect(first.expires - Date.now() / 1000).toBeLessThan(110); // a 100 s token, not the 8 h cap

  // 100 s tokens are renewed once fewer than 90 s remain: wait it out, then just use the site.
  await page.waitForTimeout(13_000);
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login/);
  const second = (await cookieNamed(context, "session"))!;
  const secondRefresh = (await cookieNamed(context, "refresh"))!;
  expect(second.value).not.toBe(first.value); // a new access token...
  expect(secondRefresh.value).not.toBe(firstRefresh.value); // ...and a new single-use refresh token
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  // signing out removes both
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await cookieNamed(context, "session")).toBeUndefined();
  expect(await cookieNamed(context, "refresh")).toBeUndefined();
});

test("when the refresh token no longer works the person is asked to sign in again", async ({
  page,
  context,
}) => {
  await signInAs(page);
  const session = (await cookieNamed(context, "session"))!;
  await context.addCookies([
    {
      ...session,
      name: "refresh",
      value: "dev-refresh-forged",
      expires: Date.now() / 1000 + 3600,
    },
  ]);
  await page.waitForTimeout(13_000);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  expect(await cookieNamed(context, "session")).toBeUndefined();
  expect(await cookieNamed(context, "refresh")).toBeUndefined();
});

const uniqueEmail = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

async function fillSignUp(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
  again = password,
) {
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password again").fill(again);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("creating an account: checks, confirmation by email, then sign-in", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole("heading", { name: "Create an account" }),
  ).toBeVisible();
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    a11y.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);

  // our own checks come first, in plain words
  const email = uniqueEmail("new");
  await expect(async () => {
    await page.goto("/signup");
    await fillSignUp(page, email, "long enough password", "a different one");
    await expect(page.getByText("The two passwords don't match.")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  // the address is kept after an error, so nothing has to be typed again
  await expect(page.getByLabel("Email address")).toHaveValue(email);
  // too short is stopped by the browser's own check before anything is sent
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Password again").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup$/);

  // a good one: told to check email; the same message would appear for an address already taken
  await page
    .getByLabel("Password", { exact: true })
    .fill("long enough password");
  await page.getByLabel("Password again").fill("long enough password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto("/signup");
  await fillSignUp(page, "tester@example.com", "long enough password"); // exists already
  await expect(page.getByText("Check your email")).toBeVisible();

  // until the link in that email is opened, signing in is refused with a clear reason
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("long enough password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText(/Confirm your email address first/),
  ).toBeVisible();

  // (the local stand-in for clicking the confirmation link)
  const confirm = await page.request.post(
    `http://127.0.0.1:9999/dev/confirm?email=${encodeURIComponent(email)}`,
  );
  expect(confirm.status()).toBe(204);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("long enough password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
});

test("when no confirmation is needed the new account is signed in, and only safe return addresses are followed", async ({
  page,
  context,
}) => {
  await page.goto("/signup?next=/r/some-site/roadmap");
  await fillSignUp(page, uniqueEmail("autoconfirm-"), "long enough password");
  await page.waitForURL((u) => u.pathname === "/r/some-site/roadmap");
  expect((await context.cookies()).some((c) => c.name === "session")).toBe(
    true,
  );

  await context.clearCookies();
  await page.goto("/signup?next=https://evil.example/steal");
  await fillSignUp(page, uniqueEmail("autoconfirm-"), "long enough password");
  await page.waitForURL((u) => u.pathname === "/" && u.search === "");
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
});
