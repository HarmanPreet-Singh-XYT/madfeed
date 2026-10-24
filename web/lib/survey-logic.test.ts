import { describe, expect, it } from "vitest";
import { visibleIds, type Q } from "./survey-logic";

const qs: Q[] = [
  { id: "score" },
  { id: "why", showIf: { questionId: "score", op: "lte", number: 6 } },
  { id: "part", showIf: { questionId: "score", op: "gte", number: 9 } },
  { id: "speed", showIf: { questionId: "part", op: "eq", choice: "Speed" } },
];

describe("which questions are shown", () => {
  it("shows only what applies to the answers so far", () => {
    expect([...visibleIds(qs, {})]).toEqual(["score"]);
    expect([...visibleIds(qs, { score: { number: 3 } })]).toEqual([
      "score",
      "why",
    ]);
    expect([...visibleIds(qs, { score: { number: 8 } })]).toEqual(["score"]);
    expect([...visibleIds(qs, { score: { number: 10 } })]).toEqual([
      "score",
      "part",
    ]);
  });
  it("hides what hangs under a hidden question", () => {
    expect([
      ...visibleIds(qs, { score: { number: 8 }, part: { choice: "Speed" } }),
    ]).toEqual(["score"]);
    expect([
      ...visibleIds(qs, { score: { number: 10 }, part: { choice: "Speed" } }),
    ]).toEqual(["score", "part", "speed"]);
    expect([
      ...visibleIds(qs, { score: { number: 10 }, part: { choice: "Price" } }),
    ]).toEqual(["score", "part"]);
  });
});

describe("several conditions", () => {
  const many: Q[] = [
    { id: "score" },
    { id: "plan" },
    {
      id: "all",
      showWhen: {
        match: "all",
        conditions: [
          { questionId: "score", op: "lte", number: 6 },
          { questionId: "plan", op: "eq", choice: "Free" },
        ],
      },
    },
    {
      id: "any",
      showWhen: {
        match: "any",
        conditions: [
          { questionId: "score", op: "lte", number: 6 },
          { questionId: "plan", op: "eq", choice: "Free" },
        ],
      },
    },
  ];
  it("needs every condition for all, one for any", () => {
    const at = (score: number, plan: string) => [
      ...visibleIds(many, { score: { number: score }, plan: { choice: plan } }),
    ];
    expect(at(3, "Free")).toEqual(["score", "plan", "all", "any"]);
    expect(at(3, "Team")).toEqual(["score", "plan", "any"]);
    expect(at(9, "Free")).toEqual(["score", "plan", "any"]);
    expect(at(9, "Team")).toEqual(["score", "plan"]);
  });
  it("counts a condition on an unanswered or hidden question as not holding", () => {
    expect([...visibleIds(many, {})]).toEqual(["score", "plan"]);
    const chain: Q[] = [
      { id: "a" },
      { id: "b", showIf: { questionId: "a", op: "gte", number: 9 } },
      {
        id: "c",
        showWhen: {
          match: "any",
          conditions: [{ questionId: "b", op: "eq", choice: "x" }],
        },
      },
    ];
    expect([
      ...visibleIds(chain, { a: { number: 3 }, b: { choice: "x" } }),
    ]).toEqual(["a"]);
  });
});
