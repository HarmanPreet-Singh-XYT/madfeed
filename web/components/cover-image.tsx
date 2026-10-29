"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-message";

const MAX = 2 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg"];

/**
 * The note's cover picture: shown when there is one, a drop target when there is not. The browser sends
 * the file to our own route, which hands it to the API to be checked, stripped of hidden metadata and
 * stored; nothing about the file is trusted here beyond its size and its declared type.
 */
export function CoverImage({
  workspaceId,
  noteId,
  updatedAt,
  canEdit,
}: {
  workspaceId: string;
  noteId: string;
  updatedAt?: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const url = `/api/covers/${workspaceId}/${noteId}?v=${encodeURIComponent(updatedAt ?? "")}`;

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    if (!TYPES.includes(file.type)) {
      setError("Choose a PNG or JPEG picture.");
      return;
    }
    if (file.size > MAX) {
      setError("That picture is larger than 2 MB.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => undefined)) as
          | { error?: { message?: string } }
          | undefined;
        setError(
          body?.error?.message ?? "The picture could not be added. Try again.",
        );
        return;
      }
      router.refresh();
    } catch {
      setError("The picture could not be added. Check your connection.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setError(undefined);
    setBusy(true);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        setError("The picture could not be removed. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("The picture could not be removed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg"
      className="sr-only"
      aria-label="Cover picture"
      onChange={(e) => upload(e.target.files?.[0])}
    />
  );

  if (updatedAt) {
    return (
      <figure className="space-y-2">
        {/* A cover is decoration: the title beside it says what the note is about. */}
        <img
          src={url}
          alt=""
          className="aspect-[2/1] w-full rounded-lg border border-border object-cover"
        />
        {canEdit ? (
          <figcaption className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              Replace picture
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={remove}
            >
              Remove
            </Button>
            <span className="text-xs text-muted-foreground">
              PNG or JPEG, 2 MB at most.
            </span>
            {picker}
          </figcaption>
        ) : null}
        <FormError message={error} />
      </figure>
    );
  }

  if (!canEdit) return null;

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files?.[0]);
        }}
        className={`flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
          dragging
            ? "border-ring bg-secondary"
            : "border-input/60 bg-muted/20 hover:bg-muted/40"
        }`}
      >
        <ImagePlus aria-hidden="true" className="size-5 text-muted-foreground" />
        <span className="text-sm font-medium">
          {busy ? "Adding the picture…" : "Add a cover picture"}
        </span>
        <span className="text-xs text-muted-foreground">
          PNG or JPEG, 2 MB at most. Drop it here, or click to choose.
        </span>
      </button>
      {picker}
      <FormError message={error} />
    </div>
  );
}
