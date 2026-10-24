"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  pollChatAction,
  sendChatAction,
  type ChatMessage,
} from "@/app/chat/actions";
import { uploadFile, type Uploaded } from "@/lib/upload";
import { FormError } from "./form-message";
import { btnPrimary, field } from "./ui";

function kb(n: number): string {
  return n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1048576).toFixed(1)} MB`;
}

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
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileUrl = (id: string) =>
    `/api/chat-file?${new URLSearchParams({ t: token, v: visitor.current, o: origin, f: id })}`;
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
              {m.files && m.files.length > 0 && m.text === "(sent a file)"
                ? null
                : m.text}
              {m.files && m.files.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {m.files.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => window.location.assign(fileUrl(f.id))}
                      >
                        {f.name}
                      </button>{" "}
                      <span className="opacity-80">({kb(f.size)})</span>
                    </li>
                  ))}
                </ul>
              ) : null}
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
          if (!t && files.length === 0) return;
          start(async () => {
            const r = await sendChatAction(
              token,
              origin,
              visitor.current,
              t,
              name.trim(),
              email.trim(),
              files.map((f) => f.id),
            );
            setError(r.error);
            if (!r.error) {
              setText("");
              setFiles([]);
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
        {files.length > 0 ? (
          <ul className="space-y-1 text-sm" aria-label="Files to send">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <span>
                  {f.name} ({kb(f.size)})
                </span>
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    setFiles((cur) => cur.filter((x) => x.id !== f.id))
                  }
                >
                  Remove
                  <span className="sr-only"> {f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {files.length < 3 ? (
          <div>
            <label htmlFor="chat-file" className="mb-1 block text-sm">
              {uploading
                ? "Adding the file…"
                : "Add a picture, PDF or text file (5 MB at most)"}
            </label>
            <input
              id="chat-file"
              ref={fileInput}
              type="file"
              disabled={uploading}
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
              className="block w-full text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                setError(undefined);
                const r = await uploadFile(
                  `/api/chat-file?${new URLSearchParams({ t: token, v: visitor.current, o: origin, name: f.name })}`,
                  f,
                );
                setUploading(false);
                if (fileInput.current) fileInput.current.value = "";
                if (r.error) setError(r.error);
                else if (r.file) setFiles((cur) => [...cur, r.file!]);
              }}
            />
          </div>
        ) : null}
        <button
          type="submit"
          className={btnPrimary}
          disabled={
            pending || uploading || (!text.trim() && files.length === 0)
          }
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
