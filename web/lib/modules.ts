// The tools the workspace is made of, and the pages each one owns. The navigation is drawn from this list, so
// adding a tool or a page means editing it here and nowhere else. A page with no `module` belongs to the core
// (people, quality, settings) and is always shown. Keep the ids in step with api/internal/modules.

export type ModuleId = "feedback" | "research" | "surveys" | "support";

export type NavBadge = "review" | "messages" | "inbox";

export type NavItem = {
  /** Path under /w/{workspaceId}, without a leading slash. */
  path: string;
  label: string;
  module?: ModuleId;
  badge?: NavBadge;
};

export const MODULE_NAMES: Record<ModuleId, string> = {
  feedback: "Feedback",
  research: "Research",
  surveys: "Surveys",
  support: "Support",
};

// Order here is the order in the navigation bar.
export const NAV: NavItem[] = [
  { path: "inbox", label: "Inbox", module: "support", badge: "inbox" },
  { path: "add", label: "Add feedback", module: "feedback" },
  { path: "review", label: "Review", module: "feedback", badge: "review" },
  { path: "requests", label: "Requests", module: "feedback" },
  { path: "recordings", label: "Recordings", module: "research" },
  { path: "research", label: "Research", module: "research" },
  { path: "quotes", label: "Quotes", module: "research" },
  { path: "findings", label: "Findings", module: "research" },
  { path: "ask", label: "Ask", module: "research" },
  { path: "roadmap", label: "Roadmap", module: "feedback" },
  {
    path: "outreach",
    label: "Messages",
    module: "feedback",
    badge: "messages",
  },
  { path: "releases", label: "Release notes", module: "feedback" },
  { path: "surveys", label: "Surveys", module: "surveys" },
  { path: "activity", label: "Activity" },
  { path: "people", label: "People" },
  { path: "quality", label: "Quality" },
  { path: "settings", label: "Settings" },
];

/** The pages to show when the plan switches on the given tools. Core pages are always included. */
export function visibleNav(enabled: readonly string[]): NavItem[] {
  return NAV.filter((n) => !n.module || enabled.includes(n.module));
}
