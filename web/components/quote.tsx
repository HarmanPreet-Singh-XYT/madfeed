import { spanContext } from "@/lib/text";

/**
 * A quote shown in its surroundings with the exact words highlighted, so a
 * person can verify the suggestion against what the customer actually said.
 * If the span does not fit the text it is shown as unavailable, never as
 * different words.
 */
export function Quote({
  text,
  start,
  end,
  quote,
}: {
  text?: string;
  start: number;
  end: number;
  quote: string;
}) {
  const ctx = text ? spanContext(text, start, end) : null;
  if (!ctx || ctx.quote !== quote) {
    return (
      <blockquote className="border-l-4 border-border pl-3">
        <p>“{quote}”</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We couldn&apos;t show the surrounding text.
        </p>
      </blockquote>
    );
  }
  return (
    <blockquote className="border-l-4 border-border pl-3 leading-7">
      <span className="text-muted-foreground">
        {ctx.cutStart ? "… " : ""}
        {ctx.before}
      </span>
      <mark>{ctx.quote}</mark>
      <span className="text-muted-foreground">
        {ctx.after}
        {ctx.cutEnd ? " …" : ""}
      </span>
    </blockquote>
  );
}
