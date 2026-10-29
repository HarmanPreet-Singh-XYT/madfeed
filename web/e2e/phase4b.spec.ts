import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  query,
  signIn,
  silentWav,
  sql,
  storedFiles,
  uniqueName,
} from "./helpers";

async function accessible(page: Page, label: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = r.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help}`),
    `accessibility problems on ${label}`,
  ).toEqual([]);
}

async function noSideways(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

async function newWorkspace(page: Page, prefix: string) {
  await signIn(page, uniqueName(prefix));
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+\/add$/);
  const url = page.url().replace(/\/add$/, "");
  return { url, id: url.split("/").pop()! };
}

const currentTime = (page: Page) =>
  page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1);

async function selectInLine(page: Page, needle: string) {
  await page.evaluate((n) => {
    const article = document.querySelector(
      'article[aria-label="Original text"]',
    )!;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = (node as Text).data.indexOf(n);
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + n.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    throw new Error("text not found");
  }, needle);
}

test("upload a recording, read and play its transcript, highlight, get suggestions, delete", async ({
  page,
}) => {
  const ws = await newWorkspace(page, "p4b");

  // tags first, so there is something to suggest with
  await page.goto(`${ws.url}/research/codebook`);
  for (const name of ["Export", "Roll"]) {
    await expect(async () => {
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByRole("button", { name: "Add tag" }).click();
      await expect(page.getByText(`Added “${name}”.`)).toBeVisible({
        timeout: 3_000,
      });
    }).toPass({ timeout: 20_000 });
  }

  // --- upload
  await page.goto(`${ws.url}/recordings`);
  await expect(page.getByText("No recordings yet.")).toBeVisible();
  await accessible(page, "recordings (empty)");
  await expect(page.getByLabel("Recording file")).toBeEnabled();
  await page.getByLabel("Recording file").setInputFiles({
    name: "Interview 1.wav",
    mimeType: "audio/wav",
    buffer: silentWav(20),
  });
  await expect(page.getByText("Transcript ready")).toBeVisible({
    timeout: 60_000,
  });
  await accessible(page, "recordings");
  await noSideways(page);
  expect(storedFiles(ws.id)).toHaveLength(1);

  // --- the transcript, with the recording
  await page
    .getByRole("link", { name: "Open the transcript and recording" })
    .click();
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+$/);
  const sourceUrl = page.url();
  const audio = page.locator("audio");
  await expect(audio).toBeVisible();
  await expect(page.getByText("Priya: We cannot roll this out")).toBeVisible();
  await accessible(page, "transcript");
  await noSideways(page);

  // clicking a line plays the recording from there (within a second)
  await page.getByRole("button", { name: "Play from 0:12, Priya" }).click();
  await expect
    .poll(() => currentTime(page), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(11.5);
  expect(await currentTime(page)).toBeLessThan(15);
  await page.getByRole("button", { name: "Play from 0:06, Sam" }).click();
  await expect
    .poll(() => currentTime(page), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(5.5);
  expect(await currentTime(page)).toBeLessThan(9);
  await audio.evaluate((a: HTMLAudioElement) => a.pause());
  // the line being played is marked
  await expect(page.locator('[data-segment][aria-current="true"]')).toHaveCount(
    1,
  );

  // --- highlight words inside a line; it remembers when it was said
  await expect(async () => {
    await selectInLine(page, "weekly export is painful");
    await expect(page.getByText("Highlight this passage?")).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("checkbox", { name: "Export" }).check();
  await page.getByRole("button", { name: "Save highlight" }).click();
  await expect(page.getByText("Highlighted.")).toBeVisible();
  await page.reload();
  await expect(page.locator("mark[data-highlighted]")).toHaveText(
    "weekly export is painful",
  );
  const rows = query(
    `SELECT h.quote_text, sg.start_ms, h.quote_text = substr(s.raw_text, h.span_start + 1, h.span_end - h.span_start) FROM highlight h JOIN source_item s ON s.id = h.source_item_id JOIN segment sg ON sg.source_item_id = s.id AND sg.span_start <= h.span_start AND sg.span_end >= h.span_end WHERE h.workspace_id = '${ws.id}'`,
  );
  expect(rows).toEqual(["weekly export is painful|12000|t"]);

  // the research feed links straight back to that moment
  await page.goto(`${ws.url}/research`);
  await page.getByRole("link", { name: "Play from 0:12" }).click();
  await expect(page).toHaveURL(/[?&]t=12000/);
  await expect
    .poll(() => currentTime(page), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(11.5);

  // --- the assistant suggests highlights from the tags; nothing happens until accepted
  await page.goto(sourceUrl);
  await page
    .getByRole("button", { name: "Suggest highlights using my tags" })
    .click();
  const first = page
    .getByRole("listitem")
    .filter({ hasText: "We cannot roll this out" });
  await expect(first).toBeVisible({ timeout: 60_000 });
  await accessible(page, "suggestions");
  expect(
    query(`SELECT count(*) FROM highlight WHERE workspace_id = '${ws.id}'`)[0],
  ).toBe("1");
  await first.getByRole("button", { name: "Accept" }).click();
  await expect(first).toBeHidden({ timeout: 15_000 });
  expect(
    query(`SELECT count(*) FROM highlight WHERE workspace_id = '${ws.id}'`)[0],
  ).toBe("2");

  // --- delete: the file, the transcript and the highlights all go
  await page.goto(`${ws.url}/recordings`);
  await page.getByRole("button", { name: "Delete Interview 1.wav" }).click();
  // The dialog fades in; scan it once it has settled, or axe reads the half-transparent frame.
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.waitForTimeout(300);
  await accessible(page, "delete confirmation");
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByText("No recordings yet.")).toBeVisible({
    timeout: 15_000,
  });
  // The delete is undoable for a moment, so the rows stay until the purge job runs.
  expect(
    query(`SELECT count(*) FROM media WHERE workspace_id = '${ws.id}'`)[0],
  ).toBe("1");
  await expect
    .poll(
      () =>
        query(`SELECT count(*) FROM media WHERE workspace_id = '${ws.id}'`)[0],
      { timeout: 45_000 },
    )
    .toBe("0");
  expect(storedFiles(ws.id)).toHaveLength(0);
  for (const table of [
    "source_item",
    "segment",
    "highlight",
    "highlight_proposal",
  ]) {
    expect(
      query(`SELECT count(*) FROM ${table} WHERE workspace_id = '${ws.id}'`)[0],
      table,
    ).toBe("0");
  }
});

test("a deleted recording can be brought back before the window closes", async ({
  page,
}) => {
  const ws = await newWorkspace(page, "p4u");
  await page.goto(`${ws.url}/recordings`);
  await expect(page.getByLabel("Recording file")).toBeEnabled();
  await page.getByLabel("Recording file").setInputFiles({
    name: "undo-me.wav",
    mimeType: "audio/wav",
    buffer: silentWav(20),
  });
  await expect(page.getByText("Transcript ready")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "Delete undo-me.wav" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByText("No recordings yet.")).toBeVisible({
    timeout: 15_000,
  });

  // The toast offers Undo; taking it puts the recording back as it was, with its transcript.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("undo-me.wav")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Transcript ready")).toBeVisible();
  expect(
    query(
      `SELECT count(*) FROM media WHERE workspace_id = '${ws.id}' AND deleted_at IS NULL`,
    )[0],
  ).toBe("1");
  await expect(
    page.getByRole("link", { name: "Open the transcript and recording" }),
  ).toBeVisible();
});

test("several recordings can be added at once, and a recording can be renamed", async ({
  page,
}) => {
  const ws = await newWorkspace(page, "p4m");
  await page.goto(`${ws.url}/recordings`);
  // The picker stays disabled until the page is interactive; a file chosen before that is ignored.
  await expect(page.getByLabel("Recording file")).toBeEnabled();

  // One picker, two files: they go up one after another.
  await page.getByLabel("Recording file").setInputFiles([
    { name: "one.wav", mimeType: "audio/wav", buffer: silentWav(20) },
    { name: "two.wav", mimeType: "audio/wav", buffer: silentWav(20) },
  ]);
  await expect(page.getByText("Transcript ready")).toHaveCount(2, {
    timeout: 90_000,
  });
  expect(storedFiles(ws.id)).toHaveLength(2);

  // A name of its own, shown here and on the transcript.
  await page.getByRole("button", { name: "Rename one.wav" }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Kickoff call");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Kickoff call")).toBeVisible({ timeout: 10_000 });
  // It survives a reload, and the transcript it opens carries the same name.
  await page.reload();
  const renamed = page.locator("li").filter({ hasText: "Kickoff call" });
  await expect(renamed).toHaveCount(1);
  await renamed
    .getByRole("link", { name: "Open the transcript and recording" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Kickoff call" }),
  ).toBeVisible();
  await accessible(page, "a renamed transcript");
});

test("an upload survives a dropped connection and can be continued after leaving the page", async ({
  page,
}) => {
  const ws = await newWorkspace(page, "p4r");
  const wav = silentWav(600); // about 4.8 MB, so two pieces
  await page.goto(`${ws.url}/recordings`);

  // 1. The second piece fails once at the network level; the page retries by itself.
  let dropped = false;
  await page.route("**/api/media/**/chunk?offset=*", async (route) => {
    if (!route.request().url().endsWith("offset=0") && !dropped) {
      dropped = true;
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await expect(page.getByLabel("Recording file")).toBeEnabled();
  await page.getByLabel("Recording file").setInputFiles({
    name: "long call.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(page.getByText("Connection lost. Trying again…")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Transcript ready")).toBeVisible({
    timeout: 90_000,
  });
  expect(dropped).toBe(true);
  expect(
    query(
      `SELECT size_bytes = received_bytes FROM media WHERE workspace_id = '${ws.id}'`,
    ),
  ).toEqual(["t"]);
  await page.unroute("**/api/media/**/chunk?offset=*");

  // 2. Leave in the middle of an upload; come back and continue it.
  await page.route("**/api/media/**/chunk?offset=*", async (route) => {
    if (route.request().url().endsWith("offset=0")) await route.continue();
    // later pieces hang until the page goes away
  });
  await expect(page.getByLabel("Recording file")).toBeEnabled();
  await page.getByLabel("Recording file").setInputFiles({
    name: "second call.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect
    .poll(
      () =>
        query(
          `SELECT received_bytes FROM media WHERE workspace_id = '${ws.id}' AND filename = 'second call.wav'`,
        )[0],
      { timeout: 20_000 },
    )
    .not.toBe("0");
  await page.goto(`${ws.url}/people`); // navigating away cancels the hanging request
  await page.unroute("**/api/media/**/chunk?offset=*");
  await page.goto(`${ws.url}/recordings`);
  await expect(
    page.getByText(/Upload not finished — .* of .* received/),
  ).toBeVisible();
  await accessible(page, "recordings with an unfinished upload");

  await page.getByRole("button", { name: "Continue this upload" }).click();
  // the wrong file is refused in plain words
  await page.getByLabel(/Choose second call.wav again/).setInputFiles({
    name: "other.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(
    page.getByText(/Choose the same file to continue/),
  ).toBeVisible();
  await page.getByLabel(/Choose second call.wav again/).setInputFiles({
    name: "second call.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(page.getByText("Transcript ready")).toHaveCount(2, {
    timeout: 90_000,
  });
  expect(
    query(
      `SELECT count(*) FROM media WHERE workspace_id = '${ws.id}' AND state = 'done' AND size_bytes = received_bytes`,
    )[0],
  ).toBe("2");
  expect(storedFiles(ws.id)).toHaveLength(2);
});

test("a viewer can play and read a recording but not upload, suggest or delete", async ({
  page,
  browser,
}) => {
  const ws = await newWorkspace(page, "owner4b");
  await page.goto(`${ws.url}/recordings`);
  await expect(page.getByLabel("Recording file")).toBeEnabled();
  await page.getByLabel("Recording file").setInputFiles({
    name: "viewed.wav",
    mimeType: "audio/wav",
    buffer: silentWav(20),
  });
  await expect(page.getByText("Transcript ready")).toBeVisible({
    timeout: 60_000,
  });
  await page
    .getByRole("link", { name: "Open the transcript and recording" })
    .click();
  await expect(page).toHaveURL(/\/sources\/[0-9a-f-]+$/);
  const sourceUrl = page.url();

  const ctx = await browser.newContext();
  const vp = await ctx.newPage();
  await signIn(vp, uniqueName("view4b"));
  const token = (await ctx.cookies()).find((c) => c.name === "session")!.value;
  const sub = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  ).sub as string;
  sql(
    `INSERT INTO member (workspace_id, user_id, role) VALUES ('${ws.id}', '${sub}', 'viewer')`,
  );

  await vp.goto(`${ws.url}/recordings`);
  await expect(vp.getByText("viewed.wav")).toBeVisible();
  await expect(vp.getByLabel("Recording file")).toHaveCount(0);
  await expect(vp.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  await vp.goto(sourceUrl);
  await expect(vp.locator("audio")).toBeVisible();
  await vp.getByRole("button", { name: "Play from 0:06, Sam" }).click();
  await expect
    .poll(
      () =>
        vp.evaluate(() => document.querySelector("audio")?.currentTime ?? -1),
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(5.5);
  await expect(
    vp.getByRole("button", { name: "Suggest highlights using my tags" }),
  ).toHaveCount(0);
  await expect(vp.getByRole("button", { name: /^Delete this/ })).toHaveCount(0);

  // the file route refuses people outside the workspace and signed-out visitors
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  const mediaId = query(
    `SELECT id FROM media WHERE workspace_id = '${ws.id}'`,
  )[0];
  expect(
    (await sp.request.get(`/api/media/${ws.id}/${mediaId}/file`)).status(),
  ).toBe(401);
  await signIn(sp, uniqueName("outsider"));
  expect(
    (await sp.request.get(`/api/media/${ws.id}/${mediaId}/file`)).status(),
  ).toBe(404);
  const put = await sp.request.put(
    `/api/media/${ws.id}/${mediaId}/chunk?offset=0`,
    {
      headers: { Origin: "https://evil.example" },
      data: Buffer.from("x"),
    },
  );
  expect(put.status()).toBe(403);
  await stranger.close();
  await ctx.close();
});
