// The pure parts of the command palette (⌘K): which searches to run, how to mark the matched words, and the short
// list of places a person went recently. The palette itself is components/app/command-palette.tsx.

/** Which kinds of thing to look for, from the navigation paths this person can see. */
export function searchScopes(available: readonly string[]) {
  const has = (p: string) => available.includes(p);
  return {
    quotes: has("quotes"),
    requests: has("requests"),
    findings: has("findings"),
    // People and companies are core pages every workspace has.
    people: true,
    companies: true,
  };
}

/** Fired on the window to open the palette from somewhere other than the top bar (the phone header has no top bar). */
export const OPEN_PALETTE_EVENT = "palette:open";

export type Part = { text: string; match: boolean };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits `text` into pieces, marking the ones that are one of the searched words (case-insensitive). The words are
 * escaped, so punctuation a person types is matched as plain text and never read as a pattern. Joining the pieces
 * always gives back the original text.
 */
export function highlightParts(text: string, term: string): Part[] {
  const words = [...new Set(term.toLowerCase().split(/\s+/).filter((w) => w.length >= 2))];
  if (words.length === 0) return [{ text, match: false }];
  // Longest first, so "export" wins over "port" where both start at the same place.
  const re = new RegExp(`(${words.sort((a, b) => b.length - a.length).map(escape).join("|")})`, "gi");
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), match: false });
    out.push({ text: m[0], match: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.length > 0 ? out : [{ text, match: false }];
}

export type Recent = { href: string; label: string; kind: "page" | "request" | "person" | "company" | "finding" | "quote" };

export const MAX_RECENTS = 5;
const KINDS = new Set(["page", "request", "person", "company", "finding", "quote"]);
const key = (workspaceId: string) => `palette:v1:${workspaceId}`;

/**
 * The places this person opened from the palette, newest first. Kept in this browser only, per workspace. Anything
 * in storage is treated as untrusted: a link that does not stay inside the workspace, or an entry of the wrong
 * shape, is dropped rather than followed.
 */
export function readRecents(workspaceId: string): Recent[] {
  try {
    const raw = window.localStorage.getItem(key(workspaceId));
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (r): r is Recent =>
          typeof r === "object" &&
          r !== null &&
          typeof r.href === "string" &&
          r.href.startsWith(`/w/${workspaceId}/`) &&
          typeof r.label === "string" &&
          r.label.length > 0 &&
          r.label.length <= 200 &&
          KINDS.has(r.kind),
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function addRecent(workspaceId: string, item: Recent) {
  try {
    const next = [item, ...readRecents(workspaceId).filter((r) => r.href !== item.href)].slice(0, MAX_RECENTS);
    window.localStorage.setItem(key(workspaceId), JSON.stringify(next));
  } catch {
    /* blocked: the list just stays empty */
  }
}

/** True when a key press belongs to a field, a menu or a dialog rather than to the page. */
export function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    Boolean(
      target.closest(
        "input, textarea, select, [role=combobox], [role=listbox], [role=menu], [role=dialog]",
      ),
    )
  );
}
