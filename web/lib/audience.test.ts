import { describe as suite, expect, it } from "vitest";
import { describe, fromRule, toRule, type Draft } from "./audience";

const cond = (field: string, op: string, value: string, not = false) =>
  ({ field, op, value, not }) as Draft["conds"][number];

suite("audience form", () => {
  it("writes everyone down explicitly", () => {
    expect(toRule({ mode: "everyone", match: "all", conds: [] })).toEqual({
      all: [],
    });
  });
  it("turns conditions into the rules the server checks", () => {
    expect(
      toRule({
        mode: "match",
        match: "any",
        conds: [
          cond("account_plan", "in", "Pro, free\nteam"),
          cond("account_revenue", "gte", "100.5"),
          cond("has_account", "is", "no", true),
          cond("account_renewal", "within_days", "30"),
          cond("person_added", "before", "2026-01-31"),
        ],
      }),
    ).toEqual({
      any: [
        { field: "account_plan", op: "in", value: ["Pro", "free", "team"] },
        { field: "account_revenue", op: "gte", value: 100.5 },
        { not: { field: "has_account", op: "is", value: false } },
        { field: "account_renewal", op: "within_days", value: 30 },
        { field: "person_added", op: "before", value: "2026-01-31" },
      ],
    });
  });
  it("uses a single rule on its own", () => {
    expect(
      toRule({
        mode: "match",
        match: "all",
        conds: [cond("email_domain", "eq", " acme.com ")],
      }),
    ).toEqual({ field: "email_domain", op: "eq", value: "acme.com" });
  });
  it("refuses values the server would refuse, in plain words", () => {
    const bad = (c: ReturnType<typeof cond>) =>
      expect(() =>
        toRule({ mode: "match", match: "all", conds: [c] }),
      ).toThrow();
    bad(cond("name_contains", "contains", "  "));
    bad(cond("account_revenue", "gte", "$100"));
    bad(cond("account_revenue", "gte", "1e9"));
    bad(cond("account_revenue", "gte", "1.234"));
    bad(cond("person_added", "before", "31/01/2026"));
    bad(cond("account_renewal", "within_days", "-3"));
    bad(cond("account_renewal", "within_days", "99999"));
    bad(cond("asked_for", "is", "not-an-id"));
    bad(cond("account_plan", "in", " , "));
    expect(() => toRule({ mode: "match", match: "all", conds: [] })).toThrow(
      /at least one/,
    );
  });
  it("reads a saved audience back into the form", () => {
    const d: Draft = {
      mode: "match",
      match: "all",
      conds: [
        cond("account_plan", "in", "Pro, free"),
        cond("has_account", "is", "yes", true),
      ],
    };
    expect(fromRule(toRule(d))).toEqual(d);
    expect(fromRule({ all: [] })).toEqual({
      mode: "everyone",
      match: "all",
      conds: [],
    });
    const one = cond("email_domain", "eq", "acme.com");
    expect(
      fromRule(toRule({ mode: "match", match: "all", conds: [one] })),
    ).toEqual({ mode: "match", match: "all", conds: [one] });
  });
  it("says so when a saved audience is more than the form can show", () => {
    const nested = {
      all: [{ any: [{ field: "has_account", op: "is", value: true }] }],
    } as never;
    expect(fromRule(nested)).toBeNull();
    expect(fromRule(undefined)).toBeNull();
  });
  it("describes an audience in words", () => {
    expect(
      describe({
        mode: "match",
        match: "any",
        conds: [
          cond("account_plan", "eq", "Pro"),
          cond("has_account", "is", "no", true),
        ],
      }),
    ).toBe("account plan is Pro or not: belongs to an account is no");
    expect(describe({ mode: "everyone", match: "all", conds: [] })).toMatch(
      /Everyone/,
    );
  });
});
