import type { components } from "@/lib/api/schema.gen";
import { PublicSignalButton } from "./public-signal-button";
import { LocalTime } from "./local-time";
import { link } from "./ui";
import { Card } from "@/components/ui/card";

type Signal = components["schemas"]["PublicSignal"];

const VERDICTS: Record<string, { label: string; tone: string }> = {
  others_ship_it: { label: "Others ship it", tone: "bg-muted text-foreground" },
  prior_art: { label: "Prior art", tone: "bg-muted text-foreground" },
  no_signal: { label: "Nothing found", tone: "bg-background text-muted-foreground" },
};

/**
 * What the public web says about this request. Deliberately kept apart from
 * evidence: a documentation page or a forum thread is not a customer saying
 * something, and the two must never be added up together.
 */
export function PublicSources({
  signal,
  workspaceId,
  requestId,
  canEdit,
}: {
  signal: Signal | undefined;
  workspaceId: string;
  requestId: string;
  canEdit: boolean;
}) {
  return (
    <Card asChild className="[--card-spacing:0px] space-y-3 p-5">
      <section aria-labelledby="public-sources-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="public-sources-h" className="text-lg font-medium">
            Who else ships it
          </h2>
          <span className="text-xs text-muted-foreground">
            Not customer evidence
          </span>
        </div>

        {!signal ? (
          <>
            <p className="text-muted-foreground">
              Looks for other products that already ship this, and at how they
              built it — so the team can see what exists before it builds.
            </p>
            {canEdit ? (
              <PublicSignalButton
                workspaceId={workspaceId}
                requestId={requestId}
                label="Check public sources"
              />
            ) : null}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${(VERDICTS[signal.verdict] ?? VERDICTS.no_signal).tone}`}
              >
                {(VERDICTS[signal.verdict] ?? VERDICTS.no_signal).label}
              </span>
              <span className="text-xs text-muted-foreground">
                checked <LocalTime iso={signal.checkedAt} />
              </span>
            </div>

            <p>{signal.summary}</p>

            {signal.sources.length > 0 ? (
              <ul className="space-y-2">
                {signal.sources.map((s) => (
                  <li key={s.url}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={link}
                    >
                      {s.title}
                    </a>
                    <p className="text-sm text-muted-foreground">{s.snippet}</p>
                  </li>
                ))}
              </ul>
            ) : null}

            {signal.patterns.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">How others do it</h3>
                <ul className="space-y-2">
                  {signal.patterns.map((p) => (
                    <li key={p.url}>
                      <p>{p.approach}</p>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={link}
                      >
                        {p.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {canEdit ? (
              <PublicSignalButton
                workspaceId={workspaceId}
                requestId={requestId}
                label="Check again"
              />
            ) : null}
          </>
        )}
      </section>
    </Card>
  );
}
