export type ShowIf = {
  questionId: string;
  op: "eq" | "ne" | "lte" | "gte";
  number?: number;
  choice?: string;
};

export type Q = { id: string; showIf?: ShowIf };
export type Value = { number?: number; choice?: string; text?: string };

function holds(c: ShowIf, v: Value | undefined): boolean {
  if (!v) return false;
  if (c.number !== undefined && v.number !== undefined) {
    switch (c.op) {
      case "eq":
        return v.number === c.number;
      case "ne":
        return v.number !== c.number;
      case "lte":
        return v.number <= c.number;
      case "gte":
        return v.number >= c.number;
    }
  }
  if (c.choice !== undefined && v.choice !== undefined) {
    if (c.op === "eq") return v.choice === c.choice;
    if (c.op === "ne") return v.choice !== c.choice;
  }
  return false;
}

/** Which questions are shown, given the answers so far. A question under a hidden question is hidden too. */
export function visibleIds(
  questions: Q[],
  values: Record<string, Value>,
): Set<string> {
  const shown = new Set<string>();
  for (const q of questions) {
    if (!q.showIf) {
      shown.add(q.id);
      continue;
    }
    if (
      shown.has(q.showIf.questionId) &&
      holds(q.showIf, values[q.showIf.questionId])
    )
      shown.add(q.id);
  }
  return shown;
}
