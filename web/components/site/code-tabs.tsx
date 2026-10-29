"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// Token kinds: k key, s string, p punctuation or plain, c comment.
type Tok = [kind: "k" | "s" | "p" | "c", text: string];
type Line = Tok[];

const KIND = {
  k: "text-code-key",
  s: "text-code-str",
  p: "text-on-brand",
  c: "text-on-brand/50",
} as const;

// These mirror POST /v1/ext/feedback in api/openapi.yaml: a bearer key, a JSON body with `text` (required) and the
// optional source, title, url, externalId and email, and a 202 reply.
const SNIPPETS: { id: string; label: string; lines: Line[] }[] = [
  {
    id: "curl",
    label: "curl",
    lines: [
      [["p", 'curl -X POST "$API/v1/ext/feedback" \\']],
      [["p", '  -H "Authorization: Bearer $KEY" \\']],
      [["p", '  -H "Content-Type: application/json" \\']],
      [["p", "  -d '{"]],
      [
        ["p", "    "],
        ["k", '"text"'],
        ["p", ": "],
        ["s", '"We rebuild this every Monday."'],
        ["p", ","],
      ],
      [
        ["p", "    "],
        ["k", '"source"'],
        ["p", ": "],
        ["s", '"Help desk"'],
        ["p", ","],
      ],
      [
        ["p", "    "],
        ["k", '"title"'],
        ["p", ": "],
        ["s", '"Ticket 4812: export"'],
        ["p", ","],
      ],
      [
        ["p", "    "],
        ["k", '"externalId"'],
        ["p", ": "],
        ["s", '"4812"'],
        ["p", ","],
      ],
      [
        ["p", "    "],
        ["k", '"email"'],
        ["p", ": "],
        ["s", '"priya@example.com"'],
      ],
      [["p", "  }'"]],
    ],
  },
  {
    id: "js",
    label: "JavaScript",
    lines: [
      [["p", "await fetch(`${API}/v1/ext/feedback`, {"]],
      [
        ["p", "  "],
        ["k", "method"],
        ["p", ": "],
        ["s", '"POST"'],
        ["p", ","],
      ],
      [
        ["p", "  "],
        ["k", "headers"],
        ["p", ": {"],
      ],
      [
        ["p", "    "],
        ["k", "Authorization"],
        ["p", ": "],
        ["s", "`Bearer ${KEY}`"],
        ["p", ","],
      ],
      [
        ["p", "    "],
        ["s", '"Content-Type"'],
        ["p", ": "],
        ["s", '"application/json"'],
        ["p", ","],
      ],
      [["p", "  },"]],
      [
        ["p", "  "],
        ["k", "body"],
        ["p", ": JSON.stringify({"],
      ],
      [
        ["p", "    "],
        ["k", "text"],
        ["p", ": "],
        ["s", '"We rebuild this every Monday."'],
        ["p", ","],
      ],
      [
        ["p", "    "],
        ["k", "source"],
        ["p", ": "],
        ["s", '"Help desk"'],
        ["p", ","],
      ],
      [
        ["p", "    "],
        ["k", "externalId"],
        ["p", ": "],
        ["s", '"4812"'],
        ["p", ","],
      ],
      [["p", "  }),"]],
      [["p", "});"]],
    ],
  },
  {
    id: "response",
    label: "Response",
    lines: [
      [
        [
          "c",
          "// 202 Accepted. It waits in the review queue until you accept it.",
        ],
      ],
      [
        ["p", "{ "],
        ["k", '"received"'],
        ["p", ": true }"],
      ],
      [["p", ""]],
      [["c", "// Sending the same externalId again stores it once."]],
      [
        ["p", "{ "],
        ["k", '"received"'],
        ["p", ": true, "],
        ["k", '"duplicate"'],
        ["p", ": true }"],
      ],
    ],
  },
];

const plain = (lines: Line[]) =>
  lines.map((l) => l.map((t) => t[1]).join("")).join("\n");

export function CodeTabs() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const s = SNIPPETS[active];

  async function copy() {
    try {
      await navigator.clipboard.writeText(plain(s.lines));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the text is selectable, so nothing is lost.
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-ink text-on-brand shadow-raised">
      <div className="flex items-center justify-between gap-2 border-b border-on-brand/15 px-3 py-2">
        <div role="tablist" aria-label="Code examples" className="flex gap-1">
          {SNIPPETS.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              id={`code-tab-${x.id}`}
              aria-selected={i === active}
              aria-controls="code-panel"
              onClick={() => setActive(i)}
              className={cn(
                "min-h-9 rounded-lg px-3 text-sm font-medium transition-colors",
                i === active
                  ? "bg-on-brand/15 text-on-brand"
                  : "text-on-brand/60 hover:text-on-brand",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-on-brand/70 transition-colors hover:bg-on-brand/10 hover:text-on-brand"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-4 text-code-str" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div
        id="code-panel"
        role="tabpanel"
        aria-labelledby={`code-tab-${s.id}`}
        tabIndex={0}
        className="overflow-x-auto p-5"
      >
        <pre className="font-mono text-[13px] leading-relaxed">
          <code>
            {s.lines.map((line, i) => (
              <span key={i} className="block min-h-[1.4em]">
                {line.map(([k, t], j) => (
                  <span key={j} className={KIND[k]}>
                    {t}
                  </span>
                ))}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
