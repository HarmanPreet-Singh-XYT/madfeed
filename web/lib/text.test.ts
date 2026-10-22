import { describe, expect, it } from "vitest";
import { isUuid, percent, spanContext } from "./text";

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
