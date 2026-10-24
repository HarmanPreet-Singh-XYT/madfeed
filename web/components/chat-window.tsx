"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  pollChatAction,
  sendChatAction,
  type ChatMessage,
} from "@/app/chat/actions";
import { FormError } from "./form-message";
import { btnPrimary, field } from "./ui";

function newKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function visitorKey(token: string): string {
  const name = `chat-visitor-${token.slice(0, 40)}`;
  try {
    const have = localStorage.getItem(name);
    if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have;
    const k = newKey();
    localStorage.setItem(name, k);
    return k;
  } catch {
    return newKey();
  }
}

/** The visitor's side of the chat: their messages and the team's replies, checked every few seconds. */
export function ChatWindow({
  token,
  origin,
  workspaceName,
  greeting,
}: {
  token: string;
  origin: string;
  workspaceName: string;
  greeting: string;
}) {
  const visitor = useRef("");
  const last = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const log = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    if (!visitor.current) return;
    const r = await pollChatAction(
      token,
      origin,
      visitor.current,
      last.current,
    );
    if (r.messages && r.messages.length > 0) {
      last.current = r.messages[r.messages.length - 1].seq;
      setMessages((cur) => [
        ...cur,
        ...r.messages!.filter((m) => !cur.some((x) => x.seq === m.seq)),
      ]);
    }
  }, [token, origin]);

  useEffect(() => {
    visitor.current = visitorKey(token);
    void poll();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 4000);
    return () => clearInterval(id);
  }, [token, poll]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">{workspaceName}</h1>
      </header>
      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        <ol className="space-y-3">
          {greeting ? (
            <li className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm">
              {greeting}
            </li>
          ) : null}
          {messages.map((m) => (
            <li
              key={m.seq}
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.fromTeam ? "bg-surface" : "ml-auto bg-accent-solid text-white"}`}
            >
              <span className="sr-only">{m.fromTeam ? "Team: " : "You: "}</span>
              {m.text}
            </li>
          ))}
        </ol>
      </div>
      <form
        method="post"
        className="space-y-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          start(async () => {
            const r = await sendChatAction(
              token,
              origin,
              visitor.current,
              t,
              name.trim(),
              email.trim(),
            );
            setError(r.error);
            if (!r.error) {
              setText("");
              await poll();
            }
          });
        }}
      >
        <details className="text-sm">
          <summary className="cursor-pointer">
            Leave your name and email so we can reach you (optional)
          </summary>
          <div className="mt-2 grid gap-2">
            <label htmlFor="chat-name" className="sr-only">
              Your name
            </label>
            <input
              id="chat-name"
              value={name}
              maxLength={100}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              className={field}
              autoComplete="name"
            />
            <label htmlFor="chat-email" className="sr-only">
              Your email
            </label>
            <input
              id="chat-email"
              type="email"
              value={email}
              maxLength={320}
              placeholder="Your email"
              onChange={(e) => setEmail(e.target.value)}
              className={field}
              autoComplete="email"
            />
          </div>
        </details>
        <FormError message={error} />
        <label htmlFor="chat-text" className="sr-only">
          Your message
        </label>
        <textarea
          id="chat-text"
          rows={2}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={field}
          placeholder="Write a message"
        />
        <button
          type="submit"
          className={btnPrimary}
          disabled={pending || !text.trim()}
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
