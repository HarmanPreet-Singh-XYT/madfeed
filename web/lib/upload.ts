export type Uploaded = { id: string; name: string; size: number };

const MAX = 5 * 1024 * 1024;

/** Sends one file to one of our own upload routes and says plainly what went wrong, if anything. */
export async function uploadFile(
  url: string,
  file: File,
): Promise<{ error?: string; file?: Uploaded }> {
  if (file.size === 0) return { error: "That file is empty." };
  if (file.size > MAX) return { error: "That file is larger than 5 MB." };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const body = (await res.json().catch(() => undefined)) as
      (Uploaded & { error?: { message?: string } }) | undefined;
    if (res.ok && body?.id) return { file: body };
    return {
      error:
        body?.error?.message ??
        "The file could not be added. Check your connection and try again.",
    };
  } catch {
    return {
      error:
        "The file could not be added. Check your connection and try again.",
    };
  }
}
