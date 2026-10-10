"use client";

import * as React from "react";
import { CreatorAvatar } from "./primitives";

const SIZE = 256;

/** Center-crops and resizes an image file to 256×256, re-encoded (strips EXIF). */
async function resizeToSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  // WebP where the browser can encode it, else JPEG.
  const webp = await toBlob("image/webp", 0.86);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg", 0.88);
  if (!jpeg) throw new Error("Could not process the image");
  return jpeg;
}

/** Market photo control for a creator's profile. */
export function AvatarEditor({
  handle,
  initialUrl,
}: {
  handle: string;
  initialUrl: string | null;
}) {
  const [url, setUrl] = React.useState(initialUrl);
  const [busy, setBusy] = React.useState<null | "upload" | "remove">(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function call(kind: "upload" | "remove", init: RequestInit) {
    setBusy(kind);
    setMessage(null);
    try {
      const res = await fetch("/api/profile/avatar", init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setUrl(data.avatarUrl ?? null);
      setMessage({ ok: true, text: kind === "remove" ? "Photo removed." : "Photo updated. It shows on your market now." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setBusy(null);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setMessage({ ok: false, text: "Use a JPG, PNG or WebP image." });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ ok: false, text: "That image is over 10 MB. Pick a smaller one." });
      return;
    }
    try {
      const blob = await resizeToSquare(file);
      const form = new FormData();
      form.append("file", blob, blob.type === "image/webp" ? "photo.webp" : "photo.jpg");
      await call("upload", { method: "POST", body: form });
    } catch {
      setMessage({ ok: false, text: "Couldn't read that image. Try another one." });
    }
  }

  const btn =
    "focus-ring h-9 rounded-lg border border-border-bright px-3 text-[13px] font-medium hover:bg-arc-bg-2 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-4">
      <CreatorAvatar handle={handle} src={url} size={56} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Market photo</p>
        <p className="text-xs text-text-secondary">Shown on your market and in the markets table. Square crop, 256×256.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} aria-label="Upload a market photo" />
          <button type="button" className={btn} disabled={!!busy} onClick={() => inputRef.current?.click()}>
            {busy === "upload" ? "Uploading…" : "Upload photo"}
          </button>
          {url && (
            <button type="button" className={btn} disabled={!!busy} onClick={() => call("remove", { method: "DELETE" })}>
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
        {message && (
          <p role="status" className={`mt-2 text-xs ${message.ok ? "text-green" : "text-arc-coral"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
