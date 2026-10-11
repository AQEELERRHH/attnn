/**
 * Creator profile rules shared by the profile routes. Client-safe (no server imports).
 *
 * Tags are written to the AttnnRegistry on Arc as well as the DB, and the registry
 * rejects more than 10 tags and matches them exactly (getCreatorsByTag("ai") won't
 * find "AI"), so tags are trimmed, lower-cased and de-duplicated before saving.
 */
export const MAX_TAGS = 10;
export const MAX_TAG_CHARS = 32;

export function normalizeTags(input: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, tags: [] };
  if (!Array.isArray(input) || input.some((t) => typeof t !== "string")) {
    return { ok: false, error: "Tags must be a list of words" };
  }
  const seen = new Set<string>();
  for (const raw of input as string[]) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    if (tag.length > MAX_TAG_CHARS) return { ok: false, error: `Tags can be at most ${MAX_TAG_CHARS} characters ("${tag.slice(0, 12)}…")` };
    seen.add(tag);
  }
  if (seen.size > MAX_TAGS) return { ok: false, error: `Use at most ${MAX_TAGS} tags` };
  return { ok: true, tags: [...seen] };
}

// ─── Handle and profile text ────────────────────────────────────────────────

/** Handles are unique ignoring case (the registry on Arc lower-cases them). */
const HANDLE_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

export function validateHandle(input: unknown): { ok: true; handle: string } | { ok: false; error: string } {
  if (typeof input !== "string") return { ok: false, error: "Choose a handle" };
  const handle = input.trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, error: "Handles are 2 to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number" };
  }
  return { ok: true, handle };
}

export const AVAILABILITY = ["available", "limited", "not_accepting"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const BIO_MAX_CHARS = 500;
export const OPEN_TO_MAX = 10;
export const OPEN_TO_ITEM_MAX_CHARS = 60;
/** profileURI is written to the registry on Arc, so it's kept short. */
export const PROFILE_URI_MAX_CHARS = 300;

/**
 * Checks the free-text profile fields that were sent (undefined = not sent).
 * Returns cleaned values or the first error.
 */
export function validateProfileFields(body: {
  bio?: unknown;
  openTo?: unknown;
  availabilityStatus?: unknown;
  profileURI?: unknown;
}):
  | { ok: true; values: { bio?: string | null; openTo?: string[]; availabilityStatus?: Availability; profileURI?: string | null } }
  | { ok: false; error: string } {
  const values: { bio?: string | null; openTo?: string[]; availabilityStatus?: Availability; profileURI?: string | null } = {};
  if (body.bio !== undefined) {
    if (body.bio !== null && typeof body.bio !== "string") return { ok: false, error: "Bio must be text" };
    const bio = (body.bio ?? "").trim();
    if (bio.length > BIO_MAX_CHARS) return { ok: false, error: `Keep your bio under ${BIO_MAX_CHARS} characters` };
    values.bio = bio || null;
  }
  if (body.openTo !== undefined) {
    if (body.openTo !== null && (!Array.isArray(body.openTo) || body.openTo.some((x) => typeof x !== "string"))) {
      return { ok: false, error: "\"Open to\" must be a list" };
    }
    const items = [...new Set(((body.openTo as string[] | null) ?? []).map((x) => x.trim()).filter(Boolean))];
    if (items.length > OPEN_TO_MAX) return { ok: false, error: `Use at most ${OPEN_TO_MAX} "open to" items` };
    if (items.some((x) => x.length > OPEN_TO_ITEM_MAX_CHARS)) {
      return { ok: false, error: `Each "open to" item can be at most ${OPEN_TO_ITEM_MAX_CHARS} characters` };
    }
    values.openTo = items;
  }
  if (body.availabilityStatus !== undefined) {
    if (!AVAILABILITY.includes(body.availabilityStatus as Availability)) return { ok: false, error: "Unknown availability" };
    values.availabilityStatus = body.availabilityStatus as Availability;
  }
  if (body.profileURI !== undefined) {
    if (body.profileURI !== null && typeof body.profileURI !== "string") return { ok: false, error: "Profile link must be text" };
    const uri = (body.profileURI ?? "").trim();
    if (uri.length > PROFILE_URI_MAX_CHARS) return { ok: false, error: `Profile link is too long (max ${PROFILE_URI_MAX_CHARS} characters)` };
    if (uri && !/^(https:\/\/|ipfs:\/\/)/i.test(uri)) return { ok: false, error: "Profile link must start with https:// or ipfs://" };
    values.profileURI = uri || null;
  }
  return { ok: true, values };
}
