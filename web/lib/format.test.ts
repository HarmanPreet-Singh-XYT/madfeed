import { describe, expect, it } from "vitest";
import { formatValue, impactLine, pct, plural } from "./format";

describe("formatValue", () => {
  it("groups thousands and keeps real cents only", () => {
    expect(formatValue("100000.00")).toBe("100,000");
    expect(formatValue("1234567.89")).toBe("1,234,567.89");
    expect(formatValue("5000.50")).toBe("5,000.50");
    expect(formatValue("0.00")).toBe("0");
    expect(formatValue("999")).toBe("999");
  });
  it("never invents a number from bad input", () => {
    for (const bad of ["", undefined, null, "abc", "1e6", "12,5", "NaN"])
      expect(formatValue(bad as string)).toBe("0");
  });
  it("stays exact for large values (no float rounding)", () => {
    expect(formatValue("99999999999999.99")).toBe("99,999,999,999,999.99");
  });
});

describe("impactLine", () => {
  it("omits revenue when no account has a value", () => {
    expect(
      impactLine({
        peopleCount: 1,
        accountCount: 1,
        totalValue: "0.00",
        accountsWithValue: 0,
      }),
    ).toBe("1 person · 1 account");
  });
  it("shows revenue once there is some", () => {
    expect(
      impactLine({
        peopleCount: 3,
        accountCount: 2,
        totalValue: "255000.00",
        accountsWithValue: 2,
      }),
    ).toBe("3 people · 2 accounts · 255,000 revenue");
  });
});

describe("small helpers", () => {
  it("pluralises and formats rates", () => {
    expect(plural(1, "quote")).toBe("1 quote");
    expect(plural(2, "quote")).toBe("2 quotes");
    expect(pct(0.876)).toBe("88%");
    expect(pct(undefined)).toBe("n/a");
  });
});

describe("clock and file size", () => {
  it("formats times", async () => {
    const { clock } = await import("./format");
    expect(clock(0)).toBe("0:00");
    expect(clock(75_000)).toBe("1:15");
    expect(clock(3_725_000)).toBe("1:02:05");
    expect(clock(-5)).toBe("0:00");
  });
  it("formats sizes", async () => {
    const { fileSize } = await import("./format");
    expect(fileSize(10)).toBe("10 bytes");
    expect(fileSize(1536)).toBe("1.5 KB");
    expect(fileSize(5_300_000)).toBe("5.1 MB");
    expect(fileSize(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});
