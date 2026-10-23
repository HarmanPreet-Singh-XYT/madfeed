// Revenue arrives as decimal text ("100000.00") so money is never a float on
// the wire. The currency is not recorded, so values are shown as plain numbers.

/** "100000.00" -> "100,000"; "5000.50" -> "5,000.50"; empty or invalid -> "0". */
export function formatValue(decimal: string | undefined | null): string {
  if (!decimal || !/^-?\d+(\.\d+)?$/.test(decimal)) return "0";
  const [whole, frac] = decimal.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents =
    frac && /[1-9]/.test(frac) ? "." + frac.padEnd(2, "0").slice(0, 2) : "";
  return withCommas + cents;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 people · 2 accounts · 100,000" for a request's impact. */
export function impactLine(i: {
  peopleCount: number;
  accountCount: number;
  totalValue: string;
  accountsWithValue: number;
}): string {
  const parts = [
    plural(i.peopleCount, "person", "people"),
    plural(i.accountCount, "account"),
  ];
  if (i.accountsWithValue > 0)
    parts.push(`${formatValue(i.totalValue)} revenue`);
  return parts.join(" · ");
}

export function pct(rate: number | undefined | null): string {
  return rate === undefined || rate === null
    ? "n/a"
    : `${Math.round(rate * 100)}%`;
}

/** 75000 -> "1:15", 3_725_000 -> "1:02:05". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 1536 -> "1.5 KB", 5_300_000 -> "5.1 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
