import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

const repoRoot = resolve(__dirname, "../..");

/** Runs SQL as the database owner (test setup only; the app never has this). */
export function sql(statement: string): void {
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "app",
      "-d",
      "app",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-c",
      statement,
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export const uniqueName = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function signIn(page: Page, name: string) {
  await page.goto("/login");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Pretend the worker ran: store proposals for a source item, verified by the database's own quote check. */
export function seedProposals(
  sourceItemId: string,
  quotes: { quote: string; title: string; confidence: number }[],
) {
  const values = quotes
    .map(
      (q) => `(${sqlStr(q.title)}, ${sqlStr(q.quote)},
        octet_length(substr(s.raw_text, 1, strpos(s.raw_text, ${sqlStr(q.quote)}) - 1)),
        octet_length(substr(s.raw_text, 1, strpos(s.raw_text, ${sqlStr(q.quote)}) - 1)) + octet_length(${sqlStr(q.quote)}),
        ${q.confidence}::real)`,
    )
    .join(",");
  sql(`
    INSERT INTO proposal (workspace_id, source_item_id, chunk_id, kind, statement_kind, title, quote_text, span_start, span_end, confidence)
      SELECT s.workspace_id, s.id, c.id, 'new_request', 'need', v.t, v.q, v.a, v.b, v.conf
      FROM source_item s JOIN chunk c ON c.source_item_id = s.id AND c.ordinal = 0
      CROSS JOIN LATERAL (VALUES ${values}) AS v(t, q, a, b, conf)
      WHERE s.id = '${sourceItemId}';
    UPDATE source_item SET processing_state = 'done' WHERE id = '${sourceItemId}';
  `);
}

const sqlStr = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Runs a SELECT as the database owner and returns the rows, one per line (test setup only). */
export function query(statement: string): string[] {
  const out = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "app",
      "-d",
      "app",
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      statement,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Pretend the worker wrote a brief: the claim and cited quotes come from the test, the fingerprint is computed the way the server does. */
export function seedReadyBrief(
  requestId: string,
  claim: string,
  disproof: string,
  quoteCount: number,
) {
  const ids = query(
    `SELECT id FROM evidence WHERE request_id = '${requestId}' ORDER BY created_at DESC, id`,
  );
  const sorted = [...ids].sort();
  const h = createHash("sha256");
  for (const id of sorted) {
    h.update(id);
    h.update(Buffer.from([0]));
  }
  const cited = ids
    .slice(0, quoteCount)
    .map((i) => `'${i}'`)
    .join(",");
  sql(`UPDATE brief SET state='ready', claim=${sqlStr(claim)}, disproof=${sqlStr(disproof)}, quote_evidence_ids=ARRAY[${cited}]::uuid[],
       evidence_fingerprint='${h.digest("hex")}', low_evidence=${ids.length < 2}, prompt_version='e2e', generated_at=now() WHERE request_id='${requestId}'`);
}

export type Delivered = {
  id: string;
  idempotencyKey: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  headers: Record<string, string> | null;
};

const mailUrl = "http://127.0.0.1:9998/outbox";

/** What the local mail stand-in has "delivered" so far. */
export async function outbox(): Promise<Delivered[]> {
  const res = await fetch(mailUrl);
  return (await res.json()) ?? [];
}

export async function clearOutbox(): Promise<void> {
  await fetch(mailUrl, { method: "DELETE" });
}

/** Where the test API and worker keep uploaded recordings (see playwright.config.ts). */
export const MEDIA_DIR = join(tmpdir(), "feedback-e2e-media");

/** Stored recording files for one workspace (empty when none). */
export function storedFiles(workspaceId: string): string[] {
  try {
    return readdirSync(join(MEDIA_DIR, workspaceId));
  } catch {
    return [];
  }
}

/** A playable mono WAV of silence: 8 kHz, 8-bit, so one second is 8,000 bytes. */
export function silentWav(seconds: number): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds, 0x80);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
