import type { components } from "@/lib/api/schema.gen";

export type Rule = components["schemas"]["AudienceRule"];
type FieldId = NonNullable<Rule["field"]>;
type OpId = NonNullable<Rule["op"]>;
type Input = "text" | "list" | "number" | "date" | "days" | "bool" | "request";

export const FIELDS: {
  id: FieldId;
  label: string;
  ops: { id: OpId; label: string; input: Input }[];
}[] = [
  {
    id: "name_contains",
    label: "Name",
    ops: [{ id: "contains", label: "contains", input: "text" }],
  },
  {
    id: "email_domain",
    label: "Email domain",
    ops: [
      { id: "eq", label: "is", input: "text" },
      { id: "in", label: "is one of", input: "list" },
    ],
  },
  {
    id: "person_added",
    label: "Added to your people",
    ops: [
      { id: "before", label: "before", input: "date" },
      { id: "after", label: "after", input: "date" },
    ],
  },
  {
    id: "has_account",
    label: "Belongs to an account",
    ops: [{ id: "is", label: "is", input: "bool" }],
  },
  {
    id: "account_plan",
    label: "Account plan",
    ops: [
      { id: "eq", label: "is", input: "text" },
      { id: "in", label: "is one of", input: "list" },
    ],
  },
  {
    id: "account_domain",
    label: "Account domain",
    ops: [{ id: "eq", label: "is", input: "text" }],
  },
  {
    id: "account_revenue",
    label: "Account revenue",
    ops: [
      { id: "gte", label: "is at least", input: "number" },
      { id: "lte", label: "is at most", input: "number" },
    ],
  },
  {
    id: "account_renewal",
    label: "Account renewal date",
    ops: [
      { id: "before", label: "is before", input: "date" },
      { id: "after", label: "is after", input: "date" },
      { id: "within_days", label: "is within the next (days)", input: "days" },
    ],
  },
  {
    id: "asked_for",
    label: "Asked for the request",
    ops: [{ id: "is", label: "is", input: "request" }],
  },
];

export type Cond = {
  field: FieldId;
  op: OpId;
  value: string; // what the person typed or chose
  not: boolean; // "does not match"
};

export type Draft = {
  mode: "everyone" | "match";
  match: "all" | "any";
  conds: Cond[];
};

export const inputOf = (field: string, op: string): Input =>
  FIELDS.find((f) => f.id === field)?.ops.find((o) => o.id === op)?.input ??
  "text";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One condition as a rule. Throws an Error whose message is safe to show. */
function leaf(c: Cond): Rule {
  const label = FIELDS.find((f) => f.id === c.field)?.label ?? "A rule";
  const v = c.value.trim();
  let value: unknown;
  switch (inputOf(c.field, c.op)) {
    case "text":
      if (!v) throw new Error(`Fill in a value for “${label}”.`);
      value = v;
      break;
    case "list": {
      const items = v
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (items.length === 0 || items.length > 50)
        throw new Error(`List between 1 and 50 values for “${label}”.`);
      value = items;
      break;
    }
    case "number":
      if (!MONEY.test(v))
        throw new Error(
          `“${label}” needs a plain number, up to two decimals, with no currency sign.`,
        );
      value = Number(v);
      break;
    case "date":
      if (!DATE.test(v))
        throw new Error(`“${label}” needs a date written like 2026-12-31.`);
      value = v;
      break;
    case "days": {
      const n = Number(v);
      if (!/^\d+$/.test(v) || n > 3650)
        throw new Error(`“${label}” needs a whole number of days up to 3650.`);
      value = n;
      break;
    }
    case "bool":
      value = v !== "no";
      break;
    case "request":
      if (!UUID.test(v)) throw new Error("Choose a request.");
      value = v;
      break;
  }
  const r: Rule = { field: c.field, op: c.op, value };
  return c.not ? { not: r } : r;
}

export function toRule(d: Draft): Rule {
  if (d.mode === "everyone") return { all: [] };
  if (d.conds.length === 0)
    throw new Error("Add at least one condition, or choose everyone.");
  if (d.conds.length > 25) throw new Error("That is too many conditions.");
  const leaves = d.conds.map(leaf);
  if (leaves.length === 1) return leaves[0];
  return d.match === "any" ? { any: leaves } : { all: leaves };
}

function toCond(r: Rule): Cond | null {
  let not = false;
  let x: Rule | undefined = r;
  if (x.not) {
    not = true;
    x = x.not;
  }
  if (!x || !x.field || !x.op || x.all || x.any || x.not) return null;
  const input = inputOf(x.field, x.op);
  const raw = x.value;
  let value = "";
  if (input === "list") value = Array.isArray(raw) ? raw.join(", ") : "";
  else if (input === "bool") value = raw === false ? "no" : "yes";
  else value = raw === undefined || raw === null ? "" : String(raw);
  return { field: x.field, op: x.op, value, not };
}

/** A saved audience back into the form, or null if it uses more than the form can show. */
export function fromRule(r: Rule | undefined): Draft | null {
  if (!r) return null;
  if (r.all && r.all.length === 0 && !r.any && !r.not && !r.field)
    return { mode: "everyone", match: "all", conds: [] };
  const group = r.all ?? r.any;
  if (group && !r.not && !r.field && !(r.all && r.any)) {
    const conds = group.map(toCond);
    if (conds.some((c) => c === null)) return null;
    return {
      mode: "match",
      match: r.all ? "all" : "any",
      conds: conds as Cond[],
    };
  }
  const single = toCond(r);
  return single ? { mode: "match", match: "all", conds: [single] } : null;
}

/** The audience in words, for the survey page. */
export function describe(
  d: Draft,
  requests: { id: string; title: string }[] = [],
): string {
  if (d.mode === "everyone") return "Everyone with an email address";
  const parts = d.conds.map((c) => {
    const f = FIELDS.find((x) => x.id === c.field);
    const o = f?.ops.find((x) => x.id === c.op);
    let v = c.value;
    if (c.field === "asked_for")
      v = requests.find((r) => r.id === c.value)?.title ?? "a request";
    if (inputOf(c.field, c.op) === "bool") v = c.value === "no" ? "no" : "yes";
    return `${c.not ? "not: " : ""}${f?.label.toLowerCase()} ${o?.label} ${v}`;
  });
  return parts.join(d.match === "any" ? " or " : " and ");
}
