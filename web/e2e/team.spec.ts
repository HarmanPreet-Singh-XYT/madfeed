import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, uniqueName } from "./helpers";

// Inviting a teammate end to end: an admin invites an address, the person signs up with that address on the copy of
// the app that uses real sign-in (so their address is confirmed), opens the link and joins. Someone else opening
// the same link is told it was meant for another address and is not added.
const REAL = "http://127.0.0.1:13001"; // email-and-password sign-in against the local stand-in

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

test("invite a teammate, they join with their own address, roles and removal work, the last admin stays", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("team"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const settings = page.url().replace(/\/add$/, "/settings?tab=general");
  await page.goto(settings);
  const team = page.getByRole("region", { name: "Team", exact: true });
  await expect(
    team.getByRole("list", { name: "Team members" }).getByRole("listitem"),
  ).toHaveCount(1);

  // the only admin can neither demote nor remove themselves
  page.once("dialog", (d) => d.accept());
  await team.getByRole("button", { name: /^Leave/ }).click();
  await expect(team.getByText(/at least one admin/)).toBeVisible();

  // invite: a bad address is refused, a good one gives a link (email is not set up in this stack)
  const invitee = `autoconfirm-${Date.now().toString(36)}@example.com`;
  await team.getByLabel("Email address").fill("not-an-address");
  await team.getByRole("button", { name: "Send invitation" }).click();
  await team.getByLabel("Email address").fill(invitee);
  await team
    .getByLabel("Role", { exact: true })
    .selectOption({ label: "Member: add, review, reply and edit" });
  await team.getByRole("button", { name: "Send invitation" }).click();
  await expect(
    team.getByText(/Email isn't set up here, so nothing was sent/),
  ).toBeVisible();
  const link = await team
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  expect(link).toMatch(/\/invite\/m\.[0-9a-f]{32}\.[0-9a-f]{32}\./);
  await accessible(page, "settings with an open invitation");
  await page.reload();
  await expect(
    team
      .getByRole("list", { name: "Open invitations" })
      .locator("strong", { hasText: invitee }),
  ).toBeVisible();

  // someone with another address opens the link: told so, not added
  const path = new URL(link).pathname;
  const stranger = await browser.newContext({ baseURL: REAL });
  const sp = await stranger.newPage();
  await sp.goto("/signup");
  const other = `autoconfirm-other-${Date.now().toString(36)}@example.com`;
  await sp.getByLabel("Email address").fill(other);
  await sp
    .getByLabel("Password", { exact: true })
    .fill("a-long-enough-password");
  await sp.getByLabel("Password again").fill("a-long-enough-password");
  await sp.getByRole("button", { name: "Create account" }).click();
  await expect(sp).not.toHaveURL(/signup/);
  await sp.goto(path);
  await expect(sp.getByText(/the invitation was sent to/)).toBeVisible();
  await expect(sp.getByRole("button", { name: /^Join/ })).toHaveCount(0);
  await stranger.close();

  // the invited person signs up with the invited address and joins
  const mate = await browser.newContext({ baseURL: REAL });
  const mp = await mate.newPage();
  await mp.goto(path);
  await expect(mp).toHaveURL(/\/login\?next=/); // not signed in: sign in, then come back
  await mp.goto(`/signup?next=${encodeURIComponent(path)}`);
  await mp.getByLabel("Email address").fill(invitee);
  await mp
    .getByLabel("Password", { exact: true })
    .fill("a-long-enough-password");
  await mp.getByLabel("Password again").fill("a-long-enough-password");
  await mp.getByRole("button", { name: "Create account" }).click();
  await expect(mp).not.toHaveURL(/signup/);
  await mp.goto(path);
  await expect(mp.getByText(/using/)).toContainText(invitee);
  await accessible(mp, "the invitation page");
  await mp.getByRole("button", { name: /^Join/ }).click();
  await expect(mp).toHaveURL(/\/w\/[0-9a-f-]+$/);
  // a link that was used says so
  await mp.goto(path);
  await expect(mp.getByText(/already in/)).toBeVisible();

  // the admin sees them as a member, makes them an admin, then removes them again
  await page.reload();
  await expect(
    team.getByRole("list", { name: "Team members" }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(team.getByText("No open invitations.")).toBeVisible();
  const roles = team.getByRole("combobox", { name: /^Role of/ });
  await expect(roles).toHaveCount(2);
  await roles.last().selectOption("admin");
  await page.reload();
  await expect(
    team.getByRole("combobox", { name: /^Role of/ }).last(),
  ).toHaveValue("admin");
  page.once("dialog", (d) => d.accept());
  await team
    .getByRole("button", { name: /^Remove/ })
    .last()
    .click();
  await expect(
    team.getByRole("list", { name: "Team members" }).getByRole("listitem"),
  ).toHaveCount(1);
  // the removed person no longer reaches the workspace
  await mp.goto(settings.replace(REAL, "").replace(/^https?:\/\/[^/]+/, ""));
  await expect(mp.getByRole("heading", { name: "Team" })).toHaveCount(0);
  await mate.close();
});
