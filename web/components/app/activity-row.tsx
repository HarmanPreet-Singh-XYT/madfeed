import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  FileText,
  Inbox,
  Lightbulb,
  Quote,
  Send,
  Users,
} from "lucide-react";
import { LocalTime } from "@/components/local-time";

export type ActivityItem = {
  kind: string;
  id: string;
  title: string;
  detail: string;
  at: string;
  parentId?: string | null;
  parentKind?: string | null;
};

export function activityHref(base: string, a: ActivityItem) {
  switch (a.kind) {
    case "quote":
      return a.parentKind === "source"
        ? `${base}/sources/${a.parentId}`
        : `${base}/requests/${a.parentId ?? a.id}`;
    case "message":
      return `${base}/outreach/${a.parentId}`;
    case "conversation":
      return `${base}/inbox/${a.id}`;
    case "finding":
      return `${base}/findings/${a.id}`;
    case "release":
      return `${base}/releases/${a.id}`;
    case "survey":
      return `${base}/surveys/${a.id}`;
    default:
      return `${base}/requests/${a.id}`;
  }
}

function activityMeta(kind: string) {
  switch (kind) {
    case "quote":
      return {
        label: "Quote",
        icon: Quote,
        tint: "bg-tint-amber text-hue-amber",
      };
    case "message":
      return {
        label: "Message sent",
        icon: Send,
        tint: "bg-tint-blue text-hue-blue",
      };
    case "conversation":
      return {
        label: "Support",
        icon: Inbox,
        tint: "bg-tint-teal text-hue-teal",
      };
    case "finding":
      return {
        label: "Findings",
        icon: FileText,
        tint: "bg-tint-coral text-hue-coral",
      };
    case "release":
      return {
        label: "Release",
        icon: BookOpen,
        tint: "bg-tint-teal text-hue-teal",
      };
    case "survey":
      return {
        label: "Survey",
        icon: Users,
        tint: "bg-tint-sky text-hue-sky",
      };
    default:
      return {
        label: "Request",
        icon: Lightbulb,
        tint: "bg-tint-blue text-hue-blue",
      };
  }
}

export function ActivityRow({
  base,
  item,
}: {
  base: string;
  item: ActivityItem;
}) {
  const meta = activityMeta(item.kind);
  const detail =
    item.kind === "conversation" && item.detail
      ? item.detail.charAt(0).toUpperCase() + item.detail.slice(1)
      : item.detail;
  return (
    <Link
      href={activityHref(base, item)}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
    >
      <span
        aria-hidden="true"
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
      >
        <meta.icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta.label}
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        <LocalTime iso={item.at} relative short />
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}
