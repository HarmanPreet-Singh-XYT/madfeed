import { describe, expect, it } from "vitest";
import { instantToLocal, localToInstant, offsetMinutes } from "./time";

const iso = (d: Date | null) => d?.toISOString();

describe("localToInstant", () => {
  it("handles ordinary times, including half-hour and extreme zones", () => {
    expect(iso(localToInstant("2026-07-01T09:00", "Europe/London"))).toBe(
      "2026-07-01T08:00:00.000Z",
    ); // summer time
    expect(iso(localToInstant("2026-01-01T09:00", "Europe/London"))).toBe(
      "2026-01-01T09:00:00.000Z",
    );
    expect(iso(localToInstant("2026-01-01T09:00", "Asia/Kolkata"))).toBe(
      "2026-01-01T03:30:00.000Z",
    );
    expect(iso(localToInstant("2026-01-01T12:00", "Pacific/Kiritimati"))).toBe(
      "2025-12-31T22:00:00.000Z",
    ); // +14
    expect(iso(localToInstant("2026-01-01T12:00", "Pacific/Pago_Pago"))).toBe(
      "2026-01-01T23:00:00.000Z",
    ); // -11
    expect(iso(localToInstant("2026-01-01T12:00", "Australia/Lord_Howe"))).toBe(
      "2026-01-01T01:00:00.000Z",
    ); // +11 in summer
    expect(iso(localToInstant("2026-07-01T12:00", "Australia/Lord_Howe"))).toBe(
      "2026-07-01T01:30:00.000Z",
    ); // +10:30 in winter
  });

  it("moves a time that does not exist (clocks jump forward) to just after the jump", () => {
    // US clocks go 02:00 -> 03:00 on 2026-03-08, so 02:30 never happens in New York.
    expect(iso(localToInstant("2026-03-08T02:30", "America/New_York"))).toBe(
      "2026-03-08T07:30:00.000Z",
    ); // 03:30 EDT
    expect(iso(localToInstant("2026-03-08T01:59", "America/New_York"))).toBe(
      "2026-03-08T06:59:00.000Z",
    ); // still EST
    expect(iso(localToInstant("2026-03-08T03:00", "America/New_York"))).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    // Southern hemisphere: Sydney's clocks jump forward on 2026-10-04 at 02:00.
    expect(iso(localToInstant("2026-10-04T02:30", "Australia/Sydney"))).toBe(
      "2026-10-03T16:30:00.000Z",
    ); // 03:30 AEDT
  });

  it("picks the earlier moment for a time that happens twice (clocks go back)", () => {
    // US clocks go 02:00 -> 01:00 on 2026-11-01, so 01:30 happens twice in New York.
    expect(iso(localToInstant("2026-11-01T01:30", "America/New_York"))).toBe(
      "2026-11-01T05:30:00.000Z",
    ); // the first, EDT
    expect(iso(localToInstant("2026-11-01T00:30", "America/New_York"))).toBe(
      "2026-11-01T04:30:00.000Z",
    );
    expect(iso(localToInstant("2026-11-01T02:30", "America/New_York"))).toBe(
      "2026-11-01T07:30:00.000Z",
    ); // after: EST
  });

  it("rejects things that are not dates", () => {
    for (const bad of [
      "",
      "tomorrow",
      "2026-02-30T10:00",
      "2026-13-01T10:00",
      "2026-01-01T25:00",
      "2026-01-01 10:00",
      "2026-01-01T10:60",
    ]) {
      expect(localToInstant(bad, "UTC")).toBeNull();
    }
  });

  it("round-trips every real local time (property test across zones and a year of days)", () => {
    const zones = [
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Berlin",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Australia/Sydney",
      "Australia/Lord_Howe",
      "Pacific/Auckland",
      "Pacific/Kiritimati",
      "America/Sao_Paulo",
    ];
    let checked = 0;
    for (const zone of zones) {
      for (let day = 0; day < 366; day += 3) {
        for (const time of [
          "00:00",
          "01:30",
          "02:30",
          "09:00",
          "12:00",
          "23:59",
        ]) {
          const date = new Date(Date.UTC(2026, 0, 1 + day))
            .toISOString()
            .slice(0, 10);
          const local = `${date}T${time}`;
          const instant = localToInstant(local, zone);
          expect(instant, `${zone} ${local}`).not.toBeNull();
          const shown = instantToLocal(instant!, zone);
          if (shown === local)
            checked++; // a real time shows back as itself; a time in a gap shows as the time after it
          else {
            const asked = Date.parse(local + ":00Z");
            const got = Date.parse(shown + ":00Z");
            expect(
              got,
              `${zone} ${local} -> ${shown} (a gap may only move a time forward, by at most 2 hours)`,
            ).toBeGreaterThan(asked);
            expect(got - asked).toBeLessThanOrEqual(2 * 3600_000);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(zones.length * 100 * 5);
  });
});

describe("offsetMinutes", () => {
  it("knows daylight saving", () => {
    expect(
      offsetMinutes("America/New_York", Date.parse("2026-01-15T12:00:00Z")),
    ).toBe(-300);
    expect(
      offsetMinutes("America/New_York", Date.parse("2026-07-15T12:00:00Z")),
    ).toBe(-240);
    expect(
      offsetMinutes("Asia/Kolkata", Date.parse("2026-07-15T12:00:00Z")),
    ).toBe(330);
  });
});
