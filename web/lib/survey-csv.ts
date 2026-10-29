import type { components } from "@/lib/api/schema.gen";

type Question = components["schemas"]["SurveyQuestion"];
type Results = components["schemas"]["SurveyResults"];

const cell = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const row = (values: string[]) => values.map(cell).join(",");

/**
 * The answers as a spreadsheet: one row per figure (average, option count) and
 * one row per written answer. Long shape, because questions differ; a person
 * can pivot it in any spreadsheet.
 */
export function buildSurveyCsv(
  questions: Question[],
  results: Results,
): string {
  const lines = [
    row(["Question", "Kind", "Answer", "Count", "Person", "When"]),
  ];
  for (const q of questions) {
    if (q.kind === "text") {
      for (const t of results.text.filter((x) => x.questionId === q.id)) {
        lines.push(
          row([q.prompt, "text", t.text, "", t.person ?? "", t.at ?? ""]),
        );
      }
      continue;
    }
    if (q.kind === "choice") {
      const rows = results.choices.filter((x) => x.questionId === q.id);
      for (const option of q.options) {
        const n = rows.find((x) => x.choice === option)?.count ?? 0;
        lines.push(row([q.prompt, "choice", option, String(n), "", ""]));
      }
      continue;
    }
    const n = results.numeric.find((x) => x.questionId === q.id);
    if (!n) continue;
    lines.push(
      row([q.prompt, q.kind, "Average", n.average.toFixed(1), "", ""]),
    );
    if (q.kind === "nps") {
      lines.push(
        row([q.prompt, "nps", "Promoters (9-10)", String(n.promoters), "", ""]),
        row([q.prompt, "nps", "Passive (7-8)", String(n.passives), "", ""]),
        row([
          q.prompt,
          "nps",
          "Detractors (0-6)",
          String(n.detractors),
          "",
          "",
        ]),
        row([q.prompt, "nps", "Score", String(n.score), "", ""]),
      );
    }
  }
  return lines.join("\n") + "\n";
}

/** "Q3 check-in" -> "q3-check-in.csv"; never empty. */
export function surveyCsvName(title: string): string {
  const safe = title
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `${safe || "survey"}-answers.csv`;
}
