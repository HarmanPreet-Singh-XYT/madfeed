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
