import { describe, expect, it } from "vitest";
import { dayGroup, filterOf, matches } from "./recordings";

const at = (iso: string) => new Date(iso);

describe("dayGroup", () => {
  const now = at("2026-10-29T09:00:00");

  it("labels today and yesterday", () => {
    expect(dayGroup("2026-10-29T01:00:00", now)).toBe("Today");
    expect(dayGroup("2026-10-28T23:00:00", now)).toBe("Yesterday");
  });

  it("groups the rest of the week, month and older", () => {
    expect(dayGroup("2026-10-26T12:00:00", now)).toBe("This week");
    expect(dayGroup("2026-10-02T12:00:00", now)).toBe("This month");
    expect(dayGroup("2026-08-02T12:00:00", now)).toBe("Earlier");
  });

  it("treats a future time (clock skew) as today rather than a new group", () => {
    expect(dayGroup("2026-10-29T18:00:00", now)).toBe("Today");
  });
});

describe("filterOf", () => {
  it("maps every state to one of three useful filters", () => {
    expect(filterOf({ state: "done" })).toBe("done");
    expect(filterOf({ state: "uploaded" })).toBe("processing");
    expect(filterOf({ state: "transcribing" })).toBe("processing");
    expect(filterOf({ state: "failed" })).toBe("attention");
    expect(filterOf({ state: "uploading" })).toBe("attention");
  });
});

describe("matches", () => {
  const m = { filename: "interview-priya.m4a", personId: "p1" };

  it("matches the file name and the person, ignoring case", () => {
    expect(matches(m, "Priya Shah", "priya")).toBe(true);
    expect(matches(m, undefined, "INTERVIEW")).toBe(true);
  });

  it("does not match an empty or unrelated query", () => {
    expect(matches(m, "Priya", "   ")).toBe(true);
    expect(matches(m, "Priya", "sam")).toBe(false);
  });

  it("matches a person whose name differs from the file name", () => {
    expect(
      matches({ filename: "call-1.wav", personId: "p2" }, "Sam Lee", "sam"),
    ).toBe(true);
  });
});
