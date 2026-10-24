import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { clearOutbox, outbox, query, signIn, sql, uniqueName } from "./helpers";

const WEB = "http://127.0.0.1:13000";

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

test("a survey: build it, choose who, approve the list, answer from the link, read the results", async ({
  page,
  browser,
}) => {
  await clearOutbox();
  const tag = Date.now().toString(36);
  const dana = `dana-${tag}@acme.test`;
  const lee = `lee-${tag}@acme.test`;
  const pat = `pat-${tag}@other.test`;

  await signIn(page, uniqueName("sv"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO person (workspace_id, name, email) VALUES ('${ws}','Dana','${dana}'), ('${ws}','Lee','${lee}'), ('${ws}','Pat','${pat}')`,
  );

  // start
  await page.goto(`${workspaceUrl}/surveys`);
  await expect(page.getByText("No surveys yet.")).toBeVisible();
  await page.getByLabel("Title").fill("Quarterly check-in");
  await page.getByRole("button", { name: "Start a survey" }).click();
  await expect(
    page.getByRole("heading", { name: "Quarterly check-in" }),
  ).toBeVisible();
  await page.getByLabel("Introduction").fill("Two minutes, honestly.");
  await page.getByLabel("Thank-you message").fill("Thanks, that helps.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  // opening with no questions is not possible
  await expect(
    page.getByRole("button", { name: "Open the survey" }),
  ).toBeDisabled();

  // questions
  await page.getByRole("button", { name: "Add a question" }).click();
  await page
    .getByLabel("Question 1", { exact: true })
    .fill("How likely are you to recommend us?");
  await page.getByLabel("Type of answer").first().selectOption("nps");
  await page.getByRole("checkbox", { name: "Required" }).first().check();
  await page.getByRole("button", { name: "Add a question" }).click();
  await page
    .getByLabel("Question 2", { exact: true })
    .fill("What is missing for you?");
  await page.getByRole("button", { name: "Save questions" }).click();
  await expect(page.getByText("Questions saved.")).toBeVisible();

  // audience: a count before anything is saved
  await expect(page.getByText("Choose an audience first.")).toBeVisible();
  await page.getByLabel("Only people who match…").check();
  await page.getByLabel("Rule 1: what to look at").selectOption("email_domain");
  await page.getByLabel("Rule 1: value").fill("acme.test");
  await page.getByRole("button", { name: "Count who this picks" }).click();
  await expect(
    page.getByText(/2 people match; 2 can be emailed/),
  ).toBeVisible();
  // a bad value is explained, not sent
  await page
    .getByLabel("Rule 1: what to look at")
    .selectOption("account_revenue");
  await page.getByLabel("Rule 1: value").fill("$5k");
  await page.getByRole("button", { name: "Save audience" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("plain number");
  await page.getByLabel("Rule 1: what to look at").selectOption("email_domain");
  await page.getByLabel("Rule 1: value").fill("acme.test");
  await page.getByRole("button", { name: "Save audience" }).click();
  await expect(page.getByText("Audience saved.")).toBeVisible();

  // the list is written down but nothing is sent
  await page
    .getByRole("button", { name: "Write down who will be asked" })
    .click();
  await expect(page.getByText(/2 added to the list/)).toBeVisible();
  await expect(page.locator("strong", { hasText: "Dana" })).toBeVisible();
  await accessible(page, "the survey builder");
  await page.getByRole("button", { name: "Leave off Lee" }).click();
  await expect(page.getByText("Left off by you")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Approve and send/ }),
  ).toBeDisabled();
  expect((await outbox()).length).toBe(0);

  // open, then approve what was checked
  await page.getByRole("button", { name: "Open the survey" }).click();
  await expect(page.getByText("Taking answers.")).toBeVisible();
  await page.getByRole("checkbox", { name: /I have checked the list/ }).check();
  await page
    .getByRole("button", { name: "Approve and send 1 invitation" })
    .click();
  await expect(page.getByText("1 invitation is on the way.")).toBeVisible();

  // exactly the one approved person gets it
  await expect
    .poll(
      async () => (await outbox()).filter((m) => m.to.includes(dana)).length,
      { timeout: 30_000 },
    )
    .toBe(1);
  const mails = await outbox();
  expect(mails.some((m) => m.to.includes(lee) || m.to.includes(pat))).toBe(
    false,
  );
  const mail = mails.find((m) => m.to.includes(dana))!;
  expect(mail.subject).toContain(
    "would like your feedback: Quarterly check-in",
  );
  const link = /http:\/\/127\.0\.0\.1:13000\/s\/\S+/.exec(mail.text)![0];
  expect(mail.text).toContain("/unsubscribe/");

  // Dana answers in her own browser, with no account
  const ctx = await browser.newContext();
  const dp = await ctx.newPage();
  await dp.goto(link);
  await expect(
    dp.getByRole("heading", { name: "Quarterly check-in" }),
  ).toBeVisible();
  await expect(dp.getByText("Two minutes, honestly.")).toBeVisible();
  await accessible(dp, "the survey page");
  await dp
    .getByLabel("What is missing for you?")
    .fill("We really need SSO; card 4242 4242 4242 4242.");
  await dp.getByRole("button", { name: "Save and finish later" }).click();
  await expect(dp.getByText(/Saved\. You can close this page/)).toBeVisible();
  // the required question is asked for, in words
  await dp.getByRole("button", { name: "Send my answers" }).click();
  await expect(dp.locator("p[role=alert]")).toContainText(
    "How likely are you to recommend us?",
  );
  // coming back later finds the progress
  await dp.reload();
  await expect(dp.getByLabel("What is missing for you?")).toHaveValue(
    /We really need SSO/,
  );
  await dp.getByText("9", { exact: true }).click();
  await dp.getByRole("button", { name: "Send my answers" }).click();
  await expect(dp.getByRole("heading", { name: "Thank you" })).toBeVisible();
  await expect(dp.getByText("Thanks, that helps.")).toBeVisible();
  await dp.goto(link);
  await expect(
    dp.getByText("You have already answered this survey."),
  ).toBeVisible();
  await ctx.close();

  // a made-up link is just a missing page
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  const res = await sp.goto(
    `${WEB}/s/i.0000000000000000000000000000000.0000000000000000000000000000000.AAAAAAAAAAAAAAAAAAAAAA`,
  );
  void res;
  await expect(sp.getByText("This page could not be found.")).toBeVisible();
  await stranger.close();

  // results for the team; the written answer is in the review queue, with the card number hidden
  await page.goto(`${workspaceUrl}/surveys`);
  await expect(page.getByText(/1 sent · 1 answer/)).toBeVisible();
  await page.getByRole("link", { name: "Quarterly check-in" }).click();
  await page.getByRole("link", { name: /Results \(1 answer\)/ }).click();
  await expect(page.getByLabel("Net promoter score 100")).toBeVisible();
  await expect(page.getByText(/We really need SSO/)).toBeVisible();
  await expect(page.getByText("4242")).toHaveCount(0);
  await accessible(page, "the results");
  await expect
    .poll(
      () =>
        query(
          `SELECT count(*) FROM source_item WHERE workspace_id='${ws}' AND kind='survey' AND raw_text LIKE '%We really need SSO%'`,
        )[0],
      { timeout: 30_000 },
    )
    .toBe("1");

  // closing stops answers
  await page.goto(`${workspaceUrl}/surveys`);
  await page.getByRole("link", { name: "Quarterly check-in" }).click();
  await page.getByRole("button", { name: "Close the survey" }).click();
  await expect(page.getByText("Not taking answers.")).toBeVisible();
  const again = await browser.newContext();
  const ap = await again.newPage();
  await ap.goto(link);
  await expect(
    ap
      .getByText(/This survey is closed/)
      .or(ap.getByText("You have already answered")),
  ).toBeVisible();
  await again.close();
});

test("a public link: one answer per browser, shown inside another page, retired on request", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("sp"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");

  await page.goto(`${workspaceUrl}/surveys`);
  await page.getByLabel("Title").fill("Public pulse");
  await page.getByLabel("How people get it").selectOption("open");
  await page.getByRole("button", { name: "Start a survey" }).click();
  await expect(
    page.getByRole("heading", { name: "Public pulse" }),
  ).toBeVisible();
  // a public-link survey has no invitations or audience
  await expect(page.getByRole("heading", { name: "Invitations" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Add a question" }).click();
  await page
    .getByLabel("Question 1", { exact: true })
    .fill("How are we doing?");
  await page.getByLabel("Type of answer").first().selectOption("csat");
  await page.getByRole("button", { name: "Save questions" }).click();
  await expect(page.getByText("Questions saved.")).toBeVisible();
  await page.getByRole("button", { name: "Open the survey" }).click();
  const link = await page.getByLabel(/Public link/).inputValue();
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:13000\/s\/o\./);
  const embed = await page
    .getByLabel("Show it inside a page of your own")
    .inputValue();
  expect(embed).toContain("/embed/s/o.");

  // answering
  const c1 = await browser.newContext();
  const p1 = await c1.newPage();
  await p1.goto(link);
  await p1.getByText("4", { exact: true }).click();
  await p1.getByRole("button", { name: "Send my answers" }).click();
  await expect(p1.getByRole("heading", { name: "Thank you" })).toBeVisible();
  await p1.reload();
  await expect(p1.getByText(/already answered/)).toBeVisible();
  // another browser may answer
  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await p2.goto(link);
  await expect(
    p2.getByRole("button", { name: "Send my answers" }),
  ).toBeVisible();
  await c2.close();

  // the embeddable version can be framed; nothing else can
  const embedUrl = /data-survey="([^"]+)"/.exec(embed)![1];
  const scriptSrc = /src="([^"]+)"/.exec(embed)![1];
  expect(scriptSrc).toMatch(/\/embed\.js$/);
  const framed = await fetch(embedUrl);
  expect(framed.headers.get("x-frame-options")).toBeNull();
  expect(framed.headers.get("content-security-policy")).toContain(
    "frame-ancestors *",
  );
  const plain = await fetch(link);
  expect(plain.headers.get("x-frame-options")).toBe("DENY");
  expect(plain.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  // another site's page (a real server on another port, so it is a different origin)
  const site = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><title>Customer page</title><script src="${scriptSrc}" data-survey="${embedUrl}"></script>`,
    );
  });
  await new Promise<void>((ok) => site.listen(0, "127.0.0.1", ok));
  const host = await c1.newPage();
  await host.goto(
    `http://127.0.0.1:${(site.address() as AddressInfo).port}/help`,
  );
  // the browser allowed the frame: the survey page is inside it
  await expect(host.frameLocator("iframe").locator("main")).toBeVisible();
  // the script sizes the frame to fit what is inside it
  await host.waitForFunction(
    () => /^\d+px$/.test(document.querySelector("iframe")?.style.height ?? ""),
    null,
    { timeout: 10_000 },
  );
  await c1.close();
  site.close();

  // a new link retires the old one
  await page.getByRole("button", { name: /Make a new link/ }).click();
  await expect
    .poll(async () => page.getByLabel(/Public link/).inputValue())
    .not.toBe(link);
  const c3 = await browser.newContext();
  const p3 = await c3.newPage();
  await p3.goto(link);
  await expect(p3.getByText("This page could not be found.")).toBeVisible();
  await c3.close();
});

test("start from a template, and remind people who have not answered (once)", async ({
  page,
}) => {
  await clearOutbox();
  const tag = Date.now().toString(36);
  const ann = `ann-${tag}@remind.test`;
  await signIn(page, uniqueName("sr"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(
    `INSERT INTO person (workspace_id, name, email) VALUES ('${ws}','Ann','${ann}')`,
  );

  await page.goto(`${workspaceUrl}/surveys`);
  await page
    .getByLabel("Start from")
    .selectOption({ label: "Would you recommend us? (NPS)" });
  await page.getByRole("button", { name: "Start a survey" }).click();
  await expect(
    page.getByRole("heading", { name: "Would you recommend us?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue(
    /recommend us to a friend/,
  );
  await expect(page.getByLabel("Question 2", { exact: true })).toHaveValue(
    /main reason/,
  );

  await page.getByLabel("Everyone in People who has an email address").check();
  await page.getByRole("button", { name: "Save audience" }).click();
  await expect(page.getByText("Audience saved.")).toBeVisible();
  await page
    .getByRole("button", { name: "Write down who will be asked" })
    .click();
  await expect(page.getByText(/1 added to the list/)).toBeVisible();
  await page.getByRole("button", { name: "Open the survey" }).click();
  await expect(page.getByText("Taking answers.")).toBeVisible();
  await page.getByRole("checkbox", { name: /I have checked the list/ }).check();
  await page
    .getByRole("button", { name: "Approve and send 1 invitation" })
    .click();
  await expect
    .poll(
      async () => (await outbox()).filter((m) => m.to.includes(ann)).length,
      { timeout: 30_000 },
    )
    .toBe(1);

  // not answered: one reminder may be sent, after saying yes
  await page.reload();
  await expect(page.getByText("1 person has not answered yet.")).toBeVisible();
  await page
    .getByRole("button", { name: "Send one reminder to 1 person" })
    .click();
  await expect(page.getByText("1 reminder is on the way.")).toBeVisible();
  await expect
    .poll(
      async () => (await outbox()).filter((m) => m.to.includes(ann)).length,
      { timeout: 30_000 },
    )
    .toBe(2);
  const reminder = (await outbox()).find((m) =>
    m.subject.startsWith("Reminder:"),
  )!;
  expect(reminder.to).toEqual([ann]);
  expect(reminder.text).toContain("/unsubscribe/");
  // never a second one
  await page.reload();
  await expect(page.getByText("not answered yet")).toHaveCount(0);
  await expect(page.getByText(/reminded/)).toBeVisible();
});

test("questions that only apply to some answers, wording fixes after opening, and links for people with no email", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("sb"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  const ws = workspaceUrl.split("/").pop()!;
  sql(`INSERT INTO person (workspace_id, name) VALUES ('${ws}','Bob NoMail')`);

  await page.goto(`${workspaceUrl}/surveys`);
  await page.getByLabel("Title").fill("Branching");
  await page.getByRole("button", { name: "Start a survey" }).click();
  await page.getByRole("button", { name: "Add a question" }).click();
  await page
    .getByLabel("Question 1", { exact: true })
    .fill("How likely are you to recommend us?");
  await page.getByLabel("Type of answer").first().selectOption("nps");
  await page.getByRole("checkbox", { name: "Required" }).first().check();
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByLabel("Question 2", { exact: true }).fill("What went wrong?");
  await page.getByRole("checkbox", { name: "Required" }).nth(1).check();
  // the first question cannot depend on anything; the second can
  await expect(page.getByLabel("When is this question shown?")).toHaveCount(1);
  await page
    .getByLabel("When is this question shown?")
    .selectOption({ label: "Only if the answer to question 1 …" });
  await page.getByLabel("Comparison").selectOption("lte");
  await page.getByLabel("Value", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Save questions" }).click();
  await expect(page.getByText("Questions saved.")).toBeVisible();

  // links by hand for the person with no address
  await page.getByLabel("Everyone in People who has an email address").check();
  await page.getByRole("button", { name: "Save audience" }).click();
  await expect(page.getByText("Audience saved.")).toBeVisible();
  await page
    .getByRole("checkbox", { name: /Also make personal links/ })
    .check();
  await page
    .getByRole("button", { name: "Write down who will be asked" })
    .click();
  await expect(page.getByText(/1 have no email address/)).toBeVisible();
  await expect(
    page.getByText("No email address: you hand them their link"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open the survey" }).click();
  await expect(page.getByText("Taking answers.")).toBeVisible();
  await page
    .getByRole("button", { name: "Show the links to hand over" })
    .click();
  const links = await page
    .getByLabel("Personal links, one per line")
    .inputValue();
  const link = /Bob NoMail: (\S+)/.exec(links)![1];

  // wording can be fixed now, nothing else
  await expect(
    page.getByText(/fixed and answers keep their meaning/),
  ).toBeVisible();
  await page.getByLabel(/^Question 2/).fill("What went wrong for you?");
  await page.getByRole("button", { name: "Save wording" }).click();
  await expect(page.getByText("Wording saved.")).toBeVisible();

  // a promoter is not asked; a detractor is, and must answer
  const happy = await browser.newContext();
  const hp = await happy.newPage();
  await hp.goto(link);
  await expect(hp.getByText("What went wrong for you?")).toHaveCount(0);
  await hp.getByText("9", { exact: true }).click();
  await expect(hp.getByText("What went wrong for you?")).toHaveCount(0);
  await hp.getByRole("button", { name: "Send my answers" }).click();
  await expect(hp.getByRole("heading", { name: "Thank you" })).toBeVisible();
  await happy.close();

  // the same survey as a public link would show the follow-up for a low score; check the form logic directly
  const sad = await browser.newContext();
  const sp = await sad.newPage();
  await page.goto(workspaceUrl + "/surveys");
  await sp.goto(link); // already answered by the first visitor: one answer per link
  await expect(
    sp.getByText("You have already answered this survey."),
  ).toBeVisible();
  await sad.close();
});

test("a low score brings up the follow-up question, which then must be answered", async ({
  page,
  browser,
}) => {
  await signIn(page, uniqueName("sc"));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const workspaceUrl = page.url().replace(/\/add$/, "");
  await page.goto(`${workspaceUrl}/surveys`);
  await page.getByLabel("Title").fill("Follow-up");
  await page.getByLabel("How people get it").selectOption("open");
  await page.getByRole("button", { name: "Start a survey" }).click();
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByLabel("Question 1", { exact: true }).fill("Score us");
  await page.getByLabel("Type of answer").first().selectOption("nps");
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByLabel("Question 2", { exact: true }).fill("Why so low?");
  await page.getByRole("checkbox", { name: "Required" }).nth(1).check();
  await page
    .getByLabel("When is this question shown?")
    .selectOption({ label: "Only if the answer to question 1 …" });
  await page.getByLabel("Value", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save questions" }).click();
  await expect(page.getByText("Questions saved.")).toBeVisible();
  await page.getByRole("button", { name: "Open the survey" }).click();
  const link = await page.getByLabel(/Public link/).inputValue();

  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(link);
  await expect(p.getByText("Why so low?")).toHaveCount(0);
  await p.getByText("2", { exact: true }).click();
  await expect(p.getByLabel("Why so low?")).toBeVisible();
  await p.getByRole("button", { name: "Send my answers" }).click();
  await expect(p.locator("p[role=alert]")).toContainText("Why so low?");
  await p.getByText("9", { exact: true }).click(); // changing their mind hides it again, and it is no longer required
  await expect(p.getByLabel("Why so low?")).toHaveCount(0);
  await p.getByRole("button", { name: "Send my answers" }).click();
  await expect(p.getByRole("heading", { name: "Thank you" })).toBeVisible();
  await c.close();
});
