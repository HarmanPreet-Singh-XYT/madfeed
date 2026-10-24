export type ShowIf = {
  questionId: string;
  op: "eq" | "ne" | "lte" | "gte";
  number?: number;
  choice?: string;
};

/** Show a question when all (or any) of its conditions hold. */
export type ShowWhen = { match: "all" | "any"; conditions: ShowIf[] };

export type Q = { id: string; showIf?: ShowIf; showWhen?: ShowWhen };
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

/** Which questions are shown, given the answers so far. A condition holds only if the question it looks at is shown. */
export function visibleIds(
  questions: Q[],
  values: Record<string, Value>,
): Set<string> {
  const shown = new Set<string>();
  for (const q of questions) {
    const w: ShowWhen | undefined =
      q.showWhen ??
      (q.showIf ? { match: "all", conditions: [q.showIf] } : undefined);
    if (!w || w.conditions.length === 0) {
      shown.add(q.id);
      continue;
    }
    const holding = (c: ShowIf) =>
      shown.has(c.questionId) && holds(c, values[c.questionId]);
    if (
      w.match === "any"
        ? w.conditions.some(holding)
        : w.conditions.every(holding)
    )
      shown.add(q.id);
  }
  return shown;
}
