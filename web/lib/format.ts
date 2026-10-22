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
