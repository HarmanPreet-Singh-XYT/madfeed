// Announced to screen readers when it appears; always plain language.
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}
