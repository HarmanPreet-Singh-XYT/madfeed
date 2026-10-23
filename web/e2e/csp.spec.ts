import { expect, test } from "@playwright/test";
import { signIn, uniqueName } from "./helpers";

test("pages carry a content security policy that keeps code and data on this site", async ({
  page,
}) => {
  const res = await page.goto("/login");
  const csp = res!.headers()["content-security-policy"] ?? "";
  for (const d of [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ])
    expect(csp, d).toContain(d);
  expect(csp).not.toMatch(/(^|;)\s*default-src[^;]*\*/);
  expect(csp).not.toMatch(/https?:\/\//); // no outside origin is trusted for anything
  expect(res!.headers()["x-frame-options"]).toBe("DENY");
  expect(res!.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res!.headers()["strict-transport-security"]).toContain("max-age=");
  expect(res!.headers()["referrer-policy"]).toBeTruthy();
  expect(res!.headers()["permissions-policy"]).toContain("camera=()");

  // The app still works under the policy.
  await signIn(page, uniqueName("csp"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const w = page.url().replace(/\/add$/, "");
  await page.goto(`${w}/research/codebook`);
  await expect(async () => {
    await page.getByLabel("Name", { exact: true }).fill("Policy tag");
    await page.getByRole("button", { name: "Add tag" }).click();
    await expect(page.getByText("Added “Policy tag”.")).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 20_000 });

  // Code or data going to another site is refused by the browser itself.
  const blocked = await page.evaluate(async () => {
    const out: Record<string, boolean> = {};
    out.fetch = await fetch("https://example.com/", { mode: "no-cors" }).then(
      () => false,
      () => true,
    );
    out.image = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(true);
      img.onload = () => resolve(false);
      img.src = "https://example.com/pixel.gif";
      setTimeout(() => resolve(false), 5000);
    });
    out.script = await new Promise<boolean>((resolve) => {
      const s = document.createElement("script");
      s.src = "https://example.com/x.js";
      s.onerror = () => resolve(true);
      s.onload = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(false), 5000);
    });
    return out;
  });
  expect(blocked).toEqual({ fetch: true, image: true, script: true });
});
