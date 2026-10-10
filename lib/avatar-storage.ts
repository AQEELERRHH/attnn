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

/**
 * The project's base URL. People often paste the REST URL
 * ("https://x.supabase.co/rest/v1/") or add a trailing slash; keep only the origin.
 */
function projectUrl(): string {
  const raw = (process.env.SUPABASE_URL ?? "").trim();
  try {
    return new URL(raw).origin;
  } catch {
    throw new AvatarStorageError("SUPABASE_URL isn't a valid URL. It should look like https://abcd1234.supabase.co");
  }
}

function client() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!process.env.SUPABASE_URL || !key) throw new AvatarStorageError("Photo storage is not configured");
  return createClient(projectUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A storage failure with a message that's safe to show (never contains the key). */
export class AvatarStorageError extends Error {}

/**
 * Turns a Supabase storage failure into a reason the creator (usually the site
 * owner, while setting this up) can act on. Messages never include the key.
 */
export function describeStorageError(err: unknown): string {
  if (err instanceof AvatarStorageError) return err.message;
  const e = err as { message?: unknown; statusCode?: unknown; status?: unknown; cause?: { code?: unknown } } | null;
  const msg = typeof e?.message === "string" ? e.message : "";
  const status = String(e?.statusCode ?? e?.status ?? "");
  const cause = typeof e?.cause?.code === "string" ? e.cause.code : "";

  if (/row-level security|violates.*policy/i.test(msg)) {
    return "Photo storage refused the upload: SUPABASE_SERVICE_ROLE_KEY looks like the anon/publishable key. Use the service_role (or sb_secret_…) key.";
  }
  if (/jws|jwt|signature|invalid api key|unauthorized|invalid key/i.test(msg) || status === "401" || status === "403") {
    return "Photo storage rejected the server key. Check SUPABASE_SERVICE_ROLE_KEY is this project's service_role (or sb_secret_…) key, with no extra spaces.";
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(cause) || /fetch failed|getaddrinfo|ENOTFOUND/i.test(msg)) {
    return "Couldn't reach photo storage. Check SUPABASE_URL is your project URL, like https://abcd1234.supabase.co";
  }
  if (/bucket not found/i.test(msg)) return "The avatars storage bucket couldn't be created. Create a public bucket called \"avatars\" in Supabase Storage.";
  if (/payload too large|maximum allowed size|exceeded/i.test(msg)) return "That photo is too large for storage. Try a smaller image.";
  return "Upload failed. Please try again.";
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
