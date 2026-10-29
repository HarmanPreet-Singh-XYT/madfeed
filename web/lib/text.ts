// Spans from the API are BYTE offsets into the UTF-8 source text, but
// JavaScript strings are UTF-16. Always slice through bytes.
const enc = new TextEncoder();
const dec = new TextDecoder();

export type SpanContext = {
  before: string;
  quote: string;
  after: string;
  cutStart: boolean; // text before was shortened
  cutEnd: boolean; // text after was shortened
};

const isContinuation = (b: number) => (b & 0xc0) === 0x80;
const isSpace = (b: number) =>
  b === 0x20 || b === 0x0a || b === 0x09 || b === 0x0d;

// Index of the first/last space byte in [from, to), or -1.
function firstSpace(bytes: Uint8Array, from: number, to: number): number {
  for (let i = from; i < to; i++) if (isSpace(bytes[i])) return i;
  return -1;
}
function lastSpace(bytes: Uint8Array, from: number, to: number): number {
  for (let i = to - 1; i >= from; i--) if (isSpace(bytes[i])) return i;
  return -1;
}

/**
 * The quote at [start, end) with `pad` bytes of surrounding text, trimmed to
 * whole characters. Returns null if the span does not lie inside the text, so
 * a bad span is shown as missing, never as the wrong words.
 */
export function spanContext(
  text: string,
  start: number,
  end: number,
  pad = 180,
): SpanContext | null {
  const bytes = enc.encode(text);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > bytes.length
  ) {
    return null;
  }
  if (
    (start < bytes.length && isContinuation(bytes[start])) ||
    (end < bytes.length && isContinuation(bytes[end]))
  ) {
    return null; // splits a character
  }
  let from = Math.max(0, start - pad);
  while (from < start && isContinuation(bytes[from])) from++;
  // When shortened, start after a space so the context begins on a whole word.
  if (from > 0) {
    const gap = firstSpace(bytes, from, start);
    if (gap >= 0) from = gap + 1;
  }
  let to = Math.min(bytes.length, end + pad);
  while (to > end && to < bytes.length && isContinuation(bytes[to])) to--;
  // ...and end before a space.
  if (to < bytes.length) {
    const gap = lastSpace(bytes, end, to);
    if (gap >= 0) to = gap;
  }
  return {
    before: dec.decode(bytes.slice(from, start)),
    quote: dec.decode(bytes.slice(start, end)),
    after: dec.decode(bytes.slice(end, to)),
    cutStart: from > 0,
    cutEnd: to < bytes.length,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && UUID.test(s);

export function percent(confidence: number): string {
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

export const KIND_LABEL: Record<string, string> = {
  need: "Request",
  bug: "Problem",
  praise: "Praise",
  question: "Question",
};

/** UTF-8 byte offset of a UTF-16 string index (what the API stores for spans). */
export function byteOffsetOf(text: string, utf16Index: number): number {
  return enc.encode(text.slice(0, utf16Index)).length;
}

/**
 * Every place `query` appears in `text`, ignoring case, as byte ranges so they
 * line up with stored spans. The query is matched literally, so a period or a
 * bracket in a customer's words is a character, not a pattern. Two characters
 * at least, or every word would match.
 */
export function findMatches(
  text: string,
  query: string,
  limit = 500,
): { start: number; end: number }[] {
  const needle = query.trim();
  if (needle.length < 2) return [];
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && out.length < limit) {
    out.push({
      start: byteOffsetOf(text, m.index),
      end: byteOffsetOf(text, m.index + m[0].length),
    });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/**
 * UTF-16 string index of a UTF-8 byte offset, or -1 when the offset is past
 * the end or falls inside a character.
 */
export function utf16IndexAt(text: string, byteOffset: number): number {
  if (byteOffset < 0) return -1;
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    if (bytes === byteOffset) return i;
    if (bytes > byteOffset) return -1;
    const cp = text.codePointAt(i)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp >= 0x10000 ? 2 : 1;
  }
  return bytes === byteOffset ? text.length : -1;
}

export type Piece = { text: string; start: number; ids: string[] };

/**
 * Splits text into pieces so each stored highlight can be shown as a mark.
 * `start` is the piece's UTF-16 index in the text (used to turn a browser
 * selection back into an offset). Highlights whose spans do not fit the text
 * are left out rather than drawn in the wrong place.
 */
export function pieces(
  text: string,
  highlights: { id: string; start: number; end: number }[],
): Piece[] {
  const marks = highlights
    .map((h) => ({
      id: h.id,
      a: utf16IndexAt(text, h.start),
      b: utf16IndexAt(text, h.end),
    }))
    .filter((m) => m.a >= 0 && m.b > m.a);
  const cuts = [
    ...new Set([0, text.length, ...marks.flatMap((m) => [m.a, m.b])]),
  ].sort((x, y) => x - y);
  const out: Piece[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    if (b <= a) continue;
    out.push({
      text: text.slice(a, b),
      start: a,
      ids: marks.filter((m) => m.a <= a && m.b >= b).map((m) => m.id),
    });
  }
  return out;
}
