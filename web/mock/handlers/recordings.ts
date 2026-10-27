import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

// Recordings: upload in pieces, a moment of "transcribing", then a transcript and a player. The audio is a short
// stretch of silence generated on the spot, so playback and seeking work without any real file.

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();
const TRANSCRIBING_MS = 3500;

const media = (s: Store, id: string) => {
  const m = s.media.find((x) => x.id === id);
  if (!m) throw notFound("That recording");
  return m;
};

/** Moves a finished upload on from "transcribing" to "done" once a moment has passed, making its conversation. */
function advance(s: Store, m: Store["media"][number]) {
  const finished = s.mediaCompletedAt[m.id];
  if (
    m.state !== "transcribing" ||
    !finished ||
    Date.now() - finished < TRANSCRIBING_MS
  )
    return m;
  const lines = [
    [
      "Interviewer",
      "Thanks for making time. What is the hardest part of your week?",
    ],
    [
      "Customer",
      "Getting everyone's feedback into one place. We need a way to share it with the team without copying and pasting.",
    ],
  ];
  const text = lines.map(([who, l]) => `${who}: ${l}`).join("\n");
  const enc = new TextEncoder();
  let offset = 0;
  const id = freshId();
  s.transcripts[id] = lines.map(([who, l], i) => {
    const line = `${who}: ${l}`;
    const start = enc.encode(text.slice(0, text.indexOf(line, offset))).length;
    offset = text.indexOf(line, offset) + line.length;
    return {
      ordinal: i,
      startMs: i * 9000,
      endMs: i * 9000 + 8500,
      speaker: who,
      spanStart: start,
      spanEnd: start + enc.encode(line).length,
    };
  });
  s.sources.unshift({
    id,
    kind: "recording",
    redactions: 0,
    title: m.filename,
    state: "done",
    createdAt: now(),
    text,
    mediaId: m.id,
  });
  Object.assign(m, { state: "done", durationMs: 18_000, sourceItemId: id });
  return m;
}

on("GET", `${W}/media`, ({ s }) => ({
  media: s.media.map((m) => advance(s, m)),
}));
on("GET", `${W}/media/{mediaId}`, ({ s, params }) =>
  advance(s, media(s, params.mediaId)),
);
on("POST", `${W}/media`, ({ s, body }) => {
  const m = {
    id: freshId(),
    filename: String(body.filename),
    mimeType: String(body.mimeType),
    sizeBytes: Number(body.sizeBytes),
    receivedBytes: 0,
    chunkBytes: 1_048_576,
    state: "uploading" as const,
    personId: body.personId,
    createdAt: now(),
  };
  s.media.unshift(m);
  return created(m);
});
on(
  "PUT",
  `${W}/media/{mediaId}/chunk`,
  ({ s, params, query, uploadedBytes }) => {
    const m = media(s, params.mediaId);
    if (Number(query.get("offset")) !== m.receivedBytes)
      throw new MockError(
        409,
        "wrong_offset",
        "That piece does not follow the last one.",
      );
    m.receivedBytes = Math.min(m.sizeBytes, m.receivedBytes + uploadedBytes);
    return m;
  },
);
on("POST", `${W}/media/{mediaId}/complete`, ({ s, params }) => {
  const m = media(s, params.mediaId);
  if (m.receivedBytes < m.sizeBytes)
    throw new MockError(
      409,
      "incomplete",
      "The whole file has not arrived yet.",
    );
  m.state = "transcribing";
  s.mediaCompletedAt[m.id] = Date.now();
  return m;
});
on("DELETE", `${W}/media/{mediaId}`, ({ s, params }) => {
  const m = media(s, params.mediaId);
  s.media = s.media.filter((x) => x.id !== m.id);
  if (m.sourceItemId) {
    s.sources = s.sources.filter((x) => x.id !== m.sourceItemId);
    delete s.transcripts[m.sourceItemId];
  }
});

/** A WAV of silence, 8 kHz, 8-bit, mono. */
function silence(seconds: number): Uint8Array {
  const n = 8000 * seconds;
  const out = new Uint8Array(44 + n).fill(128);
  const v = new DataView(out.buffer);
  const tag = (o: number, t: string) =>
    [...t].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  tag(36, "data");
  v.setUint32(40, n, true);
  return out;
}
on("GET", `${W}/media/{mediaId}/file`, ({ s, params, headers }) => {
  const m = media(s, params.mediaId);
  const all = silence(Math.max(5, Math.round((m.durationMs ?? 60_000) / 1000)));
  const range = /^bytes=(\d*)-(\d*)$/.exec(headers.get("range") ?? "");
  const base = { "Content-Type": "audio/wav", "Accept-Ranges": "bytes" };
  if (!range)
    return new Response(all as BodyInit, {
      headers: { ...base, "Content-Length": String(all.length) },
    });
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2]
    ? Math.min(Number(range[2]), all.length - 1)
    : all.length - 1;
  const part = all.slice(start, end + 1);
  return new Response(part as BodyInit, {
    status: 206,
    headers: {
      ...base,
      "Content-Length": String(part.length),
      "Content-Range": `bytes ${start}-${end}/${all.length}`,
    },
  });
});

on("GET", `${W}/sources/{sourceItemId}/transcript`, ({ s, params }) => {
  const src = s.sources.find((x) => x.id === params.sourceItemId);
  const segments = s.transcripts[params.sourceItemId];
  if (!src?.mediaId || !segments) throw notFound("A transcript");
  return { mediaId: src.mediaId, segments };
});

// ---- suggested highlights
on(
  "GET",
  `${W}/sources/{sourceItemId}/highlight-suggestions`,
  ({ s, params }) => ({
    suggestions: s.suggestions
      .filter((x) => x.sourceItemId === params.sourceItemId)
      .map(({ sourceItemId, ...rest }) => (void sourceItemId, rest)),
  }),
);
on(
  "POST",
  `${W}/sources/{sourceItemId}/highlight-suggestions`,
  ({ s, params }) => {
    const src = s.sources.find((x) => x.id === params.sourceItemId);
    if (!src) throw notFound("That conversation");
    const line = src.text.split("\n").find((l) => l.length > 40);
    if (line && !s.suggestions.some((x) => x.sourceItemId === src.id)) {
      const enc = new TextEncoder();
      const start = enc.encode(
        src.text.slice(0, src.text.indexOf(line)),
      ).length;
      s.suggestions.push({
        id: freshId(),
        sourceItemId: src.id,
        quote: line,
        spanStart: start,
        spanEnd: start + enc.encode(line).length,
        confidence: 0.8,
        tags: [],
      });
    }
    return new Response(null, { status: 202 });
  },
);
on(
  "POST",
  `${W}/highlight-suggestions/{suggestionId}/accept`,
  ({ s, params, body }) => {
    const sug = s.suggestions.find((x) => x.id === params.suggestionId);
    if (!sug) throw notFound("That suggestion");
    const src = s.sources.find((x) => x.id === sug.sourceItemId)!;
    const tagIds: string[] = body?.tagIds ?? sug.tags.map((t) => t.id);
    const h = {
      id: freshId(),
      sourceItemId: src.id,
      sourceTitle: src.title,
      spanStart: sug.spanStart,
      spanEnd: sug.spanEnd,
      quote: sug.quote,
      note: "",
      tags: s.tags
        .filter((t) => tagIds.includes(t.id))
        .map((t) => ({ id: t.id, name: t.name, color: t.color })),
      createdAt: now(),
    };
    s.highlights.unshift(h);
    s.suggestions = s.suggestions.filter((x) => x.id !== sug.id);
    return created(h);
  },
);
on(
  "POST",
  `${W}/highlight-suggestions/{suggestionId}/dismiss`,
  ({ s, params }) => {
    s.suggestions = s.suggestions.filter((x) => x.id !== params.suggestionId);
  },
);
