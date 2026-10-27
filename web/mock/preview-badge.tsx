// Stands in for components/preview-badge.tsx in a preview build.
export function PreviewBadge() {
  return (
    <aside
      aria-label="Preview build"
      className="pointer-events-none fixed bottom-2 right-2 z-50 rounded-full border border-border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm"
    >
      Preview · sample data
    </aside>
  );
}
