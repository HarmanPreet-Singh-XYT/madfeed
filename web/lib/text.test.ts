import { describe, expect, it } from "vitest";
import {
  byteOffsetOf,
  isUuid,
  percent,
  pieces,
  spanContext,
  utf16IndexAt,
} from "./text";

const bytesIndex = (text: string, needle: string) =>
  new TextEncoder().encode(text.slice(0, text.indexOf(needle))).length;

describe("spanContext", () => {
  const text = "Intro. We need SSO, and Café ☕ rows vanish. Bye.";

  it("slices ASCII by byte offsets", () => {
    const s = text.indexOf("We need SSO");
    const c = spanContext(text, s, s + "We need SSO".length, 10);
    expect(c).toMatchObject({
      before: "Intro. ",
      quote: "We need SSO",
      after: ", and",
      cutStart: false,
      cutEnd: true,
    }); // 10 bytes would cut the 2-byte é, so it stops before it
  });

  it("uses bytes, not characters, when the text has accents and emoji", () => {
    const start = bytesIndex(text, "Café ☕ rows");
    const len = new TextEncoder().encode("Café ☕ rows").length; // 14 bytes for 11 characters
    const c = spanContext(text, start, start + len, 20);
    expect(c?.quote).toBe("Café ☕ rows");
    expect(c?.before.endsWith("and ")).toBe(true);
    expect(c?.after.startsWith(" vanish")).toBe(true);
  });

  it("starts and ends the shortened context on whole words", () => {
    const t = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const start = t.indexOf("echo");
    const c = spanContext(t, start, start + 4, 9);
    expect(c).toMatchObject({
      before: "delta ",
      quote: "echo",
      after: " foxtrot",
      cutStart: true,
      cutEnd: true,
    });
  });

  it("never splits a character when trimming context", () => {
    const t = "☕☕☕☕☕ need this ☕☕☕☕☕";
    const start = bytesIndex(t, "need this");
    const c = spanContext(t, start, start + 9, 4); // 4 bytes = one emoji plus a stray byte
    expect(c).not.toBeNull();
    expect(c!.before).not.toContain("�");
    expect(c!.after).not.toContain("�");
  });

  it("rejects spans that are out of range or cut a character", () => {
    expect(spanContext(text, -1, 5)).toBeNull();
    expect(spanContext(text, 5, 5)).toBeNull();
    expect(spanContext(text, 5, 9999)).toBeNull();
    expect(spanContext(text, 1.5, 4)).toBeNull();
    const cafe = bytesIndex(text, "é");
    expect(spanContext(text, cafe + 1, cafe + 3)).toBeNull(); // starts inside the 2-byte é
  });
});

describe("helpers", () => {
  it("recognises uuids only", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    for (const bad of [
      "",
      "abc",
      "../etc/passwd",
      "11111111-1111-4111-8111-11111111111",
      5,
      null,
    ])
      expect(isUuid(bad)).toBe(false);
  });
  it("formats confidence safely", () => {
    expect(percent(0.876)).toBe("88%");
    expect(percent(2)).toBe("100%");
    expect(percent(-1)).toBe("0%");
  });
});

describe("highlight offsets", () => {
  const text = "ça va? très bien 😀 ok";
  it("converts between bytes and string indexes", () => {
    for (const word of ["très", "😀", "ok"]) {
      const i = text.indexOf(word);
      const bytes = byteOffsetOf(text, i);
      expect(utf16IndexAt(text, bytes)).toBe(i);
    }
    expect(byteOffsetOf(text, 0)).toBe(0);
    expect(utf16IndexAt(text, byteOffsetOf(text, text.length))).toBe(
      text.length,
    );
  });
  it("rejects offsets inside a character or past the end", () => {
    expect(utf16IndexAt(text, 1)).toBe(-1); // inside "ç"
    expect(utf16IndexAt(text, 9999)).toBe(-1);
    expect(utf16IndexAt(text, -1)).toBe(-1);
  });
  it("splits text around highlights, including overlapping ones, without losing a character", () => {
    const a = text.indexOf("très");
    const b = text.indexOf("bien");
    const hs = [
      { id: "1", start: byteOffsetOf(text, a), end: byteOffsetOf(text, b + 4) },
      {
        id: "2",
        start: byteOffsetOf(text, b),
        end: byteOffsetOf(text, b + 4),
      },
      { id: "bad", start: 1, end: 3 }, // splits a character: skipped
    ];
    const ps = pieces(text, hs);
    expect(ps.map((p) => p.text).join("")).toBe(text);
    expect(ps.find((p) => p.text === "très ")?.ids).toEqual(["1"]);
    expect(ps.find((p) => p.text === "bien")?.ids).toEqual(["1", "2"]);
    expect(ps.some((p) => p.ids.includes("bad"))).toBe(false);
    for (const p of ps)
      expect(text.slice(p.start, p.start + p.text.length)).toBe(p.text);
  });
});
