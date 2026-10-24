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
