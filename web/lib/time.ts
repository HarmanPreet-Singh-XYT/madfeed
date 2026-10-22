// Scheduling turns what a person typed ("2026-03-08 02:30" in New York) into
// one absolute moment. Daylight saving makes that tricky: some local times do
// not exist (clocks jump forward) and some happen twice (clocks go back).
//   - A time that does not exist moves forward to the first real time after the gap.
//   - A time that happens twice means the earlier of the two.

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

/** Minutes the zone is ahead of UTC at this instant (e.g. New York in summer: -240). */
export function offsetMinutes(timeZone: string, instantMs: number): number {
  const parts = formatter(timeZone).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The absolute moment for a local date and time ("YYYY-MM-DDTHH:mm") in a zone, or null if it is not a valid date. */
export function localToInstant(local: string, timeZone: string): Date | null {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(asIfUtc);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  )
    return null;

  // The offsets in force a day before and a day after: any transition near this time is between them.
  const before = offsetMinutes(timeZone, asIfUtc - 36 * 3600_000);
  const after = offsetMinutes(timeZone, asIfUtc + 36 * 3600_000);
  const candidates = [...new Set([before, after])].map(
    (off) => asIfUtc - off * 60_000,
  );
  // A candidate is real if the zone, at that instant, shows exactly the local time asked for.
  const real = candidates
    .filter((c) => offsetMinutes(timeZone, c) * 60_000 === asIfUtc - c)
    .sort((a, b) => a - b);
  if (real.length > 0) return new Date(real[0]); // two real ones: the earlier
  // In the gap: use the offset from before the jump, which lands just after it.
  return new Date(asIfUtc - before * 60_000);
}

/** "YYYY-MM-DDTHH:mm" as shown on the wall clock in a zone at an instant. */
export function instantToLocal(instant: Date, timeZone: string): string {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
