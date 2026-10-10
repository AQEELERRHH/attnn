/**
 * Market photos in Supabase Storage (public bucket "avatars").
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server only, never exposed to
 * the browser). The bucket is created on first upload if it doesn't exist.
 * Photos are resized to 256×256 and re-encoded in the browser before upload,
 * which also strips EXIF (e.g. GPS) data; the server re-checks type and size.
 */
import { createClient } from "@supabase/supabase-js";

const BUCKET = "avatars";
export const AVATAR_MAX_BYTES = 512 * 1024;

export function avatarStorageConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Photo storage is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Detects the image type from its first bytes. Never trust the declared type. */
export function sniffImageType(bytes: Uint8Array): "image/webp" | "image/png" | "image/jpeg" | null {
  const b = bytes;
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** Uploads (or replaces) a user's market photo. Returns the public URL. */
export async function uploadAvatar(userId: string, bytes: Uint8Array, contentType: "image/webp" | "image/png" | "image/jpeg"): Promise<string> {
  const supabase = client();
  const { data: bucket } = await supabase.storage.getBucket(BUCKET);
  if (!bucket) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: AVATAR_MAX_BYTES,
      allowedMimeTypes: ["image/webp", "image/png", "image/jpeg"],
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  const ext = contentType.split("/")[1];
  const path = `${userId}.${ext}`;
  // Remove other formats so only one photo per user is stored.
  await supabase.storage.from(BUCKET).remove(["webp", "png", "jpeg"].filter((e) => e !== ext).map((e) => `${userId}.${e}`));
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: "3600" });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`; // bust caches after a change
}

export async function deleteAvatar(userId: string): Promise<void> {
  if (!avatarStorageConfigured()) return;
  await client().storage.from(BUCKET).remove(["webp", "png", "jpeg"].map((e) => `${userId}.${e}`));
}
