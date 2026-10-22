/** Plain text with blank lines between paragraphs. Rendered as text, never as HTML. */
export function Paragraphs({ text }: { text: string }) {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className="space-y-4 leading-7">
      {parts.map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}
