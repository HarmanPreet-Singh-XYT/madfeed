import { describe, expect, it } from "vitest";
import {
  outcomeSegments,
  outcomeWidths,
  parseQualityDays,
  rateDelta,
} from "./quality";

const counts = (
  accepted: number,
  acceptedEdited: number,
  dismissed: number,
  stillOpen: number,
) => ({ accepted, acceptedEdited, dismissed, stillOpen });

describe("parseQualityDays", () => {
  it("accepts only the offered windows", () => {
    expect(parseQualityDays("7")).toBe(7);
    expect(parseQualityDays("30")).toBe(30);
    expect(parseQualityDays("90")).toBe(90);
  });

  it("falls back to 30 for anything else", () => {
    expect(parseQualityDays(undefined)).toBe(30);
    expect(parseQualityDays("365")).toBe(30);
    expect(parseQualityDays("abc")).toBe(30);
    expect(parseQualityDays("-7")).toBe(30);
  });
});

describe("outcomeSegments", () => {
  it("splits accepted into as-suggested and edited, and keeps waiting out of the rates", () => {
    const rows = outcomeSegments(counts(6, 2, 4, 10));
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.accepted.count).toBe(4); // 6 accepted, 2 of them edited
    expect(by.accepted.percent).toBe(40); // 4 of 10 decided
    expect(by.acceptedEdited.count).toBe(2);
    expect(by.acceptedEdited.percent).toBe(20);
    expect(by.dismissed.percent).toBe(40);
    expect(by.stillOpen.percent).toBe(50); // 10 of 20 suggestions overall
  });

  it("does not divide by zero", () => {
    for (const row of outcomeSegments(counts(0, 0, 0, 0))) {
      expect(row.percent).toBe(0);
      expect(Number.isFinite(row.percent)).toBe(true);
    }
    for (const width of Object.values(outcomeWidths(counts(0, 0, 0, 0)))) {
      expect(width).toBe(0);
    }
  });
});

describe("outcomeWidths", () => {
  it("adds up to the whole pile", () => {
    const w = outcomeWidths(counts(5, 1, 5, 10));
    const sum = w.accepted + w.acceptedEdited + w.dismissed + w.stillOpen;
    expect(Math.round(sum)).toBe(100);
    expect(w.stillOpen).toBe(50);
  });
});

describe("rateDelta", () => {
  it("compares in percentage points", () => {
    expect(rateDelta(0.8, 0.7, 40, 20)).toEqual({ kind: "up", points: 10 });
    expect(rateDelta(0.62, 0.7, 40, 20)).toEqual({ kind: "down", points: 8 });
    expect(rateDelta(0.7, 0.7, 40, 20)).toEqual({ kind: "same", points: 0 });
  });

  it("does not compare when the previous window is too small", () => {
    expect(rateDelta(0.9, 0.5, 10, 20)).toEqual({ kind: "none", points: 0 });
    expect(rateDelta(0.9, undefined, 40, 20)).toEqual({
      kind: "none",
      points: 0,
    });
  });
});
