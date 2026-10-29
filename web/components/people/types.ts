import type { components } from "@/lib/api/schema.gen";

export type PersonRow = components["schemas"]["Person"];
export type AccountRow = components["schemas"]["Account"];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** A stable, quiet colour per person, so the same initials look the same every time. */
export function avatarTint(name: string) {
  const tints = [
    "bg-tint-blue text-foreground",
    "bg-tint-teal text-foreground",
    "bg-tint-amber text-foreground",
    "bg-tint-coral text-foreground",
    "bg-tint-sky text-foreground",
  ];
  let n = 0;
  for (const ch of name) n = (n + ch.charCodeAt(0)) % tints.length;
  return tints[n];
}

export const SOURCE_LABEL: Record<string, string> = {
  paste: "Pasted",
  recording: "Recording",
  form: "Website form",
  api: "API",
  chat: "Chat",
  survey: "Survey",
};
