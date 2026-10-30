/** Shown while a screen's data loads. The motion is decoration: the label is announced, and nothing moves for people
 *  who ask for reduced motion (the global rule in globals.css). */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col gap-6 py-8">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex items-center gap-4">
        <div className="loader-mark relative size-12 shrink-0 rounded-2xl bg-gradient-to-br from-brand-1 via-brand-2 to-brand-3 shadow-card">
          <span className="loader-orbit absolute inset-0">
            <span className="absolute top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-on-brand" />
          </span>
        </div>
        <div className="flex-1 space-y-2">
          <div className="loader-line h-3 w-2/5 rounded-full" />
          <div className="loader-line h-3 w-1/4 rounded-full [animation-delay:150ms]" />
        </div>
      </div>
      <div aria-hidden className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-card">
        {["w-11/12", "w-full", "w-3/4", "w-5/6"].map((w, i) => (
          <div
            key={w}
            className={`loader-line h-3 rounded-full ${w}`}
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
