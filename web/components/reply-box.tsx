"use client";

import { useState, useTransition } from "react";
import {
  noteAction,
  replyAction,
} from "@/app/(app)/w/[workspaceId]/inbox/actions";
import { uploadFile, type Uploaded } from "@/lib/upload";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** A Radix Select cannot use an empty string as a value; this stands in for "nothing picked". */
const ANY = "__any";

/**
 * Writes the team's answer. It remembers which message the person had read: if something new arrives while
 * they type (a customer message, a note, or a teammate's reply) sending is held until they say they have read
 * it, so two people cannot answer the same message by accident.
 */
export function ReplyBox({
  workspaceId,
  conversationId,
  lastMessageId,
  channel,
  canned = [],
}: {
  workspaceId: string;
  conversationId: string;
  lastMessageId: string;
  channel: "chat" | "email";
  canned?: { id: string; name: string; body: string }[];
}) {
  const [seen, setSeen] = useState(lastMessageId);
  const [own, setOwn] = useState<string>(); // the message we just sent ourselves
  const [text, setText] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  // our own message is not news; anything after it is
  const changed = seen !== lastMessageId && own !== lastMessageId;
  const send = () =>
    start(async () => {
      const r = asNote
        ? await noteAction(workspaceId, conversationId, text)
        : await replyAction(
            workspaceId,
            conversationId,
            own === lastMessageId ? own : seen,
            text,
            files.map((f) => f.id),
          );
      setError(r?.error);
      if (!r?.error) {
        setText("");
        setFiles([]);
        // Our own message is not "news". If we had read everything before sending, we have read it all after.
        const mine = (r as { messageId?: string } | undefined)?.messageId;
        if (!changed && typeof mine === "string") setOwn(mine);
      }
    });
  return (
    <div className="space-y-3">
      {changed ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-destructive px-3 py-2 text-sm"
        >
          <p>
            New messages arrived while you were looking. Read them above, then
            continue.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSeen(lastMessageId);
              setOwn(undefined);
            }}
          >
            I have read them
          </Button>
        </div>
      ) : null}
      <div>
        <Label
          id="reply-label"
          htmlFor="reply"
          className="mb-1 block text-sm font-medium"
        >
          {asNote
            ? "A note for the team (the customer never sees it)"
            : channel === "email"
              ? "Your reply (sent by email)"
              : "Your reply (the visitor sees it in the chat)"}
        </Label>
        {canned.length > 0 ? (
          <div className="mb-2">
            <Label
              id="saved-reply-label"
              htmlFor="saved-reply"
              className="mb-1 block text-sm font-medium"
            >
              Put in a saved reply
            </Label>
            <Select
              value={ANY}
              onValueChange={(value) => {
                const c = canned.find((x) => x.id === value);
                if (c)
                  setText(
                    (t) => (t.trim() ? t.replace(/\s*$/, "\n\n") : "") + c.body,
                  );
              }}
            >
              <SelectTrigger
                id="saved-reply"
                className="min-h-11"
                aria-labelledby="saved-reply-label"
              >
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Choose…</SelectItem>
                {canned.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <Textarea
          id="reply"
          rows={4}
          maxLength={5000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {channel === "chat" && !asNote ? (
        <div className="space-y-2">
          {files.length > 0 ? (
            <ul className="space-y-1 text-sm" aria-label="Files to send">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <span>{f.name}</span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      setFiles((cur) => cur.filter((x) => x.id !== f.id))
                    }
                  >
                    Remove<span className="sr-only"> {f.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {files.length < 3 ? (
            <div>
              <Label
                id="reply-file-label"
                htmlFor="reply-file"
                className="mb-1 block text-sm font-medium"
              >
                {uploading
                  ? "Adding the file…"
                  : "Attach a picture, PDF or text file (5 MB at most)"}
              </Label>
              <Input
                id="reply-file"
                type="file"
                disabled={uploading}
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
                onChange={async (e) => {
                  const input = e.currentTarget;
                  const f = input.files?.[0];
                  if (!f) return;
                  setUploading(true);
                  setError(undefined);
                  const r = await uploadFile(
                    `/api/files/${workspaceId}/${conversationId}?${new URLSearchParams({ name: f.name })}`,
                    f,
                  );
                  setUploading(false);
                  input.value = "";
                  if (r.error) setError(r.error);
                  else if (r.file) setFiles((cur) => [...cur, r.file!]);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id="reply-as-note"
          checked={asNote}
          onCheckedChange={(checked) => setAsNote(checked === true)}
        />
        <Label
          id="reply-as-note-label"
          htmlFor="reply-as-note"
          className="text-sm"
        >
          This is a note for the team, not a reply
        </Label>
      </div>
      <FormError message={error} />
      <Button
        type="button"
        disabled={
          pending ||
          uploading ||
          (!text.trim() && (asNote || files.length === 0)) ||
          (changed && !asNote)
        }
        onClick={() => {
          if (!pending) send();
        }}
      >
        {pending ? "Sending…" : asNote ? "Add the note" : "Send the reply"}
      </Button>
    </div>
  );
}
