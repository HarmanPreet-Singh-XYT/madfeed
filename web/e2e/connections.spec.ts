import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { query, signIn, sql, uniqueName } from "./helpers";

const API = "http://127.0.0.1:18080";
const SLACK = "http://127.0.0.1:9994";
const GITHUB = "http://127.0.0.1:9995";
const SLACK_SIGNING = "e2e-slack-signing-secret";

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

async function slackEvent(body: object) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig =
    "v0=" +
    createHmac("sha256", SLACK_SIGNING).update(`v0:${ts}:${raw}`).digest("hex");
  return fetch(`${API}/v1/integrations/slack/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": ts,
      "X-Slack-Signature": sig,
    },
    body: raw,
  });
}

async function githubEvent(
  ws: string,
  secret: string,
  id: string,
  body: object,
) {
  const raw = JSON.stringify(body);
  const sig =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return fetch(`${API}/v1/integrations/github/${ws}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": id,
      "X-Hub-Signature-256": sig,
    },
    body: raw,
  });
}

test("Slack: connect, choose a channel, messages arrive for review, a revoked connection is shown and fixed", async ({
  page,
}) => {
  sql("DELETE FROM integration WHERE kind='slack'"); // the stand-in is one Slack workspace; a run may follow another
  await signIn(page, uniqueName("sl"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  const team = (
    (await (await fetch(`${SLACK}/_dev/team`)).json()) as { team: string }
  ).team;

  await page.goto(`${workspaceUrl}/settings`);
  await expect(page.getByRole("heading", { name: "Slack" })).toBeVisible();
  // the approval round trip: our button -> Slack (the stand-in approves) -> our page -> back to settings
  await page.getByRole("button", { name: "Add to Slack" }).click();
  await page.waitForURL(new RegExp(`/w/${ws}/settings$`), { timeout: 30_000 });
  await expect(page.getByText("Acme Slack")).toBeVisible();
  await expect(page.getByText("Connected.")).toBeVisible();
  await expect(page.getByText("no channel chosen yet")).toBeVisible();
  // nothing readable is stored
  const sealed = query(
    `SELECT encode(secret, 'escape') FROM integration WHERE workspace_id='${ws}' AND kind='slack'`,
  )[0];
  expect(sealed).not.toContain("xoxb");
  await accessible(page, "settings with Slack connected");

  await page.getByRole("button", { name: "Choose channel" }).click();
  await page
    .getByLabel("Collect feedback from")
    .selectOption({ label: "#feedback" });
  await page.getByRole("button", { name: "Use this channel" }).click();
  await expect(page.getByText(/collecting from #feedback/)).toBeVisible();

  // a message in that channel becomes feedback waiting for review; one elsewhere does not
  const said = `We really need dark mode, said at ${Date.now()}.`;
  const post = (channel: string, text: string, ts: string) =>
    slackEvent({
      type: "event_callback",
      team_id: team,
      event_id: `Ev${ts}`,
      event: {
        type: "message",
        channel,
        channel_type: "channel",
        user: "U1",
        text,
        ts,
      },
    });
  expect((await post("C0FEEDBACK", said, "1700000001.000100")).status).toBe(
    200,
  );
  expect((await post("C0FEEDBACK", said, "1700000001.000100")).status).toBe(
    200,
  ); // delivered twice
  expect(
    (await post("C0RANDOM", "chatter in another channel", "1700000002.000100"))
      .status,
  ).toBe(200);
  expect(
    query(
      `SELECT count(*) FROM source_item WHERE workspace_id='${ws}' AND kind='chat'`,
    )[0],
  ).toBe("1");
  const sid = query(
    `SELECT id FROM source_item WHERE workspace_id='${ws}' AND kind='chat'`,
  )[0];
  await page.goto(`${workspaceUrl}/sources/${sid}`);
  await expect(page.getByText(said)).toBeVisible();
  // a forged event is refused
  const forged = await fetch(`${API}/v1/integrations/slack/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
      "X-Slack-Signature": "v0=" + "0".repeat(64),
    },
    body: JSON.stringify({ type: "url_verification", challenge: "x" }),
  });
  expect(forged.status).toBe(401);

  // Slack stops accepting our token: the next check says so plainly, and the data stays
  await fetch(`${SLACK}/_dev/revoke`, { method: "POST" });
  await page.goto(`${workspaceUrl}/settings`);
  await page.getByRole("button", { name: "Check connection" }).first().click();
  await expect(page.getByText(/This connection no longer works/)).toBeVisible();
  expect(
    query(
      `SELECT count(*) FROM source_item WHERE workspace_id='${ws}' AND kind='chat'`,
    )[0],
  ).toBe("1");
  await accessible(page, "settings with a connection that needs attention");
  await fetch(`${SLACK}/_dev/unrevoke`, { method: "POST" });
  await page.getByRole("button", { name: "Connect again" }).click();
  await page.waitForURL(new RegExp(`/w/${ws}/settings$`), { timeout: 30_000 });
  await expect(page.getByText("Connected.")).toBeVisible();
  await expect(page.getByText(/collecting from #feedback/)).toBeVisible(); // the channel was kept

  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await expect(
    page.getByRole("button", { name: "Add to Slack" }),
  ).toBeVisible();
});

test("GitHub: connect a repository, open an issue for a request, and the request follows the issue", async ({
  page,
}) => {
  await signIn(page, uniqueName("gh"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO request (workspace_id, title) VALUES ('${ws}','Single sign-on')`,
  );
  const reqId = query(`SELECT id FROM request WHERE workspace_id='${ws}'`)[0];
  const repo = `acme/product-${Date.now().toString(36)}`;

  await page.goto(`${workspaceUrl}/settings`);
  await expect(
    page.getByRole("heading", { name: "GitHub issues" }),
  ).toBeVisible();
  const gh = page
    .getByRole("heading", { name: "GitHub issues" })
    .locator("xpath=..");
  // a wrong token is refused in plain words and what was typed stays
  await page.getByLabel("Repository (owner/name)").fill(repo);
  await gh
    .getByLabel("Access token", { exact: true })
    .fill("not-the-right-token");
  await gh.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "did not accept that token",
  );
  await expect(page.getByLabel("Repository (owner/name)")).toHaveValue(repo);
  await gh
    .getByLabel("Access token", { exact: true })
    .fill("github_pat_fake_token_0001");
  await page
    .getByLabel("Closed: move the request to")
    .first()
    .selectOption({ label: "Shipped" });
  await page
    .getByLabel("Reopened: move the request to")
    .first()
    .selectOption({ label: "In progress" });
  await gh.getByRole("button", { name: "Connect", exact: true }).click();
  // the notification address and secret are shown once
  const secret = await page.getByLabel("Secret", { exact: true }).inputValue();
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.getByLabel("Payload URL")).toHaveValue(
    new RegExp(`/v1/integrations/github/${ws}/events$`),
  );
  await accessible(page, "settings with GitHub connected");
  await page.reload();
  await expect(page.getByText(repo).first()).toBeVisible();
  expect(await page.content()).not.toContain(secret);

  // the request page offers an issue; it is made and linked
  await page.goto(`${workspaceUrl}/requests/${reqId}`);
  await page.getByRole("button", { name: "Create an issue" }).click();
  await expect(
    page.getByRole("link", { name: new RegExp(`${repo}#\\d+`) }),
  ).toBeVisible();
  await expect(page.locator("#issue-state")).toContainText("open");
  const number = Number(
    (
      await page
        .getByRole("link", { name: new RegExp(`${repo}#\\d+`) })
        .innerText()
    ).split("#")[1],
  );
  // the issue body held no customer words
  expect(
    query(`SELECT count(*) FROM request_issue WHERE workspace_id='${ws}'`)[0],
  ).toBe("1");

  const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();
  const ev = (action: string, s: number) => ({
    action,
    issue: {
      number,
      state: action === "closed" ? "closed" : "open",
      updated_at: at(s),
    },
    repository: { full_name: repo },
  });
  // closed on GitHub -> the request moves to Shipped
  expect(
    (await githubEvent(ws, secret, `d-${Date.now()}-1`, ev("closed", 5)))
      .status,
  ).toBe(200);
  await page.reload();
  await expect(page.locator("#status")).toHaveValue(
    query(
      `SELECT id FROM status WHERE workspace_id='${ws}' AND name='Shipped'`,
    )[0],
  );
  await expect(page.locator("#issue-state")).toContainText("closed");
  // a forged notification changes nothing
  const bad = await fetch(`${API}/v1/integrations/github/${ws}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": "d-forged",
      "X-Hub-Signature-256": "sha256=" + "0".repeat(64),
    },
    body: JSON.stringify(ev("reopened", 6)),
  });
  expect(bad.status).toBe(401);

  // someone here moves it; then the issue reopens: held back, shown, and settled by a person
  await page.locator("#status").selectOption({ label: "Planned" });
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText("Status updated.")).toBeVisible();
  expect(
    (await githubEvent(ws, secret, `d-${Date.now()}-2`, ev("reopened", 10)))
      .status,
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByText(/changed here since the link was last in step/),
  ).toBeVisible();
  await expect(page.locator("#status")).toHaveValue(
    query(
      `SELECT id FROM status WHERE workspace_id='${ws}' AND name='Planned'`,
    )[0],
  );
  await accessible(page, "a request with an issue conflict");
  await page.getByRole("button", { name: "Use the issue's change" }).click();
  await expect(page.getByText(/changed here since the link/)).toHaveCount(0);
  await expect(page.locator("#status")).toHaveValue(
    query(
      `SELECT id FROM status WHERE workspace_id='${ws}' AND name='In progress'`,
    )[0],
  );
  // deleted on GitHub: the link says so and the request is untouched
  expect(
    (await githubEvent(ws, secret, `d-${Date.now()}-3`, ev("deleted", 15)))
      .status,
  ).toBe(200);
  await page.reload();
  await expect(page.locator("#issue-state")).toContainText(
    "no longer followed",
  );
  await page.getByRole("button", { name: "Stop following this issue" }).click();
  await expect(
    page.getByRole("button", { name: "Create an issue" }),
  ).toBeVisible();
  void number;
  void GITHUB;
});

async function linearEvent(
  ws: string,
  secret: string,
  id: string,
  body: object,
) {
  const raw = JSON.stringify({ ...body, webhookTimestamp: Date.now() });
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  return fetch(`${API}/v1/integrations/linear/${ws}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Linear-Delivery": id,
      "Linear-Signature": sig,
    },
    body: raw,
  });
}

test("Linear: connect a team, open an issue for a request, and the request follows the issue", async ({
  page,
}) => {
  await signIn(page, uniqueName("ln"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO request (workspace_id, title) VALUES ('${ws}','Single sign-on')`,
  );
  const reqId = query(`SELECT id FROM request WHERE workspace_id='${ws}'`)[0];

  await page.goto(`${workspaceUrl}/settings`);
  const lin = page
    .getByRole("heading", { name: "Linear issues" })
    .locator("xpath=..");
  await expect(lin).toBeVisible();
  // a wrong key is refused in plain words and what was typed stays
  await lin.getByLabel(/^Team key/).fill("eng");
  await lin.getByLabel("Personal API key").fill("not-the-right-key-0000");
  await lin.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "did not accept that key",
  );
  await expect(lin.getByLabel(/^Team key/)).toHaveValue("eng");
  await lin.getByLabel("Personal API key").fill("lin_api_fake_key_00000001");
  await lin
    .getByLabel("Completed or canceled: move the request to")
    .first()
    .selectOption({ label: "Shipped" });
  await lin.getByRole("button", { name: "Connect", exact: true }).click();
  // the address to give Linear is shown, and changes are not followed until its secret is pasted
  await expect(lin.getByLabel("URL", { exact: true })).toHaveValue(
    new RegExp(`/v1/integrations/linear/${ws}/events$`),
  );
  await expect(
    lin.getByText(/Changes made in Linear are not followed yet/),
  ).toBeVisible();
  const secret = "lin_wh_e2e_secret_" + Date.now();
  await lin.getByLabel("Webhook signing secret").fill(secret);
  await lin.getByRole("button", { name: "Save the secret" }).click();
  await expect(lin.getByText(/followed from now on/)).toBeVisible();
  await accessible(page, "settings with Linear connected");
  await page.reload();
  await expect(page.getByText("ENG").first()).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  // GitHub cannot be connected next to it
  await expect(
    page.getByRole("heading", { name: "GitHub issues" }),
  ).toHaveCount(0);

  // the request page offers an issue; it is made and linked
  await page.goto(`${workspaceUrl}/requests/${reqId}`);
  await page.getByRole("button", { name: "Create an issue" }).click();
  const link = page.getByRole("link", { name: /^ENG-\d+$/ });
  await expect(link).toBeVisible();
  await expect(page.locator("#issue-state")).toContainText("open");
  const number = Number((await link.innerText()).split("-")[1]);

  const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();
  const ev = (type: string, s: number, action = "update") => ({
    action,
    type: "Issue",
    data: {
      number,
      team: { key: "ENG" },
      state: { type },
      updatedAt: at(s),
    },
  });
  // completed in Linear -> the request moves to Shipped
  expect(
    (await linearEvent(ws, secret, `l-${Date.now()}-1`, ev("completed", 5)))
      .status,
  ).toBe(200);
  await page.reload();
  await expect(page.locator("#status")).toHaveValue(
    query(
      `SELECT id FROM status WHERE workspace_id='${ws}' AND name='Shipped'`,
    )[0],
  );
  await expect(page.locator("#issue-state")).toContainText("closed");
  // a forged notification changes nothing
  const bad = await fetch(`${API}/v1/integrations/linear/${ws}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Linear-Delivery": "l-forged",
      "Linear-Signature": "0".repeat(64),
    },
    body: JSON.stringify({ ...ev("started", 6), webhookTimestamp: Date.now() }),
  });
  expect(bad.status).toBe(401);
  // deleted in Linear: the link says so and the request is untouched
  expect(
    (
      await linearEvent(
        ws,
        secret,
        `l-${Date.now()}-2`,
        ev("started", 15, "remove"),
      )
    ).status,
  ).toBe(200);
  await page.reload();
  await expect(page.locator("#issue-state")).toContainText(
    "no longer followed",
  );
  await expect(page.locator("#status")).toHaveValue(
    query(
      `SELECT id FROM status WHERE workspace_id='${ws}' AND name='Shipped'`,
    )[0],
  );
  await page.getByRole("button", { name: "Stop following this issue" }).click();
  await expect(
    page.getByRole("button", { name: "Create an issue" }),
  ).toBeVisible();
});

async function jiraEvent(
  ws: string,
  secret: string,
  id: string,
  event: string,
  key: string,
  category: string,
  s: number,
) {
  const raw = JSON.stringify({
    webhookEvent: event,
    timestamp: Date.now() + s * 1000,
    issue: { key, fields: { status: { statusCategory: { key: category } } } },
  });
  const sig =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return fetch(`${API}/v1/integrations/jira/${ws}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Atlassian-Webhook-Identifier": id,
      "X-Hub-Signature": sig,
    },
    body: raw,
  });
}

test("Jira: connect a project, open an issue for a request, and the request follows the issue", async ({
  page,
}) => {
  await signIn(page, uniqueName("jr"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO request (workspace_id, title) VALUES ('${ws}','Single sign-on')`,
  );
  const reqId = query(`SELECT id FROM request WHERE workspace_id='${ws}'`)[0];

  await page.goto(`${workspaceUrl}/settings`);
  const jira = page
    .getByRole("heading", { name: "Jira issues" })
    .locator("xpath=..");
  await expect(jira).toBeVisible();
  // a wrong token is refused in plain words and what was typed stays
  await jira.getByLabel(/^Jira site/).fill("acme");
  await jira.getByLabel(/^Project key/).fill("proj");
  await jira.getByLabel("Atlassian account email").fill("bot@acme.example");
  await jira.getByLabel("API token").fill("not-the-right-token-0");
  await jira.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "did not accept",
  );
  await expect(jira.getByLabel(/^Jira site/)).toHaveValue("acme");
  await jira.getByLabel("API token").fill("jira_api_token_fake_0001");
  await jira
    .getByLabel("Done: move the request to")
    .first()
    .selectOption({ label: "Shipped" });
  await jira.getByRole("button", { name: "Connect", exact: true }).click();
  // the address and secret for Jira's webhook are shown once
  const secret = await jira.getByLabel("Secret", { exact: true }).inputValue();
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  await expect(jira.getByLabel("URL", { exact: true })).toHaveValue(
    new RegExp(`/v1/integrations/jira/${ws}/events$`),
  );
  await accessible(page, "settings with Jira connected");
  await page.reload();
  await expect(page.getByText("PROJ").first()).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await expect(
    page.getByRole("heading", { name: "GitHub issues" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Linear issues" }),
  ).toHaveCount(0);

  await page.goto(`${workspaceUrl}/requests/${reqId}`);
  await page.getByRole("button", { name: "Create an issue" }).click();
  const link = page.getByRole("link", { name: /^PROJ-\d+$/ });
  await expect(link).toBeVisible();
  await expect(page.locator("#issue-state")).toContainText("open");
  const key = await link.innerText();

  expect(
    (
      await jiraEvent(
        ws,
        secret,
        `j-${Date.now()}-1`,
        "jira:issue_updated",
        key,
        "done",
        5,
      )
    ).status,
  ).toBe(200);
  await page.reload();
  await expect(page.locator("#status")).toHaveValue(
    query(
      `SELECT id FROM status WHERE workspace_id='${ws}' AND name='Shipped'`,
    )[0],
  );
  await expect(page.locator("#issue-state")).toContainText("closed");
  // a forged notification changes nothing
  const bad = await fetch(`${API}/v1/integrations/jira/${ws}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Atlassian-Webhook-Identifier": "j-forged",
      "X-Hub-Signature": "sha256=" + "0".repeat(64),
    },
    body: JSON.stringify({ webhookEvent: "jira:issue_deleted" }),
  });
  expect(bad.status).toBe(401);
  expect(
    (
      await jiraEvent(
        ws,
        secret,
        `j-${Date.now()}-2`,
        "jira:issue_deleted",
        key,
        "done",
        15,
      )
    ).status,
  ).toBe(200);
  await page.reload();
  await expect(page.locator("#issue-state")).toContainText(
    "no longer followed",
  );
  await page.getByRole("button", { name: "Stop following this issue" }).click();
  await expect(
    page.getByRole("button", { name: "Create an issue" }),
  ).toBeVisible();
});

test("HubSpot: connect, and account value arrives for people already known", async ({
  page,
}) => {
  await signIn(page, uniqueName("hs"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO person (workspace_id, name, email) VALUES ('${ws}','Dana Lee','dana@hubspot-e2e.test'), ('${ws}','Nobody','nobody@hubspot-e2e.test')`,
  );

  await page.goto(`${workspaceUrl}/settings`);
  const hs = page
    .getByRole("heading", { name: "HubSpot: account value" })
    .locator("xpath=..");
  await expect(hs).toBeVisible();
  // a wrong token is refused in plain words
  await hs.getByLabel("Private app access token").fill("not-the-right-token");
  await hs.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "did not accept that token",
  );
  await hs
    .getByLabel("Private app access token")
    .fill("pat-na1-fake-token-0001");
  await hs.getByRole("button", { name: "Connect", exact: true }).click();
  await accessible(page, "settings with HubSpot connected");

  // the worker picks the first sync up within seconds
  await expect(async () => {
    await page.reload();
    await expect(hs.getByText(/Last synced/)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 40_000 });
  await expect(hs.getByText(/1 of 2 people found in HubSpot/)).toBeVisible();
  await expect(hs.getByText(/1 accounts added/)).toBeVisible();
  expect(
    query(
      `SELECT a.name || '|' || a.revenue::text || '|' || a.domain FROM account a JOIN person p ON p.account_id = a.id WHERE a.workspace_id='${ws}' AND p.email='dana@hubspot-e2e.test'`,
    )[0],
  ).toBe("E2E Corp|750000.00|e2e-corp.test");
  expect(
    query(`SELECT count(*) FROM person WHERE workspace_id='${ws}'`)[0],
  ).toBe("2");

  // "Sync now" is accepted and runs again
  await hs.getByRole("button", { name: "Sync now" }).click();
  await expect(
    hs.getByText("A sync will start within a minute."),
  ).toBeVisible();
  await page.reload();
  await expect(hs.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await hs.getByRole("button", { name: "Disconnect" }).click();
  await expect(hs.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  // what was filled in stays
  expect(
    query(`SELECT count(*) FROM account WHERE workspace_id='${ws}'`)[0],
  ).toBe("1");
});

const CLICKUP = "http://127.0.0.1:9990";
const ASANA = "http://127.0.0.1:9989";

async function newWorkspaceWithARequest(page: Page) {
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO request (workspace_id, title) VALUES ('${ws}','Single sign-on')`,
  );
  const reqId = query(`SELECT id FROM request WHERE workspace_id='${ws}'`)[0];
  return { workspaceUrl, ws, reqId };
}

async function statusIs(page: Page, ws: string, name: string) {
  await expect(page.locator("#status")).toHaveValue(
    query(
      `SELECT id FROM status WHERE workspace_id='${ws}' AND name='${name}'`,
    )[0],
  );
}

test("ClickUp: connect a list, open a task for a request, and the request follows the task", async ({
  page,
}) => {
  await signIn(page, uniqueName("cu"));
  const { workspaceUrl, ws, reqId } = await newWorkspaceWithARequest(page);
  await page.goto(`${workspaceUrl}/settings`);
  const cu = page
    .getByRole("heading", { name: "ClickUp issues" })
    .locator("xpath=..");
  await expect(cu).toBeVisible();
  await cu.getByLabel("List ID").fill("901100");
  await cu.getByLabel("Personal API token").fill("pk_not_the_right_token");
  await cu.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "did not accept that token",
  );
  await expect(cu.getByLabel("List ID")).toHaveValue("901100");
  await cu.getByLabel("Personal API token").fill("pk_fake_clickup_token_0001");
  await cu
    .getByLabel("Done: move the request to")
    .first()
    .selectOption({ label: "Shipped" });
  await cu.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(cu.getByText("Product backlog").first()).toBeVisible();
  await accessible(page, "settings with ClickUp connected");
  await expect(
    page.getByRole("heading", { name: "Linear issues" }),
  ).toHaveCount(0);

  await page.goto(`${workspaceUrl}/requests/${reqId}`);
  await page.getByRole("button", { name: "Create an issue" }).click();
  const link = page.getByRole("link", { name: /^86c\d+$/ });
  await expect(link).toBeVisible();
  const task = await link.innerText();
  const secret = (await (await fetch(`${CLICKUP}/_dev/state`)).json()).secret;
  const event = async (
    id: string,
    type: string,
    name = "taskStatusUpdated",
  ) => {
    const raw = JSON.stringify({
      event: name,
      task_id: task,
      history_items: [
        { id, date: String(Date.now() + 1000), after: { status: "x", type } },
      ],
    });
    return fetch(`${API}/v1/integrations/clickup/${ws}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": createHmac("sha256", secret).update(raw).digest("hex"),
      },
      body: raw,
    });
  };
  expect((await event(`h-${Date.now()}`, "closed")).status).toBe(200);
  await page.reload();
  await statusIs(page, ws, "Shipped");
  const bad = await fetch(`${API}/v1/integrations/clickup/${ws}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": "0".repeat(64),
    },
    body: "{}",
  });
  expect(bad.status).toBe(401);
  expect((await event(`h-${Date.now()}-2`, "open", "taskDeleted")).status).toBe(
    200,
  );
  await page.reload();
  await expect(page.locator("#issue-state")).toContainText(
    "no longer followed",
  );
});

test("Asana: connect a project, open a task for a request, and the request follows the task", async ({
  page,
}) => {
  await signIn(page, uniqueName("as"));
  const { workspaceUrl, ws, reqId } = await newWorkspaceWithARequest(page);
  await page.goto(`${workspaceUrl}/settings`);
  const as = page
    .getByRole("heading", { name: "Asana issues" })
    .locator("xpath=..");
  await expect(as).toBeVisible();
  await as.getByLabel("Project ID").fill("120000000001");
  await as.getByLabel("Personal access token").fill("not-the-right-token-1");
  await as.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "did not accept that token",
  );
  await as
    .getByLabel("Personal access token")
    .fill("1/1200000000000000:fakeasanatoken0001");
  await as
    .getByLabel("Done: move the request to")
    .first()
    .selectOption({ label: "Shipped" });
  await as.getByRole("button", { name: "Connect", exact: true }).click();
  // the handshake with the stand-in happened while connecting
  await expect(as.getByText("Roadmap").first()).toBeVisible();
  await accessible(page, "settings with Asana connected");

  await page.goto(`${workspaceUrl}/requests/${reqId}`);
  await page.getByRole("button", { name: "Create an issue" }).click();
  const link = page.getByRole("link", { name: /^\d{10,}$/ });
  await expect(link).toBeVisible();
  const gid = await link.innerText();
  const secret = (await (await fetch(`${ASANA}/_dev/state`)).json()).secret;
  expect(secret).toBeTruthy();
  const event = async (action: string) => {
    const raw = JSON.stringify({
      events: [
        {
          action,
          created_at: new Date(Date.now() + 1000).toISOString(),
          resource: { gid, resource_type: "task" },
          change: { field: "completed" },
        },
      ],
    });
    return fetch(`${API}/v1/integrations/asana/${ws}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hook-Signature": createHmac("sha256", secret)
          .update(raw)
          .digest("hex"),
      },
      body: raw,
    });
  };
  await fetch(`${ASANA}/_dev/complete/${gid}`);
  expect((await event("changed")).status).toBe(200);
  await page.reload();
  await statusIs(page, ws, "Shipped");
  // a second introduction of a secret is refused
  const intro = await fetch(`${API}/v1/integrations/asana/${ws}/events`, {
    method: "POST",
    headers: {
      "X-Hook-Secret": "attacker",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(intro.status).toBe(401);
  expect((await event("deleted")).status).toBe(200);
  await page.reload();
  await expect(page.locator("#issue-state")).toContainText(
    "no longer followed",
  );
});

test("Azure DevOps: connect a project, open a work item for a request, and the request follows it", async ({
  page,
}) => {
  await signIn(page, uniqueName("ad"));
  const { workspaceUrl, ws, reqId } = await newWorkspaceWithARequest(page);
  await page.goto(`${workspaceUrl}/settings`);
  const ado = page
    .getByRole("heading", { name: "Azure DevOps issues" })
    .locator("xpath=..");
  await expect(ado).toBeVisible();
  await ado.getByLabel(/^Organization/).fill("acme");
  await ado.getByLabel(/^Project$/).fill("Product");
  await ado.getByLabel("Personal access token").fill("wrong-token-000000000");
  await ado.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator("p[role=alert]").first()).toContainText(
    "did not accept that token",
  );
  await ado
    .getByLabel("Personal access token")
    .fill("ado_fake_pat_0123456789abcdef");
  await ado
    .getByLabel("Done: move the request to")
    .first()
    .selectOption({ label: "Shipped" });
  await ado.getByRole("button", { name: "Connect", exact: true }).click();
  // the address and the password for the service hook are shown once
  const password = await ado
    .getByLabel(/^Basic authentication password/)
    .inputValue();
  expect(password).toMatch(/^[0-9a-f]{64}$/);
  await accessible(page, "settings with Azure DevOps connected");
  await page.reload();
  expect(await page.content()).not.toContain(password);

  await page.goto(`${workspaceUrl}/requests/${reqId}`);
  await page.getByRole("button", { name: "Create an issue" }).click();
  const link = page.getByRole("link", { name: /^Product #\d+$/ });
  await expect(link).toBeVisible();
  const id = Number((await link.innerText()).split("#")[1]);
  const event = async (eventId: string, body: object) =>
    fetch(`${API}/v1/integrations/azuredevops/${ws}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " + Buffer.from(`feedback:${password}`).toString("base64"),
      },
      body: JSON.stringify({
        id: eventId,
        createdDate: new Date(Date.now() + 1000).toISOString(),
        ...body,
      }),
    });
  expect(
    (
      await event(`ev-${Date.now()}`, {
        eventType: "workitem.updated",
        resource: {
          workItemId: id,
          fields: { "System.State": { oldValue: "Active", newValue: "Done" } },
        },
      })
    ).status,
  ).toBe(200);
  await page.reload();
  await statusIs(page, ws, "Shipped");
  const bad = await fetch(`${API}/v1/integrations/azuredevops/${ws}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " + Buffer.from("feedback:wrong").toString("base64"),
    },
    body: "{}",
  });
  expect(bad.status).toBe(401);
  expect(
    (
      await event(`ev-${Date.now()}-2`, {
        eventType: "workitem.deleted",
        resource: { id },
      })
    ).status,
  ).toBe(200);
  await page.reload();
  await expect(page.locator("#issue-state")).toContainText(
    "no longer followed",
  );
});
