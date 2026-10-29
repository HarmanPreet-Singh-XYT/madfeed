import { describe, expect, it } from "vitest";
import { buildSurveyCsv, surveyCsvName } from "./survey-csv";
import type { components } from "@/lib/api/schema.gen";

type Question = components["schemas"]["SurveyQuestion"];
type Results = components["schemas"]["SurveyResults"];

const q = (
  id: string,
  kind: Question["kind"],
  prompt: string,
  options: string[] = [],
): Question => ({ id, kind, prompt, required: false, options });

const empty: Results = {
  complete: 0,
  partial: 0,
  numeric: [],
  choices: [],
  text: [],
};

describe("buildSurveyCsv", () => {
  it("writes one row per option, including options nobody picked", () => {
    const csv = buildSurveyCsv(
      [q("q1", "choice", "Which plan?", ["Free", "Team"])],
      {
        ...empty,
        complete: 2,
        choices: [
          { questionId: "q1", choice: "Free", count: 2 },
          { questionId: "q1", choice: "Team", count: 0 },
        ],
      },
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Question,Kind,Answer,Count,Person,When");
    expect(lines[1]).toBe("Which plan?,choice,Free,2,,");
    expect(lines[2]).toBe("Which plan?,choice,Team,0,,");
  });

  it("writes the NPS average, groups and score", () => {
    const csv = buildSurveyCsv([q("q1", "nps", "Recommend us?")], {
      ...empty,
      complete: 4,
      numeric: [
        {
          questionId: "q1",
          kind: "nps",
          answers: 4,
          average: 7.25,
          promoters: 2,
          passives: 1,
          detractors: 1,
          score: 25,
        },
      ],
    });
    expect(csv).toContain("Recommend us?,nps,Average,7.3,,");
    expect(csv).toContain("Recommend us?,nps,Promoters (9-10),2,,");
    expect(csv).toContain("Recommend us?,nps,Detractors (0-6),1,,");
    expect(csv).toContain("Recommend us?,nps,Score,25,,");
  });

  it("writes each written answer with its person", () => {
    const csv = buildSurveyCsv([q("q1", "text", "Anything else?")], {
      ...empty,
      complete: 1,
      text: [
        {
          questionId: "q1",
          text: 'It\'s "fine", thanks',
          person: "Dana",
          at: "2026-10-01T10:00:00Z",
        },
      ],
    });
    expect(csv).toContain(
      'Anything else?,text,"It\'s ""fine"", thanks",,Dana,2026-10-01T10:00:00Z',
    );
  });

  it("keeps commas and newlines inside their cell", () => {
    const csv = buildSurveyCsv([q("q1", "text", "Why?")], {
      ...empty,
      text: [{ questionId: "q1", text: "one, two\nthree", person: "" }],
    });
    expect(csv).toContain('"one, two\nthree"');
  });
});

describe("surveyCsvName", () => {
  it("turns a title into a file name", () => {
    expect(surveyCsvName("Q3 check-in: pricing")).toBe(
      "q3-check-in-pricing-answers.csv",
    );
    expect(surveyCsvName("   ")).toBe("survey-answers.csv");
  });
});
