export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-muted-foreground">
      {label}
    </p>
  );
}
