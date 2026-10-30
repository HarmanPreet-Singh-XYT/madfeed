import Link from "next/link";
import { LocalTime } from "./local-time";
import { link } from "./ui";

type Person = {
  id: string;
  name: string;
  email?: string;
  accountName?: string;
  quoteCount?: number;
  lastHeardAt?: string;
};

type TheirConversation = {
  id: string;
  subject: string;
  preview: string;
  lastMessageAt: string;
};

/** Who is on the other end: enough to answer without leaving the thread. */
export function PersonContext({
  workspaceId,
  person,
  conversations,
  fallback,
}: {
  workspaceId: string;
  person?: Person;
  conversations: TheirConversation[];
  /** What to say when the conversation is not linked to a person. */
  fallback: string;
}) {
  if (!person) {
    return <p className="text-sm text-muted-foreground">{fallback}</p>;
  }
  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="font-medium">
          <Link href={`/w/${workspaceId}/people/${person.id}`} className={link}>
            {person.name || "A person"}
          </Link>
        </p>
        {person.email ? (
          <p className="text-sm text-muted-foreground">{person.email}</p>
        ) : null}
        {person.accountName ? (
          <p className="text-sm">{person.accountName}</p>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Quotes</dt>
          <dd className="font-medium tabular-nums">{person.quoteCount ?? 0}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last heard</dt>
          <dd className="font-medium">
            {person.lastHeardAt ? (
              <LocalTime iso={person.lastHeardAt} relative short />
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      {conversations.length > 0 ? (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Other conversations
          </p>
          <ul className="mt-1 space-y-1">
            {conversations.slice(0, 3).map((o) => (
              <li key={o.id} className="text-sm">
                <Link
                  href={`/w/${workspaceId}/inbox/${o.id}`}
                  className={`${link} line-clamp-1`}
                >
                  {o.subject || o.preview || "A conversation"}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · <LocalTime iso={o.lastMessageAt} relative short />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
