import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { query, signIn, uniqueName } from "./helpers";

// A copy of the app whose API has billing switched on (see playwright.config.ts): free limits apply there.
test.use({ baseURL: "http://127.0.0.1:13003" });
const BILLING_API = "http://127.0.0.1:18083";
const SECRET = "whsec_e2etestsigningsecret0123456789";

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

async function stripeEvent(type: string, object: object, createdOffset = 0) {
  const created = Math.floor(Date.now() / 1000) + createdOffset;
  const payload = JSON.stringify({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    api_version: "2024-06-20",
    created,
    type,
    livemode: false,
    data: { object },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const v1 = createHmac("sha256", SECRET)
    .update(`${ts}.${payload}`)
    .digest("hex");
  return fetch(`${BILLING_API}/v1/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": `t=${ts},v1=${v1}`,
    },
    body: payload,
  });
}

test("billing: free limits, paying upgrades at once, a failed payment warns, cancelling falls back", async ({
  page,
}) => {
  await signIn(page, uniqueName("bl"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;

  await page.goto(`${workspaceUrl}/settings`);
  await expect(page.getByText(/You're on the Free plan/)).toBeVisible();
  await expect(page.getByText("Choose Team")).toBeVisible();
  await accessible(page, "billing on the free plan");

  // the free plan has no API keys: refused in plain words
  await page.getByLabel("Name for the new key").fill("my key");
  await page.getByRole("button", { name: "Create a key" }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "Your Free plan does not include API keys",
  );

  // pay: our button -> the stand-in's checkout page (it "pays") -> back here, on Team
  await page.getByRole("button", { name: "Choose Team" }).click();
  await page.waitForURL(new RegExp(`/w/${ws}/settings\\?billing=success`), {
    timeout: 30_000,
  });
  await expect(page.getByText(/You're on the Team plan/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: "Manage billing" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Subscribed to the Team plan." }),
  ).toBeVisible();
  await accessible(page, "billing on the team plan");

  // and the key is now allowed
  await page.getByLabel("Name for the new key").fill("my key");
  await page.getByRole("button", { name: "Create a key" }).click();
  await expect(page.getByLabel(/Your new key/)).toBeVisible();

  // the billing portal is Stripe's page; we can reach it and come back
  await page.getByRole("button", { name: "Manage billing" }).click();
  await expect(
    page.getByRole("heading", { name: "Billing portal (stand-in)" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to the app" }).click();
  await expect(page.getByText(/You're on the Team plan/)).toBeVisible();

  // a failed payment: a clear warning with the date, and the plan still works for now
  const customer = query(
    `SELECT stripe_customer_id FROM billing_account WHERE workspace_id='${ws}'`,
  )[0];
  expect(
    (await stripeEvent("invoice.payment_failed", { id: "in_1", customer }, 5))
      .status,
  ).toBe(200);
  await page.reload();
  await expect(page.getByText(/The last payment failed/)).toBeVisible();
  await expect(page.getByText(/You're on the Team plan/)).toBeVisible();
  await accessible(page, "billing with a failed payment");

  // paying fixes it; then the plan ends at the end of the period, and finally the subscription ends
  expect(
    (await stripeEvent("invoice.paid", { id: "in_2", customer }, 10)).status,
  ).toBe(200);
  const sub = query(
    `SELECT stripe_subscription_id FROM billing_account WHERE workspace_id='${ws}'`,
  )[0];
  const subObject = (cancelAtEnd: boolean, status: string) => ({
    id: sub,
    customer,
    status,
    cancel_at_period_end: cancelAtEnd,
    current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
    items: {
      data: [
        {
          price: { id: "price_e2eteam0001" },
          current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
        },
      ],
    },
  });
  expect(
    (
      await stripeEvent(
        "customer.subscription.updated",
        subObject(true, "active"),
        15,
      )
    ).status,
  ).toBe(200);
  await page.reload();
  await expect(page.getByText(/The last payment failed/)).toHaveCount(0);
  await expect(page.getByText(/This plan ends on/)).toBeVisible();
  expect(
    (
      await stripeEvent(
        "charge.refunded",
        { id: "ch_1", customer, amount_refunded: 2000, currency: "usd" },
        20,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await stripeEvent(
        "customer.subscription.deleted",
        subObject(false, "canceled"),
        25,
      )
    ).status,
  ).toBe(200);
  await page.reload();
  await expect(page.getByText(/You're on the Free plan/)).toBeVisible();
  await expect(
    page.getByText("A refund of 20.00 USD was issued."),
  ).toBeVisible();
  await expect(page.getByText(/The subscription ended/)).toBeVisible();
  // nothing was deleted: the key made on the paid plan is still listed
  await expect(page.getByText("my key").first()).toBeVisible();
});
